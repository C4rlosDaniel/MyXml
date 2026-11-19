"""Garante que o contexto TLS da SEFAZ confie na raiz ICP-Brasil v10."""

import datetime
import ssl

import requests_pkcs12
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.services import sefaz_ssl


def _pkcs12_de_teste() -> bytes:
    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "teste")])
    agora = datetime.datetime.now(datetime.timezone.utc)
    certificado = (
        x509.CertificateBuilder()
        .subject_name(nome)
        .issuer_name(nome)
        .public_key(chave.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(agora)
        .not_valid_after(agora + datetime.timedelta(days=1))
        .sign(chave, hashes.SHA256())
    )
    return serialization.pkcs12.serialize_key_and_certificates(
        b"teste",
        chave,
        certificado,
        None,
        serialization.BestAvailableEncryption(b"senha"),
    )


def test_contexto_sefaz_confia_na_raiz_icp_brasil():
    sefaz_ssl.configure()
    contexto = requests_pkcs12._create_sslcontext(
        _pkcs12_de_teste(), b"senha", ssl.PROTOCOL_TLS_CLIENT
    )
    # Com truststore ativo o contexto é um wrapper; as CAs ficam no _ctx interno.
    ctx_nativo = getattr(contexto, "_ctx", contexto)
    assuntos = " ".join(
        x509.load_der_x509_certificate(der).subject.rfc4514_string()
        for der in ctx_nativo.get_ca_certs(binary_form=True)
    )
    assert "Autoridade Certificadora Raiz Brasileira v10" in assuntos
