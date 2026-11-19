"""Confirmação da senha do administrador para ações sensíveis em licenças."""

from __future__ import annotations

from fastapi import HTTPException

from app.config import settings
from app.services.supabase_client import get_supabase_admin

_MOCK_ADMIN_PASSWORD = "admin123"  # mesmo usuário de teste do README/mockStore


def verify(admin: dict, password: str) -> None:
    """Confere a senha do admin autenticado; levanta 403 se não conferir."""
    if not password:
        raise HTTPException(status_code=422, detail="Informe a senha do administrador.")

    if settings.mock_mode:
        if password != _MOCK_ADMIN_PASSWORD:
            raise HTTPException(status_code=403, detail="Senha do administrador incorreta.")
        return

    try:
        response = get_supabase_admin().auth.sign_in_with_password({
            "email": admin["email"],
            "password": password,
        })
    except Exception as exc:  # noqa: BLE001 - erro do provedor de auth
        raise HTTPException(status_code=403, detail="Senha do administrador incorreta.") from exc

    if response.user is None or str(response.user.id) != str(admin["id"]):
        raise HTTPException(status_code=403, detail="Senha do administrador incorreta.")
