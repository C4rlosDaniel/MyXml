from __future__ import annotations

from pydantic import BaseModel


class CurrentUserOut(BaseModel):
    id: str
    email: str | None = None
    name: str | None = None
    role: str
