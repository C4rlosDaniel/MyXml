"""Download de NFC-e — criação/acompanhamento do job na nuvem."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import settings
from app.security import get_current_user
from app.services import download_runner
from app.services.access import allowed_company_ids
from app.services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/downloads", tags=["downloads"])


def _guard() -> None:
    if settings.mock_mode:
        raise HTTPException(status_code=501, detail="Configure o Supabase para usar este endpoint.")


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
    """Registra a execução. O processamento SEFAZ será um job em background.

    TODO: envolver app/core/sefaz_nfce.py + certificado.py e publicar
    progresso (polling/websocket). Nada disso roda na máquina do usuário.
    """
    _guard()
    client = get_supabase_admin()
    company_id = str(payload.get("company_id", ""))
    if not company_id:
        raise HTTPException(status_code=422, detail="Empresa não informada.")

    ids = allowed_company_ids(user, client)
    if ids is not None and company_id not in ids:
        raise HTTPException(status_code=403, detail="Sem acesso a esta empresa.")

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
        .select("*, companies(razao_social), profiles(email)")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    job = response.data
    if not job:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")

    ids = allowed_company_ids(user, client)
    if ids is not None and str(job.get("company_id")) not in ids:
        raise HTTPException(status_code=403, detail="Sem acesso a esta execução.")
    return job


@router.post("/{job_id}/run")
def repetir_download(
    job_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
) -> dict:
    """Repete um job existente (útil após falha transitória da SEFAZ)."""
    _guard()
    status_download(job_id, user)
    background_tasks.add_task(download_runner.executar, job_id)
    return {"message": "Download reagendado."}


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
