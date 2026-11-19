"""Download de NFC-e — criação/acompanhamento do job na nuvem."""

from __future__ import annotations

import io
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse, Response

from app.config import settings
from app.schemas.license import MessageOut
from app.security import get_current_user
from app.services import download_runner
from app.services.access import allowed_company_ids
from app.services.supabase_client import get_supabase_admin, maybe_data

router = APIRouter(prefix="/downloads", tags=["downloads"])


def _guard() -> None:
    if settings.mock_mode:
        raise HTTPException(status_code=501, detail="Este recurso está indisponível no momento.")


def _period_bounds(period: str | None) -> tuple[date | None, date | None]:
    if not period:
        return None, None
    try:
        start = datetime.strptime(period, "%Y-%m").date()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Período inválido. Use AAAA-MM.") from exc
    if start.month == 12:
        end = date(start.year + 1, 1, 1)
    else:
        end = date(start.year, start.month + 1, 1)
    return start, date.fromordinal(end.toordinal() - 1)


@router.post("")
def iniciar_download(
    payload: dict,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
) -> dict:
    """Registra a execução e processa em background.

    O download salva cada nota assim que ela chega, então pode ser retomado sem
    refazer o que já foi baixado.
    """
    _guard()
    client = get_supabase_admin()
    company_id = str(payload.get("company_id", ""))
    if not company_id:
        raise HTTPException(status_code=422, detail="Empresa não informada.")

    ids = allowed_company_ids(user, client)
    if ids is not None and company_id not in ids:
        raise HTTPException(status_code=403, detail="Sem acesso a esta empresa.")

    # A SEFAZ limita chamadas simultâneas com o mesmo certificado (código 656)
    # e pode bloquear o contribuinte. Uma execução por empresa por vez.
    download_runner.marcar_interrompidas(company_id)
    em_andamento = (
        client.from_("download_runs")
        .select("id")
        .eq("company_id", company_id)
        .eq("status", "executando")
        .limit(1)
        .execute()
        .data
    )
    if em_andamento:
        raise HTTPException(
            status_code=409,
            detail="Já existe um download em andamento para esta empresa. "
            "Aguarde-o terminar para não bloquear a SEFAZ.",
        )

    start, end = _period_bounds(payload.get("period"))
    response = client.from_("download_runs").insert({
        "company_id": company_id,
        "user_id": user["id"],
        "status": "executando",
        "periodo_ini": start.isoformat() if start else None,
        "periodo_fim": end.isoformat() if end else None,
    }).execute()

    if not response.data:
        raise HTTPException(status_code=400, detail="Não foi possível iniciar o download.")

    job = response.data[0]
    background_tasks.add_task(download_runner.executar, str(job["id"]))
    return job


@router.get("/{job_id}")
def status_download(job_id: str, user: dict = Depends(get_current_user)) -> dict:
    _guard()
    client = get_supabase_admin()
    response = (
        client.from_("download_runs")
        .select("*, companies(razao_social, nome_exibicao)")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    job = maybe_data(response)
    if not job:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")

    ids = allowed_company_ids(user, client)
    if ids is not None and str(job.get("company_id")) not in ids:
        raise HTTPException(status_code=403, detail="Sem acesso a esta execução.")

    # Job que parou de dar sinal (deploy, queda da máquina) vira "interrompido"
    # para o front poder retomar de onde parou, em vez de ficar preso em 409.
    if job.get("status") == "executando" and download_runner.sem_sinal(
        job.get("atualizado_em"), download_runner.SEGUNDOS_SEM_SINAL
    ):
        download_runner.marcar_interrompidas(str(job["company_id"]))
        job = maybe_data(
            client.from_("download_runs")
            .select("*, companies(razao_social, nome_exibicao)")
            .eq("id", job_id)
            .maybe_single()
            .execute()
        ) or job
    return job


@router.post("/{job_id}/run")
def repetir_download(
    job_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
) -> dict:
    """Retoma um job interrompido/falho. Quem já foi salvo não é baixado de novo."""
    _guard()
    job = status_download(job_id, user)
    if job.get("status") == "executando":
        raise HTTPException(status_code=409, detail="Esta execução já está em andamento.")

    client = get_supabase_admin()
    company_id = str(job.get("company_id"))
    download_runner.marcar_interrompidas(company_id)
    outro = (
        client.from_("download_runs")
        .select("id, atualizado_em")
        .eq("company_id", company_id)
        .eq("status", "executando")
        .neq("id", job_id)
        .execute()
        .data
        or []
    )
    if any(
        not download_runner.sem_sinal(linha.get("atualizado_em"), download_runner.SEGUNDOS_SEM_SINAL)
        for linha in outro
    ):
        raise HTTPException(
            status_code=409,
            detail="Já existe um download em andamento para esta empresa.",
        )

    client.from_("download_runs").update({
        "status": "executando",
        "mensagem": None,
        "finished_at": None,
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).execute()
    background_tasks.add_task(download_runner.executar, job_id)
    return {"message": "Download retomado."}


@router.post("/{job_id}/cancel", response_model=MessageOut)
def cancelar_download(job_id: str, user: dict = Depends(get_current_user)) -> dict:
    """Encerra a execução quando o usuário confirma a saída da aba."""
    _guard()
    status_download(job_id, user)  # valida existência e permissão
    client = get_supabase_admin()
    atual = maybe_data(
        client.from_("download_runs")
        .select("status")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if not atual or atual.get("status") != "executando":
        return {"message": "Esta execução já havia terminado."}

    client.from_("download_runs").update({
        "status": "falhou",
        "mensagem": "Download encerrado: o usuário saiu da aba de baixar notas.",
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).execute()
    return {"message": "Download encerrado."}


@router.get("/{job_id}/xml")
def baixar_xmls(job_id: str, user: dict = Depends(get_current_user)) -> Response:
    """Monta um ZIP com os XMLs já salvos da empresa no período da execução.

    Não depende de um ZIP gerado no fim do job: funciona mesmo quando o
    download foi interrompido no meio, com tudo o que já foi salvo.
    """
    _guard()
    job = status_download(job_id, user)
    if not job.get("periodo_ini") or not job.get("periodo_fim"):
        raise HTTPException(status_code=404, detail="Período da execução não encontrado.")

    inicio = date.fromisoformat(str(job["periodo_ini"]))
    fim = date.fromisoformat(str(job["periodo_fim"]))
    client = get_supabase_admin()

    linhas: list[dict] = []
    vistas: set[str] = set()
    for mes in download_runner.meses_do_periodo(inicio, fim):
        lote = (
            client.from_("notes")
            .select("chave, storage_path")
            .eq("company_id", job["company_id"])
            .like("chave", f"__{mes}%")
            .not_.is_("storage_path", "null")
            .execute()
            .data
            or []
        )
        for linha in lote:
            chave = str(linha["chave"])
            if chave not in vistas:
                vistas.add(chave)
                linhas.append(linha)

    if not linhas:
        raise HTTPException(
            status_code=404,
            detail="Nenhum XML salvo para este período. Baixe as notas primeiro.",
        )

    storage = client.storage.from_(settings.storage_bucket)

    def _baixar(linha: dict) -> tuple[str, bytes] | None:
        caminho = str(linha.get("storage_path") or "")
        if not caminho:
            return None
        try:
            return caminho.rsplit("/", 1)[-1], storage.download(caminho)
        except Exception:  # noqa: BLE001 - objeto ausente não impede o restante
            return None

    # Baixa os XMLs em paralelo: um mês inteiro (centenas de notas) sai em
    # segundos em vez de vários minutos.
    with ThreadPoolExecutor(max_workers=12) as pool:
        baixados = [item for item in pool.map(_baixar, linhas) if item]

    conteudo = io.BytesIO()
    with zipfile.ZipFile(conteudo, "w", zipfile.ZIP_DEFLATED) as arquivo:
        for nome_arquivo, dados in baixados:
            arquivo.writestr(nome_arquivo, dados)
    enviados = len(baixados)

    if not enviados:
        raise HTTPException(
            status_code=404,
            detail="Os XMLs desta execução não estão mais disponíveis. Baixe novamente.",
        )

    if (inicio.year, inicio.month) == (fim.year, fim.month):
        nome = f"NFCe-{inicio:%Y-%m}.zip"
    else:
        nome = f"NFCe-{inicio:%Y-%m-%d}_a_{fim:%Y-%m-%d}.zip"

    return Response(
        content=conteudo.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )


@router.get("/{job_id}/excel")
def exportar_excel(job_id: str, user: dict = Depends(get_current_user)) -> FileResponse:
    """Gera a planilha com o core original e devolve o arquivo."""
    _guard()
    status_download(job_id, user)
    try:
        nome, caminho = download_runner.gerar_excel(job_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        caminho,
        filename=nome,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
