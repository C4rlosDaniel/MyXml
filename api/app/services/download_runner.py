"""Executa o download SEFAZ em background na nuvem.

Cada nota é persistida assim que é baixada (Storage + tabela ``notes``), então
uma queda de conexão, um deploy ou o fim do tempo da etapa não perdem o que já
foi feito: a próxima execução continua de onde parou.
"""

from __future__ import annotations

import logging
import tempfile
import time
from datetime import date, datetime, time as dt_time, timedelta, timezone
from pathlib import Path

import requests

from app.config import settings

logger = logging.getLogger("myxml.download")


from app.services import certificate_vault
from app.services.supabase_client import get_supabase_admin, maybe_data
from core import excel, notas, sefaz_nfce


class TempoEsgotado(sefaz_nfce.ExecucaoCancelada):
    """A etapa atingiu o tempo máximo; a próxima continua de onde parou."""


# Tempo máximo de uma etapa. O download é retomável, então paramos antes de
# qualquer limite da plataforma e a próxima etapa continua de onde parou.
ORCAMENTO_SEGUNDOS = 9 * 60
INTERVALO_CANCELAMENTO = 5.0
INTERVALO_HEARTBEAT = 20.0
# Um job que não dá sinal de vida por este tempo é considerado interrompido.
SEGUNDOS_SEM_SINAL = 180

# Tradução de códigos SEFAZ para os rótulos do front (apenas apresentação).
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


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atualizar_job(job_id: str, **campos: object) -> None:
    campos.setdefault("atualizado_em", _agora())
    get_supabase_admin().from_("download_runs").update(campos).eq("id", job_id).execute()


def sem_sinal(valor: object, segundos: int) -> bool:
    if not valor:
        return True
    try:
        quando = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
    except ValueError:
        return True
    if quando.tzinfo is None:
        quando = quando.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - quando).total_seconds() > segundos


def marcar_interrompidas(company_id: str | None = None, segundos: int = SEGUNDOS_SEM_SINAL) -> int:
    """Marca jobs 'executando' que pararam de dar sinal como 'interrompido'."""
    client = get_supabase_admin()
    consulta = (
        client.from_("download_runs")
        .select("id, atualizado_em")
        .eq("status", "executando")
    )
    if company_id:
        consulta = consulta.eq("company_id", company_id)
    antigos = [
        linha
        for linha in (consulta.execute().data or [])
        if sem_sinal(linha.get("atualizado_em"), segundos)
    ]
    for linha in antigos:
        client.from_("download_runs").update({
            "status": "interrompido",
            "mensagem": "A execução anterior foi interrompida. Inicie novamente para "
            "continuar de onde parou.",
            "finished_at": _agora(),
            "atualizado_em": _agora(),
        }).eq("id", linha["id"]).eq("status", "executando").execute()
    return len(antigos)


def meses_do_periodo(inicio: date, fim: date) -> list[str]:
    """Prefixos AAMM (como aparecem na chave) de cada mês do período."""
    meses: list[str] = []
    atual = date(inicio.year, inicio.month, 1)
    while atual <= fim:
        meses.append(f"{atual:%y%m}")
        atual = (
            date(atual.year + 1, 1, 1)
            if atual.month == 12
            else date(atual.year, atual.month + 1, 1)
        )
    return meses


def _chaves_salvas(client, company_id: str, chaves: list[str]) -> set[str]:
    """Chaves que já têm XML guardado no Storage para esta empresa."""
    salvas: set[str] = set()
    for indice in range(0, len(chaves), 100):
        lote = chaves[indice:indice + 100]
        resposta = (
            client.from_("notes")
            .select("chave")
            .eq("company_id", company_id)
            .in_("chave", lote)
            .not_.is_("storage_path", "null")
            .execute()
        )
        salvas.update(str(linha["chave"]) for linha in (resposta.data or []))
    return salvas


def _mes_da_chave(chave: str) -> str | None:
    if len(chave) >= 6 and chave[2:6].isdigit():
        return f"20{chave[2:4]}-{chave[4:6]}"
    return None


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
    """Execução síncrona chamada por BackgroundTasks (retomável)."""
    client = get_supabase_admin()
    job = maybe_data(
        client.from_("download_runs")
        .select("id, company_id, user_id, periodo_ini, periodo_fim, status, baixadas")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if not job:
        return
    if job.get("status") != "executando":
        return

    # Segunda barreira: duas requisições concorrentes podem passar pela checagem
    # do router ao mesmo tempo. A SEFAZ devolve 656 e pode bloquear o cliente.
    outro = (
        client.from_("download_runs")
        .select("id, atualizado_em")
        .eq("company_id", str(job["company_id"]))
        .eq("status", "executando")
        .neq("id", job_id)
        .execute()
        .data
        or []
    )
    outro_ativo = [linha for linha in outro if not sem_sinal(linha.get("atualizado_em"), SEGUNDOS_SEM_SINAL)]
    if outro_ativo:
        _atualizar_job(
            job_id,
            status="falhou",
            mensagem="Já existia outro download em andamento para esta empresa. "
            "Tente novamente quando ele terminar.",
            finished_at=_agora(),
        )
        return

    inicio_execucao = time.monotonic()
    ultima_verificacao = 0.0
    ultimo_heartbeat = 0.0
    cancelado_cache = False
    progresso_atual = 5
    persistidas = 0
    salvas_antes = 0
    linhas: list[str] = []
    buffer: list[dict] = []
    resultado_final: dict[str, object] = {}

    try:
        if not job.get("periodo_ini") or not job.get("periodo_fim"):
            raise ValueError("Período da execução não informado.")

        start = datetime.fromisoformat(str(job["periodo_ini"])).date()
        end = datetime.fromisoformat(str(job["periodo_fim"])).date()
        inicio = datetime.combine(start, dt_time.min)
        fim = datetime.combine(end, dt_time.max)
        sefaz_nfce.validar_intervalo(inicio, fim)

        def _cancelado() -> bool:
            nonlocal ultima_verificacao, ultimo_heartbeat, cancelado_cache

            if time.monotonic() - inicio_execucao > ORCAMENTO_SEGUNDOS:
                raise TempoEsgotado()

            agora = time.monotonic()
            if agora - ultimo_heartbeat > INTERVALO_HEARTBEAT:
                _atualizar_job(job_id)
                ultimo_heartbeat = agora
            if agora - ultima_verificacao < INTERVALO_CANCELAMENTO:
                return cancelado_cache

            atual = maybe_data(
                client.from_("download_runs")
                .select("status")
                .eq("id", job_id)
                .maybe_single()
                .execute()
            )
            ultima_verificacao = agora
            cancelado_cache = not atual or atual.get("status") != "executando"
            return cancelado_cache

        def log(mensagem: str) -> None:
            if _cancelado():
                raise sefaz_nfce.ExecucaoCancelada()
            linhas.append(mensagem)
            if len(linhas) % 5 == 0:
                _atualizar_job(
                    job_id,
                    log="\n".join(linhas[-300:]),
                    baixadas=salvas_antes + persistidas,
                )

        def progresso(atual: int, total: int, _chave: str) -> None:
            nonlocal progresso_atual
            if _cancelado():
                raise sefaz_nfce.ExecucaoCancelada()
            percentual = 10 + int((atual / max(total, 1)) * 85)
            if percentual >= progresso_atual + 4 or percentual >= 99:
                progresso_atual = min(percentual, 99)
                _atualizar_job(
                    job_id,
                    progresso=progresso_atual,
                    baixadas=salvas_antes + persistidas,
                )

        def _flush() -> None:
            nonlocal persistidas
            if not buffer:
                return
            lote = {str(registro["chave"]): registro for registro in buffer}
            buffer.clear()
            client.from_("notes").upsert(
                list(lote.values()), on_conflict="company_id,chave"
            ).execute()
            persistidas += len(lote)

        def _flush_seguro() -> None:
            try:
                _flush()
            except Exception as exc:  # noqa: BLE001 - nunca esconde a falha original
                logger.warning("job %s: falha ao gravar lote final: %s", job_id, exc)

        def persistir(chave: str, caminho: Path) -> None:
            if _cancelado():
                raise sefaz_nfce.ExecucaoCancelada()

            dados = notas.dados_da_nota(caminho)
            if not dados or not dados.get("chave"):
                raise ValueError("XML da nota sem chave.")

            mes = _mes_da_chave(chave) or f"{start:%Y-%m}"
            arquivos = [caminho, *sorted(caminho.parent.glob(f"{chave}-evento-*.xml"))]
            caminho_xml = f"{job['company_id']}/{mes}/{caminho.name}"

            for arquivo in arquivos:
                destino = f"{job['company_id']}/{mes}/{arquivo.name}"
                try:
                    client.storage.from_(settings.storage_bucket).upload(
                        destino,
                        arquivo.read_bytes(),
                        {"upsert": "true", "content-type": "application/xml"},
                    )
                except Exception as exc:  # noqa: BLE001 - Storage é infra, não regra fiscal
                    if arquivo == caminho:
                        raise RuntimeError(
                            f"não foi possível guardar o XML da nota: {exc}"
                        ) from exc
                    linhas.append(f"# aviso: evento {arquivo.name} não foi guardado")

            buffer.append({
                "company_id": job["company_id"],
                "chave": dados["chave"],
                "numero": dados.get("numero", ""),
                "serie": dados.get("serie", ""),
                "modelo": dados.get("modelo", "65"),
                "emitida_em": dados.get("emitida_em") or None,
                "valor": _valor(dados.get("valor", "0")),
                "situacao": _situacao(dados.get("situacao", "")),
                "storage_path": caminho_xml,
            })
            if len(buffer) >= 5:
                _flush()

        _atualizar_job(
            job_id,
            status="executando",
            progresso=5,
            mensagem=None,
            finished_at=None,
            log="Iniciando download na nuvem...",
        )
        pfx_bytes, senha = certificate_vault.load(str(job["company_id"]))

        log(f"  Período: {inicio:%d/%m/%Y %H:%M} até {fim:%d/%m/%Y %H:%M}")
        log("  Falando com a SEFAZ... (pode levar alguns minutos)")
        cstat, motivo, chaves = sefaz_nfce.listar_chaves(
            pfx_bytes, senha, inicio, fim, log
        )
        if cstat not in ("100", "101", "107"):
            extra = sefaz_nfce.MOTIVOS.get(cstat, "ver nota técnica")
            raise sefaz_nfce.SefazErro(f"SEFAZ recusou: {cstat} - {motivo} ({extra})")

        if not chaves:
            log(f"  Nenhuma NFC-e emitida nesse período ({motivo or 'sem registros'}).")
            resultado_final = {
                "status": "concluido",
                "progresso": 100,
                "baixadas": 0,
                "ja_existiam": 0,
                "erros": 0,
                "mensagem": f"{cstat} - {motivo}".strip(" -"),
            }
        else:
            salvas = _chaves_salvas(client, str(job["company_id"]), chaves)
            salvas_antes = len(salvas)
            log(f"  {len(chaves)} nota(s) no período; {salvas_antes} já estavam salvas.")

            with tempfile.TemporaryDirectory(prefix="myxml-nfce-") as temp:
                try:
                    total, _ = sefaz_nfce.baixar_chaves(
                        pfx_bytes,
                        senha,
                        chaves,
                        Path(temp),
                        log,
                        progresso,
                        cancelado=_cancelado,
                        pular=salvas,
                        ao_baixar=persistir,
                    )
                finally:
                    _flush_seguro()

            disponiveis = salvas_antes + int(total["ok"])
            resultado_final = {
                "status": "concluido" if total["erro"] == 0 else "com_erros",
                "progresso": 100,
                "baixadas": disponiveis,
                "ja_existiam": int(total["ja_tinha"]),
                "erros": int(total["erro"]),
                "mensagem": f"{cstat} - {motivo}".strip(" -"),
            }

        _atualizar_job(
            job_id,
            log="\n".join(linhas[-300:]),
            finished_at=_agora(),
            **resultado_final,
        )
    except TempoEsgotado:
        _flush_seguro()
        _atualizar_job(
            job_id,
            status="interrompido",
            progresso=progresso_atual,
            baixadas=salvas_antes + persistidas,
            mensagem="O tempo desta etapa terminou. O download continua de onde parou.",
            log="\n".join(linhas[-300:]),
            finished_at=_agora(),
        )
        logger.info("job %s pausado para continuar depois", job_id)
    except sefaz_nfce.ExecucaoCancelada:
        _flush_seguro()
        # O endpoint /cancel já marcou o job como falhou. O que foi salvo fica.
        logger.info("job %s encerrado pelo usuário", job_id)
    except Exception as exc:  # noqa: BLE001 - traduz falha para o usuário
        _flush_seguro()
        if isinstance(exc, sefaz_nfce.SefazErro):
            mensagem = str(exc)
        elif isinstance(exc, (ValueError, LookupError)):
            mensagem = str(exc) or "Não foi possível iniciar o download."
        else:
            mensagem = "Não foi possível concluir o download. Tente novamente em instantes."
        logger.exception("job %s falhou", job_id)
        _atualizar_job(
            job_id,
            status="falhou",
            progresso=progresso_atual,
            baixadas=salvas_antes + persistidas,
            mensagem=mensagem,
            log="\n".join(linhas[-300:]),
            finished_at=_agora(),
        )
        _alertar_falha(job_id, f"{type(exc).__name__}: {exc}")


def gerar_excel(job_id: str) -> tuple[str, Path]:
    """Gera o .xlsx com o core original e devolve (nome, caminho temporário)."""
    client = get_supabase_admin()
    job = maybe_data(
        client.from_("download_runs")
        .select("company_id, periodo_ini, periodo_fim, user_id")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if not job:
        raise LookupError("Execução não encontrada.")
    if not job.get("periodo_ini") or not job.get("periodo_fim"):
        raise LookupError("Período da execução não encontrado.")

    start = datetime.fromisoformat(str(job["periodo_ini"])).date()
    end = datetime.fromisoformat(str(job["periodo_fim"])).date()
    inicio, fim = datetime.combine(start, dt_time.min), datetime.combine(end, dt_time.max)

    rows: list[dict] = []
    vistas: set[str] = set()
    for mes in meses_do_periodo(start, end):
        lote = (
            client.from_("notes")
            .select("chave, numero, serie, emitida_em, valor, situacao")
            .eq("company_id", job["company_id"])
            .like("chave", f"__{mes}%")
            .execute()
            .data
            or []
        )
        for linha in lote:
            chave = str(linha["chave"])
            if chave not in vistas:
                vistas.add(chave)
                rows.append(linha)

    company = maybe_data(
        client.from_("companies")
        .select("razao_social, cnpj")
        .eq("id", job["company_id"])
        .maybe_single()
        .execute()
    ) or {}

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
    if (start.year, start.month) == (end.year, end.month):
        nome = f"NFCe-{start:%Y-%m}.xlsx"
    else:
        nome = f"NFCe-{start:%Y-%m-%d}_a_{end:%Y-%m-%d}.xlsx"
    return nome, destino
