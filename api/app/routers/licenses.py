from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.schemas.license import (
    AdminConfirmIn,
    LicenseCreateIn,
    LicenseOut,
    LicenseUpdateIn,
    MessageOut,
    PasswordOut,
)
from app.security import admin_required, get_current_user
from app.services import admin_password, license_service, password_vault
from app.services.supabase_client import get_supabase_admin, maybe_data

router = APIRouter(prefix="/licenses", tags=["licenses"])
logger = logging.getLogger("myxml.licenses")


@router.post("", response_model=LicenseOut, status_code=201)
async def criar_usuario_licenca(
    payload: LicenseCreateIn,
    admin: dict = Depends(admin_required),
) -> dict:
    """Cria o usuário no Supabase Auth e já libera a licença pelo prazo informado."""
    if settings.mock_mode:
        raise HTTPException(status_code=501, detail="Configure o Supabase para criar usuários.")

    client = get_supabase_admin()
    try:
        response = client.auth.admin.create_user({
            "email": payload.email,
            "password": payload.password,
            "email_confirm": True,
            "user_metadata": {
                "role": payload.role,
                "full_name": payload.full_name,
            },
        })
    except Exception as exc:  # noqa: BLE001 - erro do provedor de auth
        texto = str(exc).lower()
        if "already" in texto or "registered" in texto or "existe" in texto:
            raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail.") from exc
        raise HTTPException(
            status_code=400,
            detail=f"Não foi possível criar o usuário: {exc}",
        ) from exc

    user = response.user
    if user is None:
        raise HTTPException(status_code=400, detail="O provedor não retornou o usuário criado.")

    valid_until = (datetime.now(timezone.utc) + timedelta(days=payload.days)).isoformat()
    # O trigger handle_new_user cria profile + licença; aqui apenas ativamos.
    client.from_("licenses").update({
        "status": "ativo",
        "valid_until": valid_until,
        "activated_by": admin["id"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("user_id", user.id).execute()

    row = (
        client.from_("licenses")
        .select("*, profiles!licenses_user_id_fkey(full_name)")
        .eq("user_id", user.id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=500, detail="Usuário criado, mas a licença não foi encontrada.")

    # Cópia criptografada para o admin poder consultar a senha depois (o Auth não a devolve).
    # Não quebra o cadastro se a migration 0006 ainda não tiver sido aplicada.
    try:
        password_vault.save(str(row["id"]), payload.password)
    except Exception as exc:  # noqa: BLE001 - regressão tolerada apenas no cofre
        logger.warning("não foi possível guardar a senha do usuário no cofre: %s", exc)

    profile = row.get("profiles") or {}
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "user_name": str(profile.get("full_name", payload.full_name)),
        "user_email": str(user.email or payload.email),
        "status": row["status"],
        "valid_until": row.get("valid_until"),
        "activated_by": row.get("activated_by"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("/me", response_model=LicenseOut | None)
async def my_license(user: dict = Depends(get_current_user)) -> dict | None:
    return license_service.get_by_user(user["id"])


@router.get("", response_model=list[LicenseOut])
async def list_licenses(_admin: dict = Depends(admin_required)) -> list[dict]:
    return license_service.list_all()


@router.patch("/{license_id}", response_model=LicenseOut)
async def update_license(
    license_id: str,
    payload: LicenseUpdateIn,
    admin: dict = Depends(admin_required),
) -> dict:
    updated = license_service.update(
        license_id,
        {
            "status": payload.status,
            "valid_until": payload.valid_until,
            "activated_by": admin["id"] if payload.status == "ativo" else payload.activated_by,
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Licença não encontrada.")
    return updated


@router.post("/{license_id}/renew", response_model=MessageOut)
async def renew_license(license_id: str, _admin: dict = Depends(admin_required)) -> dict:
    """Renova por 30 dias. TODO: período configurável no painel admin."""
    updated = license_service.update(
        license_id,
        {"status": "ativo", "valid_until": license_service.default_valid_until(30)},
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Licença não encontrada.")
    return {"message": "Licença renovada por 30 dias."}


@router.post("/{license_id}/password", response_model=PasswordOut)
async def ver_senha_usuario(
    license_id: str,
    payload: AdminConfirmIn,
    admin: dict = Depends(admin_required),
) -> dict:
    """Mostra a senha do usuário ao admin, mediante confirmação da senha dele."""
    if settings.mock_mode:
        raise HTTPException(status_code=501, detail="Configure o Supabase para consultar senhas.")
    admin_password.verify(admin, payload.admin_password)

    client = get_supabase_admin()
    row = maybe_data(
        client.from_("licenses").select("user_id").eq("id", license_id).maybe_single().execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Licença não encontrada.")

    senha = password_vault.get(license_id)
    if senha is None:
        raise HTTPException(
            status_code=404,
            detail="Não há senha registrada para este usuário (conta criada antes deste recurso).",
        )
    return {"password": senha}


@router.post("/{license_id}/delete", response_model=MessageOut)
async def apagar_usuario(
    license_id: str,
    payload: AdminConfirmIn,
    admin: dict = Depends(admin_required),
) -> dict:
    """Apaga o usuário do Auth e sua licença, exigindo a senha do admin."""
    if settings.mock_mode:
        raise HTTPException(status_code=501, detail="Configure o Supabase para apagar usuários.")
    admin_password.verify(admin, payload.admin_password)

    client = get_supabase_admin()
    row = maybe_data(
        client.from_("licenses").select("user_id").eq("id", license_id).maybe_single().execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Licença não encontrada.")

    user_id = str(row["user_id"])
    if user_id == str(admin["id"]):
        raise HTTPException(status_code=400, detail="Você não pode apagar o próprio usuário.")

    client.auth.admin.delete_user(user_id)
    # O cascade do FK remove profiles/licenças. A limpeza abaixo é best-effort:
    # se algo falhar aqui, o usuário JÁ foi removido e não devemos devolver erro
    # (foi o que fazia o front reclamar enquanto o usuário já estava apagado).
    try:
        password_vault.delete(license_id)
        client.from_("licenses").delete().eq("id", license_id).execute()
    except Exception as exc:  # noqa: BLE001 - limpeza auxiliar
        logger.warning("falha na limpeza após excluir o usuário %s: %s", user_id, exc)
    return {"message": "Usuário removido do sistema."}
