"""NFS-e Nacional (ADN) — consulta/download. Nenhuma regra de emissão aqui."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response

from app.config import settings
from app.schemas.license import MessageOut
from app.security import get_current_user
from app.services import nfse_runner
from app.services.access import allowed_company_ids
from app.services.supabase_client import get_supabase_admin, maybe_data

router = APIRouter(prefix="/nfse", tags=["nfse"])

NOTAS = (
    "id, company_id, nsu, chave, numero, serie, emitida_em, valor, situacao, "
    "prestador_cnpj, tomador_cnpj, storage_path, eventos"
)


def _guard_download() -> None:
    if not settings.nfse_enabled:
        raise HTTPException(
            status_code=501,
            detail="Módulo NFS-e desabilitado. Configure NFSE_ENABLED=true e o certificado A1 da empresa.",
        )
    if settings.mock_mode:
        raise HTTPException(status_code=501, detail="Configure o Supabase para buscar NFS-e.")


def _acesso(empresa: str, user: dict, client) -> None:
    ids = allowed_company_ids(user, client)
    if ids is not None and empresa not in ids:
        raise HTTPException(status_code=403, detail="Sem acesso a esta empresa.")


@router.get("/config")
def config_nfse(_user: dict = Depends(get_current_user)) -> dict:
    return {"habilitado": settings.nfse_enabled, "ambiente": settings.nfse_adn_env}


@router.get("/notes")
def listar_notas(
    user: dict = Depends(get_current_user),
    company_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    client = get_supabase_admin()
    query = client.from_("nfse_notes").select(NOTAS).order("emitida_em", desc=True)
    ids = allowed_company_ids(user, client)
    if ids is not None:
        if not ids:
            return {"items": [], "total": 0}
        query = query.in_("company_id", ids)
    if company_id:
        query = query.eq("company_id", company_id)
    resposta = query.range(offset, offset + limit - 1).execute()
    itens = resposta.data or []
    return {"items": itens, "total": len(itens)}


@router.get("/notes/{note_id}")
def detalhar_nota(note_id: str, user: dict = Depends(get_current_user)) -> dict:
    client = get_supabase_admin()
    nota = maybe_data(
        client.from_("nfse_notes").select(NOTAS).eq("id", note_id).maybe_single().execute()
    )
    if not nota:
        raise HTTPException(status_code=404, detail="NFS-e não encontrada.")
    _acesso(str(nota["company_id"]), user, client)
    return nota


@router.get("/notes/{note_id}/xml")
def baixar_xml(note_id: str, user: dict = Depends(get_current_user)) -> Response:
    nota = detalhar_nota(note_id, user)
    caminho = nota.get("storage_path")
    if not caminho:
        raise HTTPException(status_code=404, detail="Esta NFS-e não possui XML armazenado.")
    try:
        conteudo = (
            get_supabase_admin().storage.from_(settings.storage_bucket).download(str(caminho))
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail="Não foi possível localizar o XML.") from exc
    nome = str(caminho).rsplit("/", 1)[-1] or f"NFS-e-{note_id}.xml"
    return Response(
        content=conteudo,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )


@router.post("/downloads", status_code=201)
def iniciar_busca(
    payload: dict,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
) -> dict:
    """Agenda a busca por NSU. Reaproveita a trava de um job por empresa."""
    _guard_download()
    client = get_supabase_admin()
    empresa = str(payload.get("company_id", ""))
    if not empresa:
        raise HTTPException(status_code=422, detail="Empresa não informada.")
    _acesso(empresa, user, client)

    em_andamento = (
        client.from_("nfse_download_runs")
        .select("id")
        .eq("company_id", empresa)
        .eq("status", "executando")
        .limit(1)
        .execute()
        .data
    )
    if em_andamento:
        raise HTTPException(status_code=409, detail="Já existe uma busca NFS-e em andamento.")

    nsu_ini = int(payload.get("nsu_ini") or 0)
    nsu_fim = int(payload.get("nsu_fim") or 0)
    if nsu_ini < 0 or nsu_fim < 0:
        raise HTTPException(status_code=422, detail="NSU inválido.")

    job = client.from_("nfse_download_runs").insert({
        "company_id": empresa,
        "user_id": user["id"],
        "status": "executando",
        "nsu_ini": nsu_ini,
        "nsu_fim": nsu_fim,
        "log": "Na fila...",
    }).execute()
    if not job.data:
        raise HTTPException(status_code=400, detail="Não foi possível iniciar a busca.")
    background_tasks.add_task(nfse_runner.executar, str(job.data[0]["id"]))
    return job.data[0]


@router.get("/downloads/{job_id}")
def status_busca(job_id: str, user: dict = Depends(get_current_user)) -> dict:
    client = get_supabase_admin()
    job = maybe_data(
        client.from_("nfse_download_runs").select("*").eq("id", job_id).maybe_single().execute()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")
    _acesso(str(job["company_id"]), user, client)
    return job


@router.post("/downloads/{job_id}/cancel", response_model=MessageOut)
def cancelar_busca(job_id: str, user: dict = Depends(get_current_user)) -> dict:
    job = status_busca(job_id, user)
    if job.get("status") != "executando":
        return {"message": "Esta execução já havia terminado."}
    get_supabase_admin().from_("nfse_download_runs").update({
        "status": "falhou",
        "mensagem": "Busca encerrada: o usuário saiu da tela de NFS-e.",
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).execute()
    return {"message": "Busca encerrada."}
