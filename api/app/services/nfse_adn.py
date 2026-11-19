"""Cliente da API de Distribuição do ADN — NFS-e Nacional (somente leitura).

Não é emissão: consulta lotes de documentos por NSU e eventos pela chave. A
autenticação é mTLS com o certificado A1 da empresa, lido do mesmo cofre usado
pela NFC-e.

Contrato usado (manual do ADN, atualizado em 03/11/2026):
  GET /contribuintes/DFe/{NSU}?lote=true&cnpjConsulta={CNPJ}
  -> JSON com StatusProcessamento e LoteDFe[{NSU, ChaveAcesso, TipoDocumento,
     TipoEvento, ArquivoXml}], até 50 itens.
  -> 404 com corpo = nenhum documento a partir do NSU (fim da fila).
  -> 400 com corpo = rejeição (Erros[{Codigo, Descricao}]).

O `cnpjConsulta` passou a ser exigido na prática desde 31/10/2026: sem ele o
ADN responde 400 mesmo o parâmetro sendo documentado como opcional.

Nenhuma chamada é feita enquanto NFSE_ENABLED=false (ver routers/nfse.py).
"""

from __future__ import annotations

import base64
import gzip
import json
import re
from dataclasses import dataclass, field

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
    """Falha de comunicação/autenticação/rejeição do ADN."""

    def __init__(
        self, mensagem: str, status: int | None = None, erros: list[dict] | None = None
    ) -> None:
        super().__init__(mensagem)
        self.status = status
        self.erros = erros or []


@dataclass
class ItemDfe:
    nsu: int
    chave: str
    tipo_documento: str
    tipo_evento: str
    xml: bytes
    data_geracao: str | None = None

    @property
    def eh_evento(self) -> bool:
        tipo = self.tipo_documento.strip().upper()
        return tipo == "EVENTO" or (not tipo and bool(self.tipo_evento.strip()))

    @property
    def eh_nfse(self) -> bool:
        return self.tipo_documento.strip().upper() == "NFSE"


@dataclass
class RespostaDfe:
    status: str
    itens: list[ItemDfe] = field(default_factory=list)
    erros: list[dict] = field(default_factory=list)

    @property
    def vazia(self) -> bool:
        return not self.itens


def _get(dados: object, chave: str) -> object:
    """Leitura tolerante a PascalCase/camelCase do ADN."""
    if not isinstance(dados, dict):
        return None
    for nome, valor in dados.items():
        if str(nome).lower() == chave.lower():
            return valor
    return None


def _xml_bytes(valor: object) -> bytes:
    """ArquivoXml do ADN: XML cru, base64 puro ou gzip+base64 (documentado)."""
    texto = str(valor or "").strip()
    if not texto:
        return b""
    if texto.startswith("<"):
        return texto.encode("utf-8")
    try:
        bruto = base64.b64decode(texto, validate=True)
    except (ValueError, TypeError):
        return texto.encode("utf-8")
    if bruto[:2] == b"\x1f\x8b":
        try:
            bruto = gzip.decompress(bruto)
        except OSError:
            return texto.encode("utf-8")
    return bruto if bruto.lstrip().startswith(b"<") else texto.encode("utf-8")


def _erros(corpo: dict) -> list[dict]:
    brutos = _get(corpo, "Erros")
    if not isinstance(brutos, list):
        return []
    saida: list[dict] = []
    for erro in brutos:
        if isinstance(erro, dict):
            saida.append(erro)
        elif isinstance(erro, str) and erro.strip():
            saida.append({"Descricao": erro.strip()})
    return saida


def _mensagem_erros(erros: list[dict]) -> str:
    partes: list[str] = []
    for erro in erros[:3]:
        codigo = str(_get(erro, "Codigo") or "").strip()
        descricao = str(_get(erro, "Descricao") or "").strip()
        texto = f"{codigo}: {descricao}".strip(": ")
        if texto:
            partes.append(texto)
    return " | ".join(partes)


class AdnClient:
    """Sessão autenticada com o A1 de uma empresa."""

    def __init__(self, company_id: str, cnpj: str) -> None:
        self.pfx, self.senha = certificate_vault.load(company_id)
        self.base = base_url()
        self.cnpj = re.sub(r"\D", "", cnpj or "")
        if len(self.cnpj) != 14:
            raise AdnError("CNPJ da empresa inválido para consulta ao ADN.")

    def get(self, caminho: str, params: dict | None = None) -> tuple[int, bytes]:
        try:
            resposta = requests_pkcs12.get(
                f"{self.base}{caminho}",
                params=params,
                pkcs12_data=self.pfx,
                pkcs12_password=self.senha,
                timeout=60,
            )
        except Exception as exc:  # noqa: BLE001 - erro de transporte é traduzido
            raise AdnError(f"Falha ao consultar o ADN: {type(exc).__name__}: {exc}") from exc
        return resposta.status_code, resposta.content

    def consultar(self, nsu: int, lote: bool = True) -> RespostaDfe:
        """Consulta um NSU (ou lote) e traduz o envelope JSON do ADN."""
        params = {"cnpjConsulta": self.cnpj}
        if lote:
            params["lote"] = "true"
        status, corpo = self.get(f"/DFe/{int(nsu)}", params)

        try:
            dados = json.loads(corpo.decode("utf-8")) if corpo else {}
        except (ValueError, UnicodeDecodeError) as exc:
            raise AdnError("O ADN devolveu uma resposta inesperada.", status) from exc
        if not isinstance(dados, dict):
            raise AdnError("O ADN devolveu uma resposta inesperada.", status)

        erros = _erros(dados)
        situacao = str(_get(dados, "StatusProcessamento") or "").upper()

        if situacao == "REJEICAO":
            detalhe = _mensagem_erros(erros)
            raise AdnError(
                detalhe or f"O ADN recusou a consulta (HTTP {status}).", status, erros
            )
        if status in (204, 404):
            # 404 com corpo é o fim normal da fila. Não é erro.
            return RespostaDfe(
                status=situacao or "NENHUM_DOCUMENTO_LOCALIZADO", erros=erros
            )
        if status >= 400:
            detalhe = _mensagem_erros(erros)
            raise AdnError(
                detalhe or f"O ADN recusou a consulta (HTTP {status}).", status, erros
            )
        if situacao == "NENHUM_DOCUMENTO_LOCALIZADO":
            return RespostaDfe(status=situacao, erros=erros)
        if not situacao:
            raise AdnError("O ADN devolveu uma resposta sem status.", status)

        itens: list[ItemDfe] = []
        for bruto in _get(dados, "LoteDFe") or []:
            if not isinstance(bruto, dict):
                continue
            xml = _xml_bytes(_get(bruto, "ArquivoXml"))
            if not xml:
                continue
            data_geracao = _get(bruto, "DataHoraGeracao")
            itens.append(
                ItemDfe(
                    nsu=int(_get(bruto, "NSU") or 0),
                    chave=str(_get(bruto, "ChaveAcesso") or "").strip(),
                    tipo_documento=str(_get(bruto, "TipoDocumento") or ""),
                    tipo_evento=str(_get(bruto, "TipoEvento") or ""),
                    xml=xml,
                    data_geracao=str(data_geracao) if data_geracao else None,
                )
            )
        return RespostaDfe(
            status=situacao or "DOCUMENTOS_LOCALIZADOS", itens=itens, erros=erros
        )

    def documento(self, nsu: int) -> bytes:
        """Compatibilidade: um único XML do NSU (sem lote)."""
        resposta = self.consultar(nsu, lote=False)
        return resposta.itens[0].xml if resposta.itens else b""

    def eventos(self, chave: str) -> bytes:
        status, corpo = self.get(f"/NFSe/{chave}/Eventos")
        if status in (204, 404):
            return b""
        if status >= 400:
            raise AdnError(f"ADN respondeu {status} ao consultar eventos.", status)
        return corpo


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


def _subarvore(elemento: etree._Element, nomes: set[str]) -> etree._Element | None:
    for no in elemento.iter():
        if isinstance(no.tag, str) and etree.QName(no).localname.lower() in nomes:
            return no
    return None


def _documento_do_cnpj(raiz: etree._Element, contexto: set[str], legado: set[str]) -> str:
    no = _subarvore(raiz, contexto)
    if no is not None:
        valor = _campo(no, {"cnpj", "cpf"})
        if valor:
            return re.sub(r"\D", "", valor)
    return re.sub(r"\D", "", _campo(raiz, legado))


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
        encontrada = re.search(rb"\b\d{50}\b", xml)
        chave = encontrada.group(0).decode("ascii") if encontrada else ""

    return DocumentoNfse(
        nsu=nsu,
        chave=chave,
        numero=_campo(raiz, {"nnfse", "nnfs", "nnumero", "numero", "ndps"}),
        serie=_campo(raiz, {"serie", "seriedps"}),
        emitida_em=_campo(raiz, {"dhemi", "demi", "dataemissao"}) or None,
        valor=_valor(_campo(raiz, {"vnfs", "vnfse", "vserv", "valor", "vliquido", "vliq"})),
        prestador_cnpj=_documento_do_cnpj(
            raiz, {"prest", "prestador"}, {"cnpjprestador", "cpfprestador"}
        ),
        tomador_cnpj=_documento_do_cnpj(
            raiz, {"toma", "tomador"}, {"cnpjtomador", "cpftomador"}
        ),
        cancelada=b"cancelamento" in xml.lower() or b"cancelada" in xml.lower(),
        xml=xml,
    )


def tem_cancelamento(xml_eventos: bytes) -> bool:
    texto = xml_eventos.lower()
    return (
        b"cancelamento" in texto
        or b"evento cancelado" in texto
        or b"101101" in texto
        or b"105102" in texto
    )
