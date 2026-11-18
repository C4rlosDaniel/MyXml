"""Comunicacao com o SAE-NFC-e da SEFAZ-SP (producao).

Endpoints e formato SOAP conforme o servico oficial usado pelo
aplicativo original. Somente leitura: lista chaves e baixa XMLs.
"""

from __future__ import annotations

import calendar
import copy
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

import requests_pkcs12
from lxml import etree

try:  # usa o repositorio de certificados do Windows quando disponivel
    import truststore

    truststore.inject_into_ssl()
except Exception:  # pragma: no cover - opcional
    truststore = None  # type: ignore[assignment]

Log = Callable[[str], None]
Progresso = Callable[[int, int, str], None]

HOSTS = {
    1: "https://nfce.fazenda.sp.gov.br",
    2: "https://homologacao.nfce.fazenda.sp.gov.br",
}
AMBIENTE = 1  # 1 = producao
NS_NFE = "http://www.portalfiscal.inf.br/nfe"
NS_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/"
VERSAO = "1.00"
LIMITE_DIAS = 100
PAUSA = 0.5

MOTIVOS = {
    "203": "CNPJ da chave difere do CNPJ do certificado",
    "204": "chave da NFC-e invalida",
    "205": "chave nao encontrada",
    "207": "NFC-e emitida ha mais tempo que o limite de 100 dias",
    "656": "consumo indevido (excesso de chamadas por minuto)",
}

FORMATO_DATA_HORA = "%Y-%m-%dT%H:%M"


class SefazErro(Exception):
    """Falha de comunicacao ou recusa da SEFAZ."""


class PeriodoInvalido(Exception):
    """Periodo fora da janela permitida pela SEFAZ."""


# --------------------------------------------------------------------------
# Periodo
# --------------------------------------------------------------------------


def periodo_do_mes(escolha: str | None, hoje: datetime | None = None) -> tuple[datetime, datetime]:
    """Converte 'atual', 'anterior' ou 'AAAA-MM' em (inicio, fim)."""
    hoje = hoje or datetime.now()
    escolha = (escolha or "atual").strip().lower()

    if escolha in ("1", "atual"):
        ano, mes = hoje.year, hoje.month
    elif escolha in ("2", "anterior"):
        referencia = hoje.replace(day=1) - timedelta(days=1)
        ano, mes = referencia.year, referencia.month
    else:
        partes = escolha.split("-")
        if len(partes) != 2 or not all(p.isdigit() for p in partes):
            raise PeriodoInvalido(
                "Mes invalido. Use AAAA-MM, por exemplo 2026-10."
            )
        ano, mes = int(partes[0]), int(partes[1])
        if not 1 <= mes <= 12:
            raise PeriodoInvalido(
                "Mes invalido. Use AAAA-MM, por exemplo 2026-10."
            )

    inicio = datetime(ano, mes, 1)
    ultimo_dia = calendar.monthrange(ano, mes)[1]
    fim = datetime(ano, mes, ultimo_dia, 23, 59)

    limite = hoje - timedelta(days=LIMITE_DIAS)
    if inicio < limite:
        raise PeriodoInvalido(
            f"A SEFAZ so libera os ultimos {LIMITE_DIAS} dias "
            f"(a partir de {limite:%d/%m/%Y}).\n"
            f"O mes {ano:04d}-{mes:02d} esta fora desse limite."
        )
    if inicio > hoje:
        raise PeriodoInvalido(f"O mes {ano:04d}-{mes:02d} ainda nao comecou.")
    if fim > hoje:
        fim = hoje
    return inicio, fim


def validar_intervalo(inicio: datetime, fim: datetime, hoje: datetime | None = None) -> None:
    hoje = hoje or datetime.now()
    if fim < inicio:
        raise PeriodoInvalido("A data final e anterior a data inicial.")
    if inicio < hoje - timedelta(days=LIMITE_DIAS):
        raise PeriodoInvalido(
            f"A SEFAZ so libera os ultimos {LIMITE_DIAS} dias. "
            f"Escolha uma data a partir de {(hoje - timedelta(days=LIMITE_DIAS)):%d/%m/%Y}."
        )
    if inicio > hoje:
        raise PeriodoInvalido("A data inicial ainda nao chegou.")


def rotulo_periodo(inicio: datetime, fim: datetime) -> str:
    if (inicio.year, inicio.month) == (fim.year, fim.month) and inicio.day == 1:
        return f"{inicio:%m/%Y}"
    return f"{inicio:%d/%m/%Y} a {fim:%d/%m/%Y}"


# --------------------------------------------------------------------------
# XML / SOAP
# --------------------------------------------------------------------------


def envelope(servico: str, corpo: str) -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
        "<soap12:Body>"
        f'<nfeDadosMsg xmlns="{NS_WSDL}{servico}">'
        f"{corpo}"
        "</nfeDadosMsg>"
        "</soap12:Body>"
        "</soap12:Envelope>"
    )


def achar(raiz: etree._Element, tag: str) -> list[etree._Element]:
    return raiz.xpath(f"//*[local-name()='{tag}']")


def filho(elemento: etree._Element, tag: str) -> etree._Element | None:
    achados = elemento.xpath(f"./*[local-name()='{tag}']")
    return achados[0] if achados else None


def texto(elemento: etree._Element, tag: str) -> str:
    achados = elemento.xpath(f"//*[local-name()='{tag}']")
    if not achados or achados[0].text is None:
        return ""
    return achados[0].text.strip()


def gravar(caminho: Path, elemento: etree._Element) -> Path:
    limpo = copy.deepcopy(elemento)
    etree.cleanup_namespaces(limpo)
    caminho.write_bytes(
        etree.tostring(limpo, xml_declaration=True, encoding="UTF-8")
    )
    return caminho


def nfe_proc_limpo(proc: etree._Element) -> etree._Element:
    nfe = filho(proc, "NFe")
    prot = filho(proc, "protNFe")
    if nfe is None or prot is None:
        return proc
    novo = etree.Element(f"{{{NS_NFE}}}nfeProc", nsmap={None: NS_NFE})
    versao = nfe.get("versao") or proc.get("versao")
    if versao:
        novo.set("versao", versao)
    novo.append(nfe)
    novo.append(prot)
    return novo


def chamar(
    pfx_bytes: bytes,
    senha: str,
    servico: str,
    corpo: str,
    log: Log = print,
    tentativas: int = 4,
) -> etree._Element:
    url = f"{HOSTS[AMBIENTE]}/ws/{servico}.asmx"
    raiz: etree._Element | None = None

    for tentativa in range(1, tentativas + 1):
        try:
            resposta = requests_pkcs12.post(
                url,
                data=envelope(servico, corpo).encode("utf-8"),
                headers={"Content-Type": "application/soap+xml; charset=utf-8"},
                pkcs12_data=pfx_bytes,
                pkcs12_password=senha,
                timeout=60,
            )
        except Exception as erro:
            if tentativa == tentativas:
                raise SefazErro(
                    f"Nao consegui falar com a SEFAZ ({type(erro).__name__}): {erro}\n"
                    "Verifique a internet, o relogio do servidor e o certificado A1."
                ) from erro
            espera = 10 * tentativa
            log(f"# conexao interrompida. Tentando de novo em {espera}s...")
            time.sleep(espera)
            continue

        if resposta.status_code != 200:
            raise SefazErro(f"SEFAZ respondeu HTTP {resposta.status_code}.")
        try:
            raiz = etree.fromstring(resposta.content)
        except Exception as erro:
            raise SefazErro(
                "A SEFAZ retornou uma resposta inválida (não foi possível ler o XML). "
                "Tente novamente em instantes."
            ) from erro

        if texto(raiz, "cStat") != "656":
            return raiz

        espera = 15 * tentativa
        log(f"# SEFAZ pediu para ir mais devagar. Aguardando {espera}s...")
        time.sleep(espera)

    assert raiz is not None
    return raiz


# --------------------------------------------------------------------------
# Operacoes
# --------------------------------------------------------------------------


def listar_chaves(
    pfx_bytes: bytes,
    senha: str,
    inicio: datetime,
    fim: datetime,
    log: Log = print,
) -> tuple[str, str, list[str]]:
    """Lista as chaves de NFC-e do periodo (paginando de 60 em 60 dias)."""
    inicio_txt = inicio.strftime(FORMATO_DATA_HORA)
    fim_txt = fim.strftime(FORMATO_DATA_HORA)
    chaves: list[str] = []

    for _ in range(60):
        corpo = (
            f'<nfceListagemChaves xmlns="{NS_NFE}" versao="{VERSAO}">'
            f"<tpAmb>{AMBIENTE}</tpAmb>"
            f"<dataHoraInicial>{inicio_txt}</dataHoraInicial>"
            f"<dataHoraFinal>{fim_txt}</dataHoraFinal>"
            "</nfceListagemChaves>"
        )
        raiz = chamar(pfx_bytes, senha, "NFCeListagemChaves", corpo, log)
        cstat = texto(raiz, "cStat")
        motivo = texto(raiz, "xMotivo")
        novas = [el.text.strip() for el in achar(raiz, "chNFCe") if el.text]

        if cstat not in ("100", "101"):
            return cstat, motivo, []

        chaves.extend(novas)
        chaves = list(dict.fromkeys(chaves))
        if cstat == "100" or not novas:
            return cstat, motivo, chaves

        ultima = (texto(raiz, "dhEmisUltNfce") or "")[:16]
        if not ultima or ultima <= inicio_txt:
            return cstat, motivo, chaves
        inicio_txt = ultima

    return "101", "muitas paginas", chaves


def baixar_chaves(
    pfx_bytes: bytes,
    senha: str,
    chaves: list[str],
    saida: Path,
    log: Log = print,
    progresso: Progresso | None = None,
    pausa: float = PAUSA,
) -> tuple[dict[str, int], list[str]]:
    """Baixa os XMLs (e eventos) das chaves informadas."""
    total = {"ok": 0, "ja_tinha": 0, "erro": 0}
    baixadas: list[str] = []
    saida.mkdir(parents=True, exist_ok=True)

    for i, chave in enumerate(chaves, start=1):
        prefixo = f"[{i:>3}/{len(chaves)}]"
        destino = saida / f"{chave}-procNFCe.xml"

        if destino.exists() and destino.stat().st_size > 0:
            total["ja_tinha"] += 1
            log(f"{prefixo} ja tinha  {chave}")
        else:
            corpo = (
                f'<nfceDownloadXML xmlns="{NS_NFE}" versao="{VERSAO}">'
                f"<tpAmb>{AMBIENTE}</tpAmb>"
                f"<chNFCe>{chave}</chNFCe>"
                "</nfceDownloadXML>"
            )
            raiz = chamar(pfx_bytes, senha, "NFCeDownloadXML", corpo, log)
            cstat = texto(raiz, "cStat")
            motivo = texto(raiz, "xMotivo")

            if cstat != "200":
                extra = MOTIVOS.get(cstat, "ver nota tecnica")
                log(f"{prefixo} ERRO {chave}: {cstat} - {motivo} ({extra})")
                total["erro"] += 1
            else:
                procs = achar(raiz, "nfeProc")
                if not procs:
                    log(f"{prefixo} ERRO {chave}: retorno sem dados da nota")
                    total["erro"] += 1
                else:
                    gravar(destino, nfe_proc_limpo(procs[0]))
                    total["ok"] += 1
                    baixadas.append(chave)
                    log(f"{prefixo} baixada  {chave}")
                    for j, evento in enumerate(achar(raiz, "procEventoNFe"), start=1):
                        tipo_evento = texto(evento, "tpEvento") or str(j)
                        gravar(
                            saida / f"{chave}-evento-{tipo_evento}.xml", evento
                        )
                        log(f"            + evento {tipo_evento} (cancelamento/ajuste)")

        if progresso is not None:
            progresso(i, len(chaves), chave)
        if pausa:
            time.sleep(pausa)

    return total, baixadas
