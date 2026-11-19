"""Ponto de entrada da API MyXml."""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings

# Carrega a raiz ICP-Brasil v10 antes de qualquer chamada à SEFAZ.
from app.services.sefaz_ssl import configure as configurar_ssl_sefaz

configurar_ssl_sefaz()

from app.routers import auth, download, empresas, health, licenses, notes, nfse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("myxml")

if not settings.mock_mode and not (
    settings.cert_encryption_key or settings.cert_encryption_key_file
):
    raise RuntimeError(
        "CERT_ENCRYPTION_KEY é obrigatório quando MOCK_MODE=false. "
        "Use uma chave gerenciada (KMS/Vault) em produção."
    )

app = FastAPI(
    title="MyXml API",
    version="0.1.0",
    description="Camada de serviços da versão web — regras fiscais permanecem no backend.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - started) * 1000
    logger.info(
        "%s %s -> %s (%.0fms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
    )
    return response


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(licenses.router)
app.include_router(notes.router)
app.include_router(download.router)
app.include_router(empresas.router)
app.include_router(nfse.router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Traduz erros de validação para mensagens amigáveis em pt-BR."""
    first = exc.errors()[0] if exc.errors() else None
    field = str(first.get("loc", ["campo"])[-1]) if first else "campo"
    message = f"O campo '{field}' está inválido. Confira e tente novamente."
    return JSONResponse(status_code=422, content={"detail": message})
