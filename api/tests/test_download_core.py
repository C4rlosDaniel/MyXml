"""Regras do download de NFC-e que precisam sobreviver a falhas isoladas."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from lxml import etree

from app.services.download_runner import meses_do_periodo
from core import sefaz_nfce


def _chave(nnf: int) -> str:
    """Chave de 44 dígitos: cUF + AAMM + CNPJ + modelo + série + número..."""
    return (
        "35"
        "2610"
        "30720420000294"
        "65"
        "001"
        f"{nnf:09d}"
        "1"
        "00000001"
        "0"
    )


CHAVE_OK = _chave(1)
CHAVE_ERRO = _chave(2)
CHAVE_OK_2 = _chave(3)

XML_OK = """<?xml version="1.0" encoding="UTF-8"?>
<retDownloadXML xmlns="http://www.portalfiscal.inf.br/nfe">
  <cStat>200</cStat>
  <xMotivo>Download disponivel</xMotivo>
  <nfeProc versao="4.00">
    <NFe><infNFe Id="NFe{chave}" versao="4.00">
      <ide><cUF>35</cUF><mod>65</mod><serie>1</serie><nNF>1</nNF>
        <dhEmi>2026-10-17T10:00:00-03:00</dhEmi></ide>
      <total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>
    </infNFe></NFe>
    <protNFe><infProt><cStat>100</cStat></infProt></protNFe>
  </nfeProc>
</retDownloadXML>"""


def test_chaves_do_teste_tem_44_digitos():
    assert len(CHAVE_OK) == 44
    assert len(CHAVE_ERRO) == 44
    assert len(CHAVE_OK_2) == 44


def test_data_de_emissao_vem_do_xml():
    raiz = etree.fromstring(XML_OK.format(chave=CHAVE_OK).encode("utf-8"))
    assert sefaz_nfce.data_de_emissao(raiz) == "17/10/26"
    assert sefaz_nfce.data_de_emissao(etree.fromstring(b"<a/>")) == ""


def test_meses_do_periodo_atravessa_anos():
    assert meses_do_periodo(date(2026, 10, 1), date(2026, 12, 31)) == [
        "2610",
        "2611",
        "2612",
    ]
    assert meses_do_periodo(date(2026, 12, 1), date(2027, 1, 31)) == ["2612", "2701"]


def test_baixar_chaves_continua_apos_erro_e_loga_a_data(monkeypatch, tmp_path: Path):
    chamadas: list[str] = []
    salvas: list[str] = []
    linhas: list[str] = []

    def fake_chamar(pfx, senha, servico, corpo, log=print, tentativas=3, cancelado=None):
        if f"<chNFCe>{CHAVE_ERRO}</chNFCe>" in corpo:
            chamadas.append(CHAVE_ERRO)
            raise sefaz_nfce.SefazErro("conexao caiu")
        for chave in (CHAVE_OK_2, CHAVE_OK):
            if f"<chNFCe>{chave}</chNFCe>" in corpo:
                chamadas.append(chave)
                return etree.fromstring(XML_OK.format(chave=chave).encode("utf-8"))
        raise AssertionError("chave inesperada no teste")

    monkeypatch.setattr(sefaz_nfce, "chamar", fake_chamar)

    total, baixadas = sefaz_nfce.baixar_chaves(
        b"pfx",
        "senha",
        [CHAVE_OK, CHAVE_ERRO, CHAVE_OK_2],
        tmp_path,
        log=linhas.append,
        pausa=0,
        ao_baixar=lambda chave, caminho: salvas.append(chave),
    )

    assert chamadas == [CHAVE_OK, CHAVE_ERRO, CHAVE_OK_2]
    assert total == {"ok": 2, "ja_tinha": 0, "erro": 1}
    assert baixadas == [CHAVE_OK, CHAVE_OK_2]
    assert salvas == [CHAVE_OK, CHAVE_OK_2]
    assert any("baixada do dia 17/10/26" in linha for linha in linhas)
    assert not any(CHAVE_OK in linha for linha in linhas)


def test_baixar_chaves_pula_o_que_ja_esta_salvo(monkeypatch, tmp_path: Path):
    chamadas: list[str] = []
    salvas: list[str] = []
    pausas: list[float] = []

    def fake_chamar(pfx, senha, servico, corpo, log=print, tentativas=3, cancelado=None):
        chamadas.append(corpo)
        return etree.fromstring(XML_OK.format(chave=CHAVE_OK).encode("utf-8"))

    monkeypatch.setattr(sefaz_nfce, "chamar", fake_chamar)
    monkeypatch.setattr(
        sefaz_nfce,
        "_dormir",
        lambda segundos, cancelado=None: pausas.append(segundos),
    )

    total, baixadas = sefaz_nfce.baixar_chaves(
        b"pfx",
        "senha",
        [CHAVE_OK],
        tmp_path,
        log=lambda _: None,
        pausa=0,
        pular={CHAVE_OK},
        ao_baixar=lambda chave, caminho: salvas.append(chave),
    )

    assert chamadas == []
    assert salvas == []
    assert baixadas == []
    assert pausas == []
    assert total == {"ok": 0, "ja_tinha": 1, "erro": 0}


def test_cancelamento_interrompe_o_lote(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        sefaz_nfce,
        "chamar",
        lambda *args, **kwargs: pytest.fail("nao deveria chamar a SEFAZ"),
    )

    with pytest.raises(sefaz_nfce.ExecucaoCancelada):
        sefaz_nfce.baixar_chaves(
            b"pfx",
            "senha",
            [CHAVE_OK],
            tmp_path,
            log=lambda _: None,
            pausa=0,
            cancelado=lambda: True,
        )
