"""Cliente Supabase (service role) — uso exclusivo no servidor."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.config import settings


@lru_cache(maxsize=1)
def get_supabase_admin() -> Any:
    """Cria o cliente admin. Nunca exponha a service role key ao front-end."""
    if not settings.supabase_configured:
        raise RuntimeError(
            "Supabase não configurado. Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY "
            "em api/.env ou rode em MOCK_MODE=true."
        )

    # Import tardio para o esqueleto funcionar antes de instalar as dependências.
    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_role_key)
