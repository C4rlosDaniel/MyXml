"""Serviço de licenças.

Implementação em memória para o esqueleto. Em produção, trocar por consultas
ao Supabase usando o cliente admin (service role) — nunca a partir do browser.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

_NOW = datetime.now(timezone.utc)

_MOCK_LICENSES: list[dict[str, Any]] = [
    {
        "id": "10000000-0000-0000-0000-000000000001",
        "user_id": "00000000-0000-0000-0000-000000000001",
        "user_name": "Administrador MyFly",
        "user_email": "admin@myfly.com.br",
        "status": "ativo",
        "valid_until": None,
        "activated_by": None,
        "created_at": _NOW,
        "updated_at": _NOW,
    },
    {
        "id": "10000000-0000-0000-0000-000000000002",
        "user_id": "00000000-0000-0000-0000-000000000002",
        "user_name": "Contador Demo",
        "user_email": "contador@myfly.com.br",
        "status": "pendente",
        "valid_until": None,
        "activated_by": None,
        "created_at": _NOW,
        "updated_at": _NOW,
    },
]


def list_all() -> list[dict[str, Any]]:
    # TODO: SELECT * FROM licenses JOIN profiles ... (Supabase admin)
    return list(_MOCK_LICENSES)


def get_by_user(user_id: str) -> dict[str, Any] | None:
    # TODO: buscar licença do usuário no Supabase
    return next((item for item in _MOCK_LICENSES if item["user_id"] == user_id), None)


def get_by_id(license_id: str) -> dict[str, Any] | None:
    return next((item for item in _MOCK_LICENSES if item["id"] == license_id), None)


def update(license_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
    # TODO: UPDATE licenses SET ... WHERE id = ... (Supabase admin + auditoria)
    license = get_by_id(license_id)
    if license is None:
        return None
    license.update(changes)
    license["updated_at"] = datetime.now(timezone.utc)
    return license


def default_valid_until(days: int = 30) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)
