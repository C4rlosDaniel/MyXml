from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


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


class MessageOut(BaseModel):
    message: str
