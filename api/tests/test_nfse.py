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


def test_interpretar_evento_cancelamento():
    assert nfse_adn.tem_cancelamento(b"<evento><tipo>Cancelamento</tipo></evento>") is True
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
