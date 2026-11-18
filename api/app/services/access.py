"""Escopo de acesso por empresa.

O cliente admin usa service role e ignora RLS, então o filtro por
company_members precisa ser aplicado explicitamente nas consultas.
"""

from __future__ import annotations

from typing import Any


def allowed_company_ids(user: dict[str, Any], client: Any) -> list[str] | None:
    """Retorna os ids de empresa do usuário, ou None para administradores (todas)."""
    if user.get("role") == "admin":
        return None

    response = (
        client.from_("company_members")
        .select("company_id")
        .eq("user_id", user["id"])
        .execute()
    )
    return [str(row["company_id"]) for row in (response.data or [])]
