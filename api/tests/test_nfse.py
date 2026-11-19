import base64
import gzip
import json

import pytest

from app.config import settings
from app.services import nfse_adn

XML_EXEMPLO = b"""<?xml version="1.0" encoding="UTF-8"?>
<nfse xmlns="http://www.portalfiscal.inf.br/nfse">
  <chave>11111111111111111111111111111111111111111111111111</chave>
  <nNFS>123</nNFS>
  <serie>1</serie>
  <dEmi>2026-11-18T14:32:00</dEmi>
  <vNFS>258.90</vNFS>
  <cnpjPrestador>30720420000103</cnpjPrestador>
  <cnpjTomador>12345678000190</cnpjTomador>
</nfse>"""

XML_ANINHADO = b"""<?xml version="1.0" encoding="UTF-8"?>
<nfse xmlns="http://www.portalfiscal.inf.br/nfse">
  <infNFSe>
    <chave>22222222222222222222222222222222222222222222222222</chave>
    <nNFSe>321</nNFSe>
    <serie>2</serie>
    <dhEmi>2026-11-19T09:15:00-03:00</dhEmi>
    <valores><vLiq>99.90</vLiq></valores>
    <prest><CNPJ>30.720.420/0001-03</CNPJ></prest>
    <toma><CNPJ>12.345.678/0001-90</CNPJ></toma>
  </infNFSe>
</nfse>"""


def test_interpretar_documento_adn():
    doc = nfse_adn.interpretar_documento(XML_EXEMPLO, 42)
    assert doc.nsu == 42
    assert doc.chave == "1" * 50
    assert doc.numero == "123"
    assert doc.serie == "1"
    assert doc.valor == 258.9
    assert doc.prestador_cnpj == "30720420000103"
    assert doc.tomador_cnpj == "12345678000190"
    assert doc.cancelada is False


def test_interpretar_documento_com_estrutura_aninhada():
    doc = nfse_adn.interpretar_documento(XML_ANINHADO, 7)
    assert doc.chave == "2" * 50
    assert doc.numero == "321"
    assert doc.serie == "2"
    assert doc.valor == 99.9
    assert doc.prestador_cnpj == "30720420000103"
    assert doc.tomador_cnpj == "12345678000190"


def test_interpretar_evento_cancelamento():
    assert nfse_adn.tem_cancelamento(b"<evento><tipo>Cancelamento</tipo></evento>") is True
    assert nfse_adn.tem_cancelamento(b"<evento><tpEvento>101101</tpEvento></evento>") is True
    assert nfse_adn.tem_cancelamento(b"<evento><tipo>Outro</tipo></evento>") is False


def test_ambientes_adn(monkeypatch):
    monkeypatch.setattr(settings, "nfse_adn_env", "homologacao")
    assert "producaorestrita" in nfse_adn.base_url()
    monkeypatch.setattr(settings, "nfse_adn_env", "producao")
    assert "producaorestrita" not in nfse_adn.base_url()


def test_modulo_desabilitado(client, monkeypatch):
    monkeypatch.setattr(settings, "nfse_enabled", False)
    resposta = client.get("/nfse/config")
    assert resposta.status_code == 200
    assert resposta.json()["habilitado"] is False

    busca = client.post("/nfse/downloads", json={"company_id": "x"})
    assert busca.status_code == 501


class FakeHttpResponse:
    def __init__(self, status_code: int, content: bytes):
        self.status_code = status_code
        self.content = content


def _cliente(monkeypatch) -> nfse_adn.AdnClient:
    monkeypatch.setattr(
        nfse_adn.certificate_vault, "load", lambda _company: (b"pfx", "senha")
    )
    return nfse_adn.AdnClient("empresa-1", "30.720.420/0002-94")


def test_consulta_lote_usa_cnpj_e_devolve_itens(monkeypatch):
    capturado: dict = {}

    def fake_get(url, params=None, **_kwargs):
        capturado["url"] = url
        capturado["params"] = params
        corpo = json.dumps({
            "StatusProcessamento": "DOCUMENTOS_LOCALIZADOS",
            "LoteDFe": [
                {
                    "NSU": 7,
                    "ChaveAcesso": "3" * 50,
                    "TipoDocumento": "NFSE",
                    "TipoEvento": "",
                    "ArquivoXml": XML_EXEMPLO.decode("utf-8"),
                }
            ],
        })
        return FakeHttpResponse(200, corpo.encode("utf-8"))

    monkeypatch.setattr(nfse_adn.requests_pkcs12, "get", fake_get)
    adn = _cliente(monkeypatch)

    resposta = adn.consultar(7)

    assert adn.cnpj == "30720420000294"
    assert capturado["url"].endswith("/DFe/7")
    assert capturado["params"] == {
        "cnpjConsulta": "30720420000294",
        "lote": "true",
    }
    assert resposta.status == "DOCUMENTOS_LOCALIZADOS"
    assert len(resposta.itens) == 1
    assert resposta.itens[0].nsu == 7
    assert resposta.itens[0].chave == "3" * 50
    assert resposta.itens[0].xml == XML_EXEMPLO
    assert resposta.itens[0].eh_evento is False


def test_consulta_aceita_arquivo_xml_em_base64(monkeypatch):
    def fake_get(_url, params=None, **_kwargs):
        corpo = json.dumps({
            "StatusProcessamento": "DOCUMENTOS_LOCALIZADOS",
            "LoteDFe": [
                {
                    "NSU": 8,
                    "ChaveAcesso": "4" * 50,
                    "TipoDocumento": "NFSE",
                    "ArquivoXml": base64.b64encode(XML_EXEMPLO).decode("ascii"),
                }
            ],
        })
        return FakeHttpResponse(200, corpo.encode("utf-8"))

    monkeypatch.setattr(nfse_adn.requests_pkcs12, "get", fake_get)
    resposta = _cliente(monkeypatch).consultar(8)

    assert resposta.itens[0].xml == XML_EXEMPLO


def test_consulta_descompacta_arquivo_gzip_base64(monkeypatch):
    compactado = gzip.compress(XML_EXEMPLO)

    def fake_get(_url, params=None, **_kwargs):
        corpo = json.dumps({
            "StatusProcessamento": "DOCUMENTOS_LOCALIZADOS",
            "LoteDFe": [
                {
                    "NSU": 9,
                    "ChaveAcesso": "5" * 50,
                    "TipoDocumento": "NFSE",
                    "DataHoraGeracao": "2026-11-19T10:00:00",
                    "ArquivoXml": base64.b64encode(compactado).decode("ascii"),
                }
            ],
        })
        return FakeHttpResponse(200, corpo.encode("utf-8"))

    monkeypatch.setattr(nfse_adn.requests_pkcs12, "get", fake_get)
    resposta = _cliente(monkeypatch).consultar(9)

    assert resposta.itens[0].xml == XML_EXEMPLO
    assert resposta.itens[0].data_geracao == "2026-11-19T10:00:00"


def test_404_e_fim_da_fila_nao_e_erro(monkeypatch):
    def fake_get(_url, params=None, **_kwargs):
        corpo = json.dumps({
            "StatusProcessamento": "NENHUM_DOCUMENTO_LOCALIZADO",
            "Erros": [{"Codigo": "E2220", "Descricao": "Nenhum documento localizado"}],
        })
        return FakeHttpResponse(404, corpo.encode("utf-8"))

    monkeypatch.setattr(nfse_adn.requests_pkcs12, "get", fake_get)
    resposta = _cliente(monkeypatch).consultar(99)

    assert resposta.vazia is True
    assert resposta.status == "NENHUM_DOCUMENTO_LOCALIZADO"
    assert resposta.erros[0]["Codigo"] == "E2220"


def test_rejeicao_400_vira_erro_com_codigo(monkeypatch):
    def fake_get(_url, params=None, **_kwargs):
        corpo = json.dumps({
            "StatusProcessamento": "REJEICAO",
            "Erros": [{"Codigo": "E2245", "Descricao": "Não há procuração"}],
        })
        return FakeHttpResponse(400, corpo.encode("utf-8"))

    monkeypatch.setattr(nfse_adn.requests_pkcs12, "get", fake_get)

    with pytest.raises(nfse_adn.AdnError) as excinfo:
        _cliente(monkeypatch).consultar(1)
    assert excinfo.value.status == 400
    assert "E2245" in str(excinfo.value)
    assert "procuração" in str(excinfo.value)
