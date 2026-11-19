"""Confiança TLS para a SEFAZ-SP em qualquer sistema operacional.

O servidor da SEFAZ-SP apresenta uma cadeia ancorada na
``Autoridade Certificadora Raiz Brasileira v10`` (ICP-Brasil). Essa raiz NÃO
está no bundle ``certifi`` nem no pacote ``ca-certificates`` do Debian, mas
está no repositório de certificados do Windows.

Por isso o aplicativo desktop funciona: ``truststore.inject_into_ssl()``
(em ``core/sefaz_nfce.py``) faz o Python usar o repositório do Windows, que
contém a raiz ICP-Brasil. Na Fly (Linux) o ``truststore`` aponta para o
repositório do sistema, que não tem essa raiz, e o handshake falha com
``CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate``.

A correção abaixo é apenas de infraestrutura: garantimos que o ``SSLContext``
criado pelo ``requests_pkcs12`` carregue explicitamente a raiz ICP-Brasil v10.
Nenhuma regra fiscal em ``core/`` é alterada.
"""

from __future__ import annotations

import logging
from pathlib import Path

import requests_pkcs12

logger = logging.getLogger("myxml.sefaz_ssl")

# Está dentro de app/ para ser copiado para a imagem automaticamente (COPY app ./app).
CA_PATH = Path(__file__).resolve().parent.parent / "certs" / "icp_brasil_v10.pem"

_configurado = False


def configure() -> None:
    """Faz o requests_pkcs12 confiar na raiz ICP-Brasil v10 (idempotente)."""
    global _configurado
    if _configurado:
        return
    if not CA_PATH.is_file():
        raise RuntimeError(f"CA ICP-Brasil não encontrada: {CA_PATH}")

    criar_contexto_original = requests_pkcs12._create_sslcontext

    def _criar_contexto_com_ca(pkcs12_data, pkcs12_password_bytes, ssl_protocol):
        contexto = criar_contexto_original(
            pkcs12_data, pkcs12_password_bytes, ssl_protocol
        )
        # Funciona tanto no SSLContext nativo quanto no do truststore (delega).
        contexto.load_verify_locations(cafile=str(CA_PATH))
        return contexto

    requests_pkcs12._create_sslcontext = _criar_contexto_com_ca
    _configurado = True
    logger.info("CA ICP-Brasil v10 carregada para chamadas SEFAZ: %s", CA_PATH)
