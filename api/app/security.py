"""Autenticação e autorização da API."""

from __future__ import annotations

from typing import Any

from fastapi import Depends, Header, HTTPException, status

from app.config import settings
from app.services.supabase_client import get_supabase_admin


async def get_current_user(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Valida o JWT do Supabase e devolve o usuário autenticado.

    Em MOCK_MODE devolve um usuário administrador local para desenvolvimento.
    TODO: validar permissões de empresa (RLS + company_members) nos routers.
    """
    if settings.mock_mode:
        return {
            "id": "00000000-0000-0000-0000-000000000001",
            "email": "admin@myfly.com.br",
            "role": "admin",
            "name": "Administrador MyFly (mock)",
        }

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de acesso ausente ou inválido.",
        )

    token = authorization.split(" ", 1)[1].strip()
    try:
        response = get_supabase_admin().auth.get_user(token)
        user = response.user
    except Exception as exc:  # noqa: BLE001 - traduz erro do provedor
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão expirada. Entre novamente.",
        ) from exc

    if user is None:
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    metadata = {**(user.app_metadata or {}), **(user.user_metadata or {})}
    return {
        "id": user.id,
        "email": user.email,
        "role": metadata.get("role", "contador"),
        "name": metadata.get("full_name", user.email),
    }


async def admin_required(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Ação restrita a administradores.")
    return user
