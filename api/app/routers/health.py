from __future__ import annotations

from fastapi import APIRouter

from app.config import settings

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "mode": "mock" if settings.mock_mode else "live",
        "supabase_configured": settings.supabase_configured,
    }
