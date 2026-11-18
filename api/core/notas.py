"""Extração de dados das notas a partir dos XMLs baixados."""

from __future__ import annotations

from pathlib import Path

from lxml import etree


def _primeiro(elemento, tag: str):
    achados = elemento.xpath(f".//*[local-name()='{tag}']")
    return achados[0] if achados else None


def _texto(elemento, tag: str) -> str:
    achado = _primeiro(elemento, tag)
    if achado is None or achado.text is None:
        return ""
    return achado.text.strip()


def _da_chave(chave: str) -> dict[str, str]:
    if len(chave) != 44 or not chave.isdigit():
        return {}
    return {
        "modelo": chave[20:22],
        "serie": str(int(chave[22:25])),
        "numero": str(int(chave[25:34])),
    }


def dados_da_nota(caminho: str | Path) -> dict | None:
    """Lê dados de procNFe/procNFCe, resNFe ou eventos DFe."""
    caminho = Path(caminho)
    try:
        raiz = etree.parse(str(caminho)).getroot()
    except Exception:
        return None

    tipo = etree.QName(raiz).localname
    if tipo in ("resEvento", "procEventoNFe"):
        return _dados_evento(raiz, caminho)
    if tipo == "resNFe":
        return _dados_resumo(raiz, caminho)
    return _dados_proc(raiz, caminho, tipo)


def _dados_proc(raiz, caminho: Path, tipo: str) -> dict | None:
    inf = _primeiro(raiz, "infNFe")
    chave = ""
    if inf is not None:
        identificador = inf.get("Id", "")
        chave = identificador[3:] if identificador.startswith("NFe") else identificador
    if not chave:
        chave = _texto(raiz, "chNFe") or caminho.name.split("-")[0]
    if len(chave) != 44:
        # pode ser arquivo inesperado
        pass

    situacao = _texto(raiz, "cStat")
    if not situacao and _texto(raiz, "nProt"):
        situacao = "100"
    extra = _da_chave(chave)
    modelo = _texto(raiz, "mod") or extra.get("modelo", "")

    return {
        "chave": chave,
        "modelo": modelo,
        "serie": _texto(raiz, "serie") or extra.get("serie", ""),
        "numero": _texto(raiz, "nNF") or extra.get("numero", ""),
        "emitida_em": _texto(raiz, "dhEmi"),
        "valor": _texto(raiz, "vNF"),
        "situacao": situacao,
        "caminho_xml": str(caminho),
        "tipo_xml": tipo,
    }


_SITUACAO_RESUMO = {"1": "100", "2": "110", "3": "101"}


def _dados_resumo(raiz, caminho: Path) -> dict | None:
    chave = _texto(raiz, "chNFe")
    if not chave:
        chave = caminho.name.split("-")[0]
    extra = _da_chave(chave)
    c_sit = _texto(raiz, "cSitNFe")
    situacao = _SITUACAO_RESUMO.get(c_sit, c_sit)
    return {
        "chave": chave,
        "modelo": extra.get("modelo", "55"),
        "serie": extra.get("serie", ""),
        "numero": extra.get("numero", ""),
        "emitida_em": _texto(raiz, "dhEmi"),
        "valor": _texto(raiz, "vNF"),
        "situacao": situacao,
        "caminho_xml": str(caminho),
        "tipo_xml": "resNFe",
    }


def _dados_evento(raiz, caminho: Path) -> dict | None:
    chave = _texto(raiz, "chNFe")
    if not chave:
        chave = caminho.name.split("-")[0]
    extra = _da_chave(chave)
    tp = _texto(raiz, "tpEvento")
    seq = _texto(raiz, "nSeqEvento") or "1"
    return {
        "chave": chave,
        "modelo": extra.get("modelo", "55"),
        "serie": "",
        "numero": "",
        "emitida_em": _texto(raiz, "dhEvento") or _texto(raiz, "dhRegEvento"),
        "valor": "",
        "situacao": tp,
        "caminho_xml": str(caminho),
        "tipo_xml": etree.QName(raiz).localname,
        "evento": f"{tp}-{seq}" if tp else seq,
    }

