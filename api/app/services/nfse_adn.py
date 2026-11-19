"""Cliente da API de Distribuição do ADN — NFS-e Nacional (somente leitura).

Não é emissão: consulta documentos por NSU e eventos pela chave. A autenticação
é mTLS com o certificado A1 da empresa, lido do mesmo cofre usado pela NFC-e.

Nenhuma chamada é feita enquanto NFSE_ENABLED=false (ver routers/nfse.py).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import requests_pkcs12
from lxml import etree

from app.config import settings
from app.services import certificate_vault

_BASE_URLS = {
    "homologacao": "https://adn.producaorestrita.nfse.gov.br/contribuintes",
    "producao": "https://adn.nfse.gov.br/contribuintes",
}


def base_url() -> str:
    return _BASE_URLS.get(settings.nfse_adn_env, _BASE_URLS["homologacao"])


class AdnError(RuntimeError):
    """Falha de comunicação/autenticação com o ADN."""

    def __init__(self, mensagem: str, status: int | None = None) -> None:
        super().__init__(mensagem)
        self.status = status


class AdnClient:
    """Sessão autenticada com o A1 de uma empresa."""

    def __init__(self, company_id: str) -> None:
        self.pfx, self.senha = certificate_vault.load(company_id)
        self.base = base_url()

    def get(self, caminho: str) -> bytes:
        try:
            resposta = requests_pkcs12.get(
                f"{self.base}{caminho}",
                pkcs12_data=self.pfx,
                pkcs12_password=self.senha,
                timeout=60,
            )
        except Exception as exc:  # noqa: BLE001 - erro de transporte é traduzido
            raise AdnError(f"Falha ao consultar o ADN: {type(exc).__name__}: {exc}") from exc
        if not resposta.ok:
            raise AdnError(f"ADN respondeu {resposta.status_code}.", resposta.status_code)
        return resposta.content

    def documento(self, nsu: int) -> bytes:
        return self.get(f"/DFe/{nsu}")

    def eventos(self, chave: str) -> bytes:
        return self.get(f"/NFSe/{chave}/Eventos")


@dataclass
class DocumentoNfse:
    nsu: int
    chave: str
    numero: str
    serie: str
    emitida_em: str | None
    valor: float
    prestador_cnpj: str
    tomador_cnpj: str
    cancelada: bool
    xml: bytes


def _campo(elemento: etree._Element, nomes: set[str]) -> str:
    """Busca por local-name, tolerante a versões diferentes do schema."""
    for no in elemento.iter():
        if not isinstance(no.tag, str):
            continue
        if etree.QName(no).localname.lower() in nomes:
            valor = "".join(no.itertext()).strip()
            if valor:
                return valor
    return ""


def _valor(texto: str) -> float:
    try:
        return float(texto.replace(",", "."))
    except ValueError:
        return 0.0


def interpretar_documento(xml: bytes, nsu: int) -> DocumentoNfse:
    """Extrai os campos usados na listagem sem depender de versão do XSD."""
    try:
        raiz = etree.fromstring(xml)
    except etree.XMLSyntaxError as exc:
        raise AdnError("O ADN devolveu um XML inválido.") from exc

    chave = _campo(raiz, {"chave", "chaveacesso", "id"}) or ""
    if not re.fullmatch(r"\d{50}", chave):
        encontrada = re.search(r"\b\d{50}\b", xml.decode("utf-8", errors="ignore"))
        chave = encontrada.group(0) if encontrada else ""

    return DocumentoNfse(
        nsu=nsu,
        chave=chave,
        numero=_campo(raiz, {"nfs", "nnfs", "nnumero", "numero", "ndps"}),
        serie=_campo(raiz, {"serie", "seriedps"}),
        emitida_em=_campo(raiz, {"dhemi", "demi", "dataemissao"}) or None,
        valor=_valor(_campo(raiz, {"vnfs", "vserv", "valor", "vliquido"})),
        prestador_cnpj=_campo(raiz, {"cnpjprestador", "cpfprestador"}),
        tomador_cnpj=_campo(raiz, {"cnpjtomador", "cpftomador"}),
        cancelada=b"cancelamento" in xml.lower() or b"cancelada" in xml.lower(),
        xml=xml,
    )


def tem_cancelamento(xml_eventos: bytes) -> bool:
    texto = xml_eventos.lower()
    return b"cancelamento" in texto or b"evento cancelado" in texto
