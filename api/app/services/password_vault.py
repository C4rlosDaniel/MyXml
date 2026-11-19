"""Cofre da senha informada quando o admin cria um usuário pelo painel.

O Supabase Auth não devolve senhas. Para que o administrador possa consultá-la
quando necessário, guardamos uma cópia criptografada com a mesma chave do cofre
de certificados (service role apenas; a tabela não tem policy de leitura).
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.services import certificate_vault
from app.services.supabase_client import get_supabase_admin, maybe_data

_TABLE = "license_passwords"


def save(license_id: str, password: str) -> None:
    get_supabase_admin().from_(_TABLE).upsert({
        "license_id": license_id,
        "password_enc": certificate_vault.encrypt(password.encode("utf-8")),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()


def get(license_id: str) -> str | None:
    row = maybe_data(
        get_supabase_admin()
        .from_(_TABLE)
        .select("password_enc")
        .eq("license_id", license_id)
        .maybe_single()
        .execute()
    )
    if not row:
        return None
    return certificate_vault.decrypt(row["password_enc"]).decode("utf-8")


def delete(license_id: str) -> None:
    get_supabase_admin().from_(_TABLE).delete().eq("license_id", license_id).execute()
