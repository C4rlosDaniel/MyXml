"""Leitura e validacao de certificados digitais A1 (.pfx)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID, ObjectIdentifier

OID_CNPJ_SAN = ObjectIdentifier("2.16.76.1.3.3")
_CNPJ_RE = re.compile(r"\d{14}")


class CertificadoInvalido(Exception):
    """Certificado nao pode ser aberto ou nao tem os dados esperados."""


@dataclass(frozen=True)
class DadosCertificado:
    cnpj: str  # 14 digitos, sem pontuacao
    razao_social: str
    titular: str
    emissor: str
    valido_de: datetime
    valido_ate: datetime
    serial: str
    tem_chave_privada: bool

    @property
    def cnpj_formatado(self) -> str:
        return formatar_cnpj(self.cnpj)

    @property
    def dias_para_vencer(self) -> int:
        agora = datetime.now(timezone.utc)
        validade = self.valido_ate
        if validade.tzinfo is None:
            validade = validade.replace(tzinfo=timezone.utc)
        return (validade - agora).days

    @property
    def vencido(self) -> bool:
        return self.dias_para_vencer < 0


def formatar_cnpj(cnpj: str) -> str:
    numeros = re.sub(r"\D", "", cnpj)
    if len(numeros) != 14:
        return cnpj
    return f"{numeros[:2]}.{numeros[2:5]}.{numeros[5:8]}/{numeros[8:12]}-{numeros[12:]}"


def _texto_cnpj(valor: bytes) -> str | None:
    """Decodifica o valor DER de um OtherName (UTF8String)."""
    try:
        if valor and valor[0] == 0x0C:  # UTF8String
            tamanho = valor[1]
            return valor[2 : 2 + tamanho].decode("utf-8")
        return valor.decode("utf-8", "ignore")
    except Exception:
        return None


def _cnpj_do_san(certificado: x509.Certificate) -> str | None:
    try:
        san = certificado.extensions.get_extension_for_class(
            x509.SubjectAlternativeName
        ).value
    except x509.ExtensionNotFound:
        return None
    for nome in san:
        if isinstance(nome, x509.OtherName) and nome.type_id == OID_CNPJ_SAN:
            texto = _texto_cnpj(nome.value)
            if texto:
                achado = _CNPJ_RE.search(re.sub(r"\D", "", texto))
                if achado:
                    return achado.group(0)
    return None


def _cnpj_e_razao_do_cn(certificado: x509.Certificate) -> tuple[str | None, str | None]:
    atributos = certificado.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
    if not atributos:
        return None, None
    cn = str(atributos[0].value).strip()
    razao = cn
    cnpj = None
    if ":" in cn:
        possivel_razao, possivel_cnpj = cn.rsplit(":", 1)
        numeros = re.sub(r"\D", "", possivel_cnpj)
        if len(numeros) == 14:
            cnpj = numeros
            razao = possivel_razao.strip() or cn
    if cnpj is None:
        achado = _CNPJ_RE.search(re.sub(r"\D", "", cn))
        if achado:
            cnpj = achado.group(0)
    return cnpj, razao


def _garantir_datetime(valor: datetime) -> datetime:
    if valor.tzinfo is None:
        return valor.replace(tzinfo=timezone.utc)
    return valor


def carregar(origem: str | Path | bytes, senha: str) -> DadosCertificado:
    """Abre o .pfx, valida a senha e extrai CNPJ, razao social e validade."""
    try:
        if isinstance(origem, (str, Path)):
            conteudo = Path(origem).read_bytes()
        else:
            conteudo = origem
    except OSError as erro:
        raise CertificadoInvalido(f"Nao consegui ler o arquivo: {erro}") from erro

    try:
        chave, certificado, _extras = pkcs12.load_key_and_certificates(
            conteudo, (senha or "").encode("utf-8")
        )
    except ValueError as erro:
        raise CertificadoInvalido(
            "Senha do certificado incorreta ou arquivo .pfx invalido."
        ) from erro
    except Exception as erro:  # pragma: no cover - erros raros de parser
        raise CertificadoInvalido(f"Falha ao abrir o certificado: {erro}") from erro

    if certificado is None:
        raise CertificadoInvalido("O arquivo .pfx nao contem certificado.")

    cnpj, razao = _cnpj_e_razao_do_cn(certificado)
    if cnpj is None:
        cnpj = _cnpj_do_san(certificado)
    if cnpj is None:
        raise CertificadoInvalido(
            "Nao encontrei o CNPJ dentro do certificado (esperado no CN)."
        )
    if not razao:
        razao = certificado.subject.rfc4514_string()

    return DadosCertificado(
        cnpj=cnpj,
        razao_social=razao,
        titular=certificado.subject.rfc4514_string(),
        emissor=certificado.issuer.rfc4514_string(),
        valido_de=_garantir_datetime(certificado.not_valid_before_utc),
        valido_ate=_garantir_datetime(certificado.not_valid_after_utc),
        serial=format(certificado.serial_number, "X"),
        tem_chave_privada=chave is not None,
    )
