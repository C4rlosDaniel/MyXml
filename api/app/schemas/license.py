from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class LicenseOut(BaseModel):
    id: str
    user_id: str
    user_name: str
    user_email: str
    status: str
    valid_until: datetime | None = None
    activated_by: str | None = None
    created_at: datetime
    updated_at: datetime


class LicenseUpdateIn(BaseModel):
    status: str = Field(pattern="^(pendente|ativo|bloqueado|expirado)$")
    valid_until: datetime | None = None
    activated_by: str | None = None


class LicenseCreateIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    days: int = Field(default=30, ge=1, le=3650)
    role: str = Field(default="contador", pattern="^(admin|contador)$")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("E-mail inválido.")
        return value.strip().lower()


class MessageOut(BaseModel):
    message: str


class AdminConfirmIn(BaseModel):
    """Confirmação de senha exigida para apagar usuário / ver senha."""

    admin_password: str = Field(min_length=1, max_length=128)


class PasswordOut(BaseModel):
    password: str
