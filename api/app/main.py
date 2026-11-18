"""Ponto de entrada da API MyFly."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import auth, download, empresas, health, licenses, notes

app = FastAPI(
    title="MyFly API",
    version="0.1.0",
    description="Camada de serviços da versão web — regras fiscais permanecem no backend.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(licenses.router)
app.include_router(notes.router)
app.include_router(download.router)
app.include_router(empresas.router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Traduz erros de validação para mensagens amigáveis em pt-BR."""
    first = exc.errors()[0] if exc.errors() else None
    field = str(first.get("loc", ["campo"])[-1]) if first else "campo"
    message = f"O campo '{field}' está inválido. Confira e tente novamente."
    return JSONResponse(status_code=422, content={"detail": message})
