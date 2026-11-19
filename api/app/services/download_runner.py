"""Executa o download SEFAZ em background na nuvem.

Reaproveita o core original (sefaz_nfce/downloader/notas/excel) sem alterar
regras fiscais. A única adaptação é o destino dos arquivos: diretório temporário
+ Supabase Storage, em vez de Documentos do Windows.
"""

from __future__ import annotations

import logging
import tempfile
from datetime import datetime, time, timezone
from pathlib import Path

import requests

from app.config import settings

logger = logging.getLogger("myxml.download")
from app.services import certificate_vault
from app.services.supabase_client import get_supabase_admin
from core import downloader, excel, notas, sefaz_nfce

# Tradução de códigos SEFAZ para os rótulos do front (apenas apresentação).
# TODO: confirmar com o fiscal os códigos que mapeiam para cada estado.
_SITUACAO: dict[str, str] = {
    "100": "autorizada",
    "101": "cancelada",
    "110": "rejeitada",
    "301": "rejeitada",
    "302": "rejeitada",
}


def _situacao(codigo: str) -> str:
    return _SITUACAO.get(str(codigo).strip(), "enviada")


def _valor(raw: str) -> float:
    try:
        return float(str(raw or "0").replace(",", "."))
    except ValueError:
        return 0.0


def _atualizar_job(job_id: str, **campos: object) -> None:
    get_supabase_admin().from_("download_runs").update(campos).eq("id", job_id).execute()


def _alertar_falha(job_id: str, mensagem: str) -> None:
    """Webhook opcional de alerta. Sem URL configurada, apenas loga."""
    logger.error("job %s falhou: %s", job_id, mensagem)
    if not settings.alert_webhook_url:
        return
    try:
        requests.post(
            settings.alert_webhook_url,
            json={"job_id": job_id, "message": mensagem},
            timeout=5,
        )
    except Exception as exc:  # noqa: BLE001 - alerta não pode derrubar o job
        logger.warning("falha ao enviar alerta: %s", exc)


def executar(job_id: str) -> None:
    """Execução síncrona chamada por BackgroundTasks."""
    client = get_supabase_admin()
    job = (
        client.from_("download_runs")
        .select("id, company_id, user_id, periodo_ini, periodo_fim, progresso")
        .eq("id", job_id)
        .maybe_single()
        .execute()
        .data
    )
    if not job:
        return

    # Segunda barreira: duas requisições concorrentes podem passar pela checagem
    # do router ao mesmo tempo. A SEFAZ devolve 656 e pode bloquear o cliente.
    outro = (
        client.from_("download_runs")
        .select("id")
        .eq("company_id", str(job["company_id"]))
        .eq("status", "executando")
        .neq("id", job_id)
        .limit(1)
        .execute()
        .data
    )
    if outro:
        _atualizar_job(
            job_id,
            status="falhou",
            mensagem="Já existia outro download em andamento para esta empresa. "
            "Tente novamente quando ele terminar.",
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
        return

    try:
        _atualizar_job(job_id, status="executando", progresso=5, log="Iniciando download na nuvem...")
        pfx_bytes, senha = certificate_vault.load(str(job["company_id"]))

        start = datetime.fromisoformat(str(job["periodo_ini"])).date()
        end = datetime.fromisoformat(str(job["periodo_fim"])).date()
        inicio = datetime.combine(start, time.min)
        fim = datetime.combine(end, time.max)

        linhas: list[str] = []
        ultimo_progresso = -1

        def log(mensagem: str) -> None:
            linhas.append(mensagem)
            if len(linhas) % 5 == 0:
                _atualizar_job(job_id, log="\n".join(linhas[-100:]))

        def progresso(atual: int, total: int, _chave: str) -> None:
            nonlocal ultimo_progresso
            percentual = 10 + int((atual / max(total, 1)) * 70)
            if percentual // 10 != ultimo_progresso // 10:
                ultimo_progresso = percentual
                _atualizar_job(job_id, progresso=percentual)

        with tempfile.TemporaryDirectory(prefix="myxml-nfce-") as temp:
            pasta = Path(temp)
            resultado = downloader.baixar_periodo(
                cnpj="",
                razao_social="",
                pfx_bytes=pfx_bytes,
                senha=senha,
                inicio=inicio,
                fim=fim,
                pasta=pasta,
                log=log,
                progresso=progresso,
                gerar_zip_arquivo=True,
            )

            registros: list[dict] = []
            arquivos = sorted(pasta.rglob("*.xml"))
            for caminho in arquivos:
                dados = notas.dados_da_nota(caminho)
                if not dados or not dados.get("chave"):
                    continue
                registros.append({
                    "company_id": job["company_id"],
                    "chave": dados["chave"],
                    "numero": dados.get("numero", ""),
                    "serie": dados.get("serie", ""),
                    "modelo": dados.get("modelo", "65"),
                    "emitida_em": dados.get("emitida_em") or None,
                    "valor": _valor(dados.get("valor", "0")),
                    "situacao": _situacao(dados.get("situacao", "")),
                    "storage_path": f"{job['company_id']}/{start:%Y-%m}/{caminho.name}",
                })

            if registros:
                client.from_("notes").upsert(registros, on_conflict="company_id,chave").execute()

            bucket = settings.storage_bucket
            prefixo = f"{job['company_id']}/{start:%Y-%m}"
            for caminho in arquivos:
                caminho_storage = f"{prefixo}/{caminho.name}"
                try:
                    client.storage.from_(bucket).upload(
                        caminho_storage,
                        caminho.read_bytes(),
                        {"upsert": "true", "content-type": "application/xml"},
                    )
                except Exception as exc:  # noqa: BLE001 - Storage é infra, não regra fiscal
                    linhas.append(f"# aviso: não foi possível enviar {caminho.name}: {exc}")

            if resultado.zip_path and resultado.zip_path.exists():
                try:
                    client.storage.from_(bucket).upload(
                        f"{prefixo}/{resultado.zip_path.name}",
                        resultado.zip_path.read_bytes(),
                        {"upsert": "true", "content-type": "application/zip"},
                    )
                except Exception as exc:  # noqa: BLE001
                    linhas.append(f"# aviso: não foi possível enviar o ZIP: {exc}")

        status = "concluido" if resultado.sucesso else "com_erros"
        _atualizar_job(
            job_id,
            status=status,
            progresso=100,
            baixadas=resultado.ok,
            ja_existiam=resultado.ja_tinha,
            erros=resultado.erro,
            mensagem=f"{resultado.cstat} - {resultado.motivo}".strip(" -"),
            log="\n".join(linhas[-100:]),
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as exc:  # noqa: BLE001 - traduz falha para o usuário
        mensagem = f"Falha no download: {type(exc).__name__}: {exc}"
        _atualizar_job(
            job_id,
            status="falhou",
            mensagem=mensagem,
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
        _alertar_falha(job_id, mensagem)


def gerar_excel(job_id: str) -> tuple[str, Path]:
    """Gera o .xlsx com o core original e devolve (nome, caminho temporário)."""
    client = get_supabase_admin()
    job = (
        client.from_("download_runs")
        .select("company_id, periodo_ini, periodo_fim, user_id")
        .eq("id", job_id)
        .maybe_single()
        .execute()
        .data
    )
    if not job:
        raise LookupError("Execução não encontrada.")

    start = datetime.fromisoformat(str(job["periodo_ini"])).date()
    end = datetime.fromisoformat(str(job["periodo_fim"])).date()
    inicio, fim = datetime.combine(start, time.min), datetime.combine(end, time.max)

    rows = (
        client.from_("notes")
        .select("chave, numero, serie, emitida_em, valor, situacao")
        .eq("company_id", job["company_id"])
        .gte("emitida_em", start.isoformat())
        .lte("emitida_em", end.isoformat())
        .execute()
        .data
        or []
    )
    company = (
        client.from_("companies")
        .select("razao_social, cnpj")
        .eq("id", job["company_id"])
        .maybe_single()
        .execute()
        .data
        or {}
    )

    destino = Path(tempfile.gettempdir()) / f"myxml-{job_id}.xlsx"
    excel.exportar(
        destino,
        empresa_nome=str(company.get("razao_social", "")),
        cnpj=str(company.get("cnpj", "")),
        inicio=inicio,
        fim=fim,
        notas=list(rows),
        usuario=str(job.get("user_id", "")),
    )
    return destino.name, destino
