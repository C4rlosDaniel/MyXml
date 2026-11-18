"""Orquestra o download de um periodo e monta o zip do mes."""

from __future__ import annotations

import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from . import sefaz_nfce
from .sefaz_nfce import Log, Progresso


@dataclass
class ResultadoDownload:
    cnpj: str
    razao_social: str
    inicio: datetime
    fim: datetime
    pasta: Path
    cstat: str = ""
    motivo: str = ""
    ok: int = 0
    ja_tinha: int = 0
    erro: int = 0
    chaves: list[str] = field(default_factory=list)
    zip_path: Path | None = None
    aviso: str = ""

    @property
    def total_encontrado(self) -> int:
        return len(self.chaves)

    @property
    def sucesso(self) -> bool:
        return self.cstat in ("100", "101", "107") and self.erro == 0


def _nome_zip(inicio: datetime, fim: datetime) -> str:
    if (inicio.year, inicio.month) == (fim.year, fim.month):
        return f"NFCe-{inicio:%Y-%m}.zip"
    return f"NFCe-{inicio:%Y-%m-%d}_a_{fim:%Y-%m-%d}.zip"


def pasta_do_mes(base: Path, inicio: datetime, fim: datetime) -> Path:
    """Subpasta do mês/período onde ficam XMLs e arquivos do download."""
    if (inicio.year, inicio.month) == (fim.year, fim.month):
        return base / f"{inicio:%Y-%m}"
    return base / f"{inicio:%Y-%m-%d}_a_{fim:%Y-%m-%d}"


def gerar_zip(
    pasta: Path, inicio: datetime, fim: datetime, *, manter_xmls: bool = True
) -> Path | None:
    xmls = sorted(pasta.glob("*.xml"))
    if not xmls:
        return None
    destino = pasta / _nome_zip(inicio, fim)
    if destino.exists():
        try:
            destino.unlink()
        except OSError:
            pass
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as arquivo:
        for xml in xmls:
            arquivo.write(xml, xml.name)
    if not manter_xmls:
        for xml in xmls:
            try:
                xml.unlink()
            except OSError:
                pass
    return destino


def baixar_periodo(
    *,
    cnpj: str,
    razao_social: str,
    pfx_bytes: bytes,
    senha: str,
    inicio: datetime,
    fim: datetime,
    pasta: Path,
    log: Log = print,
    progresso: Progresso | None = None,
    gerar_zip_arquivo: bool = True,
    somente_listar: bool = False,
) -> ResultadoDownload:
    sefaz_nfce.validar_intervalo(inicio, fim)
    pasta_mes = pasta_do_mes(pasta, inicio, fim)
    pasta.mkdir(parents=True, exist_ok=True)
    pasta_mes.mkdir(parents=True, exist_ok=True)
    resultado = ResultadoDownload(
        cnpj=cnpj,
        razao_social=razao_social,
        inicio=inicio,
        fim=fim,
        pasta=pasta_mes,
    )

    log(f"  Periodo: {inicio:%d/%m/%Y %H:%M} ate {fim:%d/%m/%Y %H:%M}")
    log("  Falando com a SEFAZ... (pode levar alguns minutos)")
    cstat, motivo, chaves = sefaz_nfce.listar_chaves(
        pfx_bytes, senha, inicio, fim, log
    )
    resultado.cstat = cstat
    resultado.motivo = motivo
    resultado.chaves = chaves

    if cstat == "107" or (cstat in ("100", "101") and not chaves):
        log(f"  Nenhuma NFC-e emitida nesse periodo ({motivo or 'sem registros'}).")
        return resultado

    if cstat not in ("100", "101"):
        extra = sefaz_nfce.MOTIVOS.get(cstat, "ver nota tecnica")
        raise sefaz_nfce.SefazErro(f"SEFAZ recusou: {cstat} - {motivo} ({extra})")

    log(f"  {len(chaves)} nota(s) encontrada(s).")
    if somente_listar:
        for chave in chaves:
            log(f"     {chave}")
        return resultado

    log(f"  Pasta do mês: {pasta_mes}")
    log("  Baixando...")
    total, baixadas = sefaz_nfce.baixar_chaves(
        pfx_bytes, senha, chaves, pasta_mes, log, progresso
    )
    resultado.ok = total["ok"]
    resultado.ja_tinha = total["ja_tinha"]
    resultado.erro = total["erro"]

    if gerar_zip_arquivo:
        resultado.zip_path = gerar_zip(pasta_mes, inicio, fim, manter_xmls=True)

    return resultado
