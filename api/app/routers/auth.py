from __future__ import annotations

from fastapi import APIRouter, Depends

from app.schemas.auth import CurrentUserOut
from app.security import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=CurrentUserOut)
async def current_user(user: dict = Depends(get_current_user)) -> dict:
    """Dados do usuário autenticado (espelho do perfil do Supabase)."""
    return user
