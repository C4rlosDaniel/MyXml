"""Notas fiscais — leitura via Supabase (RLS + escopo por empresa)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.security import get_current_user
from app.services.access import allowed_company_ids
from app.services.supabase_client import get_supabase_admin, maybe_data

router = APIRouter(prefix="/notes", tags=["notes"])

SELECT = "id, company_id, chave, numero, serie, modelo, emitida_em, valor, situacao, client_name, companies(razao_social)"


def _guard() -> None:
    if settings.mock_mode:
        raise HTTPException(status_code=501, detail="Configure o Supabase para usar este endpoint.")


@router.get("")
def listar_notas(
    user: dict = Depends(get_current_user),
    company_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    _guard()
    client = get_supabase_admin()
    query = client.from_("notes").select(SELECT).order("emitida_em", desc=True)

    ids = allowed_company_ids(user, client)
    if ids is not None:
        if not ids:
            return {"items": [], "total": 0}
        query = query.in_("company_id", ids)
    if company_id:
        query = query.eq("company_id", company_id)

    response = query.range(offset, offset + limit - 1).execute()
    items = response.data or []
    return {"items": items, "total": len(items)}


@router.get("/{note_id}")
def detalhar_nota(note_id: str, user: dict = Depends(get_current_user)) -> dict:
    _guard()
    client = get_supabase_admin()
    response = (
        client.from_("notes").select(SELECT).eq("id", note_id).maybe_single().execute()
    )
    note = maybe_data(response)
    if not note:
        raise HTTPException(status_code=404, detail="Nota não encontrada.")

    ids = allowed_company_ids(user, client)
    if ids is not None and str(note.get("company_id")) not in ids:
        raise HTTPException(status_code=403, detail="Sem acesso a esta nota.")

    # TODO: incluir eventos (timeline), URL assinada do DANFE e tradução de rejeições.
    return note
