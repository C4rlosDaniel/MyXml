"""Rotaciona a chave de criptografia do cofre de certificados.

Uso:
  OLD_CERT_ENCRYPTION_KEY=... NEW_CERT_ENCRYPTION_KEY=... \
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python scripts/rotate_cert_key.py

Depois troque CERT_ENCRYPTION_KEY no host (Fly secret) e redeploye.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet
from supabase import create_client


def fernet(secret: str) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def main() -> None:
    old_secret = os.environ["OLD_CERT_ENCRYPTION_KEY"]
    new_secret = os.environ["NEW_CERT_ENCRYPTION_KEY"]
    old, new = fernet(old_secret), fernet(new_secret)

    client = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    rows = client.from_("company_certificates").select("*").execute().data or []

    for row in rows:
        pfx = old.decrypt(row["pfx_enc"].encode("utf-8"))
        senha = old.decrypt(row["senha_enc"].encode("utf-8"))
        client.from_("company_certificates").upsert({
            "company_id": row["company_id"],
            "pfx_enc": new.encrypt(pfx).decode("utf-8"),
            "senha_enc": new.encrypt(senha).decode("utf-8"),
            "cnpj": row["cnpj"],
            "razao_social": row["razao_social"],
            "valido_ate": row.get("valido_ate"),
        }).execute()

    print(f"certificados recriptografados: {len(rows)}")


if __name__ == "__main__":
    main()
