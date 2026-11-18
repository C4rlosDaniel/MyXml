"""Cofre de certificados A1 — criptografia simétrica no servidor.

O .pfx e a senha nunca trafegam para o navegador depois do upload.
Em produção, trocar CERT_ENCRYPTION_KEY por chave gerenciada (KMS/Vault).
"""

from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone

from cryptography.fernet import Fernet

from app.config import settings
from app.services.supabase_client import get_supabase_admin

_DEV_KEY = "MYXML_DEV_ONLY_CHANGE_ME"


def _secret() -> str:
    """Chave do cofre: arquivo montado (KMS/Vault) ou variável de ambiente."""
    if settings.cert_encryption_key_file:
        try:
            with open(settings.cert_encryption_key_file, "r", encoding="utf-8") as handle:
                secret = handle.read().strip()
            if secret:
                return secret
        except OSError as exc:
            raise RuntimeError(f"Não foi possível ler a chave do cofre: {exc}") from exc

    if settings.cert_encryption_key:
        return settings.cert_encryption_key

    if settings.mock_mode:
        return _DEV_KEY

    raise RuntimeError(
        "CERT_ENCRYPTION_KEY (ou CERT_ENCRYPTION_KEY_FILE) é obrigatório fora do modo demo."
    )


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(_secret().encode("utf-8")).digest())
    return Fernet(key)


def encrypt(data: bytes) -> str:
    return _fernet().encrypt(data).decode("utf-8")


def decrypt(token: str) -> bytes:
    return _fernet().decrypt(token.encode("utf-8"))


def save(
    company_id: str,
    pfx_bytes: bytes,
    password: str,
    cnpj: str,
    razao_social: str,
    valid_until: str | None,
) -> dict:
    client = get_supabase_admin()
    payload = {
        "company_id": company_id,
        "pfx_enc": encrypt(pfx_bytes),
        "senha_enc": encrypt(password.encode("utf-8")),
        "cnpj": cnpj,
        "razao_social": razao_social,
        "valido_ate": valid_until,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    response = client.from_("company_certificates").upsert(payload).execute()
    if not response.data:
        raise RuntimeError("Não foi possível salvar o certificado no cofre.")
    return response.data[0]


def load(company_id: str) -> tuple[bytes, str]:
    """Devolve (pfx_bytes, senha) descriptografados — uso exclusivo da API."""
    client = get_supabase_admin()
    response = (
        client.from_("company_certificates")
        .select("pfx_enc, senha_enc")
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )
    row = response.data
    if not row:
        raise LookupError("Nenhum certificado cadastrado para esta empresa.")
    return decrypt(row["pfx_enc"]), decrypt(row["senha_enc"]).decode("utf-8")


def info(company_id: str) -> dict | None:
    client = get_supabase_admin()
    response = (
        client.from_("company_certificates")
        .select("cnpj, razao_social, valido_ate, created_at, updated_at")
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )
    return response.data
