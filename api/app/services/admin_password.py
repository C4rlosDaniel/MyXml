"""Confirmação da senha do administrador para ações sensíveis em licenças."""

from __future__ import annotations

import httpx
from fastapi import HTTPException

from app.config import settings

_MOCK_ADMIN_PASSWORD = "admin123"  # mesmo usuário de teste do README/mockStore


def verify(admin: dict, password: str) -> None:
    """Confere a senha do admin autenticado; levanta 403 se não conferir.

    A validação é feita por chamada HTTP direta ao Auth em vez de
    `supabase.auth.sign_in_with_password`: esse método troca o header de
    autenticação do cliente compartilhado (service role -> token do usuário) e
    faz as consultas seguintes caírem em RLS, apagando o usuário no Auth mas
    deixando limpeza/licença falharem com erro no front.
    """
    if not password:
        raise HTTPException(status_code=422, detail="Informe a senha do administrador.")

    if settings.mock_mode:
        if password != _MOCK_ADMIN_PASSWORD:
            raise HTTPException(status_code=403, detail="Senha do administrador incorreta.")
        return

    try:
        response = httpx.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_service_role_key},
            json={"email": admin["email"], "password": password},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=503, detail="Não foi possível validar a senha agora."
        ) from exc

    if response.status_code != 200:
        raise HTTPException(status_code=403, detail="Senha do administrador incorreta.")

    user = response.json().get("user") or {}
    if str(user.get("id")) != str(admin["id"]):
        raise HTTPException(status_code=403, detail="Senha do administrador incorreta.")
