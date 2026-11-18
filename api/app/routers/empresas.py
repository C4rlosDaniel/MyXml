"""Empresas/certificados — CRUD via Supabase."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.config import settings
from app.security import admin_required, get_current_user
from app.services import certificate_vault
from app.services.access import allowed_company_ids
from app.services.supabase_client import get_supabase_admin
from core.certificado import CertificadoInvalido, carregar

router = APIRouter(prefix="/companies", tags=["companies"])


def _guard() -> None:
    if settings.mock_mode:
        raise HTTPException(status_code=501, detail="Configure o Supabase para usar este endpoint.")


@router.get("")
def listar_empresas(user: dict = Depends(get_current_user)) -> list[dict]:
    _guard()
    client = get_supabase_admin()
    query = client.from_("companies").select("*").order("razao_social")
    ids = allowed_company_ids(user, client)
    if ids is not None:
        if not ids:
            return []
        query = query.in_("id", ids)
    return query.execute().data or []


@router.post("")
def cadastrar_empresa(payload: dict, user: dict = Depends(get_current_user)) -> dict:
    """Cria a empresa e vincula o usuário autenticado como membro.

    TODO: receber o .pfx e a senha, validar no servidor (cryptography) e salvar
    o certificado criptografado no cofre/Storage — nunca no navegador.
    """
    _guard()
    client = get_supabase_admin()
    cnpj = str(payload.get("cnpj", "")).strip()
    razao = str(payload.get("razao_social", "")).strip()
    if not cnpj or not razao:
        raise HTTPException(status_code=422, detail="CNPJ e razão social são obrigatórios.")

    response = client.from_("companies").insert({
        "cnpj": cnpj,
        "razao_social": razao,
        "nome_exibicao": payload.get("nome_exibicao"),
        "cert_validade": payload.get("cert_validade") or None,
    }).execute()

    if not response.data:
        raise HTTPException(status_code=400, detail="Não foi possível cadastrar a empresa.")

    company = response.data[0]
    client.from_("company_members").insert({
        "company_id": company["id"],
        "user_id": user["id"],
        "role": "admin" if user.get("role") == "admin" else "contador",
    }).execute()
    return company


@router.post("/certificate/preview")
async def preview_certificate(
    arquivo: UploadFile = File(...),
    senha: str = Form(...),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Lê o .pfx e devolve os dados sem gravar nada (usado no cadastro)."""
    _guard()
    content = await arquivo.read()
    try:
        dados = carregar(content, senha)
    except CertificadoInvalido as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "cnpj": dados.cnpj,
        "razaoSocial": dados.razao_social,
        "validade": dados.valido_ate.isoformat(),
        "titular": dados.titular,
    }


@router.post("/{company_id}/certificate")
async def enviar_certificado(
    company_id: str,
    arquivo: UploadFile = File(...),
    senha: str = Form(...),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Valida o .pfx no servidor e guarda pfx+senha criptografados no cofre."""
    _guard()
    client = get_supabase_admin()
    exists = client.from_("companies").select("id").eq("id", company_id).maybe_single().execute()
    if not exists.data:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")

    content = await arquivo.read()
    try:
        dados = carregar(content, senha)
    except CertificadoInvalido as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    validade = dados.valido_ate.isoformat()
    certificate_vault.save(
        company_id, content, senha, dados.cnpj, dados.razao_social, validade
    )
    client.from_("companies").update({
        "cnpj": dados.cnpj,
        "razao_social": dados.razao_social,
        "cert_validade": validade,
    }).eq("id", company_id).execute()

    return {
        "cnpj": dados.cnpj,
        "razaoSocial": dados.razao_social,
        "validade": validade,
        "titular": dados.titular,
    }


@router.get("/{company_id}/certificate")
def status_certificado(company_id: str, _user: dict = Depends(get_current_user)) -> dict:
    _guard()
    dados = certificate_vault.info(company_id)
    return {"cadastrado": dados is not None, **(dados or {})}


@router.patch("/{company_id}")
def atualizar_empresa(
    company_id: str,
    payload: dict,
    _admin: dict = Depends(admin_required),
) -> dict:
    _guard()
    client = get_supabase_admin()
    allowed = {k: v for k, v in payload.items() if k in {"cnpj", "razao_social", "nome_exibicao", "cert_validade"}}
    if not allowed:
        raise HTTPException(status_code=422, detail="Nenhum campo válido informado.")
    response = client.from_("companies").update(allowed).eq("id", company_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    return response.data[0]


@router.delete("/{company_id}")
def excluir_empresa(company_id: str, _admin: dict = Depends(admin_required)) -> dict:
    _guard()
    client = get_supabase_admin()
    response = client.from_("companies").delete().eq("id", company_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    return {"message": "Empresa removida."}
