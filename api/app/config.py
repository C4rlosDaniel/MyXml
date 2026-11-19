"""Configuração via variáveis de ambiente (api/.env)."""

from __future__ import annotations

from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""
    cors_origins: str = "http://localhost:5173"
    storage_bucket: str = "documentos"
    cert_encryption_key: str = ""
    cert_encryption_key_file: str = ""
    mock_mode: bool = True
    alert_webhook_url: str = ""
    # Módulo NFS-e (ADN) — desligado até existir certificado credenciado.
    nfse_enabled: bool = False
    nfse_adn_env: str = "homologacao"  # homologacao | producao

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @cached_property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


settings = Settings()
