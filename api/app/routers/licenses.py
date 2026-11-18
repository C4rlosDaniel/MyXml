from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.license import LicenseOut, LicenseUpdateIn, MessageOut
from app.security import admin_required, get_current_user
from app.services import license_service

router = APIRouter(prefix="/licenses", tags=["licenses"])


@router.get("/me", response_model=LicenseOut | None)
async def my_license(user: dict = Depends(get_current_user)) -> dict | None:
    return license_service.get_by_user(user["id"])


@router.get("", response_model=list[LicenseOut])
async def list_licenses(_admin: dict = Depends(admin_required)) -> list[dict]:
    return license_service.list_all()


@router.patch("/{license_id}", response_model=LicenseOut)
async def update_license(
    license_id: str,
    payload: LicenseUpdateIn,
    admin: dict = Depends(admin_required),
) -> dict:
    updated = license_service.update(
        license_id,
        {
            "status": payload.status,
            "valid_until": payload.valid_until,
            "activated_by": admin["id"] if payload.status == "ativo" else payload.activated_by,
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Licença não encontrada.")
    return updated


@router.post("/{license_id}/renew", response_model=MessageOut)
async def renew_license(license_id: str, _admin: dict = Depends(admin_required)) -> dict:
    """Renova por 30 dias. TODO: período configurável no painel admin."""
    updated = license_service.update(
        license_id,
        {"status": "ativo", "valid_until": license_service.default_valid_until(30)},
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Licença não encontrada.")
    return {"message": "Licença renovada por 30 dias."}
