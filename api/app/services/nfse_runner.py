"""Busca de NFS-e no ADN em background (somente download/consulta).

Mesmo padrão do download de NFC-e: cada nota é salva na hora (Storage + banco),
o último NSU é gravado após cada documento e a busca pode ser retomada de onde
parou. Uma falha isolada não apaga o que já foi baixado: o job para no NSU
problemático e a próxima execução recomeça exatamente dele.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from app.config import settings
from app.services import nfse_adn
from app.services.supabase_client import get_supabase_admin, maybe_data

logger = logging.getLogger("myxml.nfse")

TAMANHO_LOTE = 100
MAX_NSU_POR_EXECUCAO = 100
ORCAMENTO_SEGUNDOS = 9 * 60
INTERVALO_CANCELAMENTO = 5.0
INTERVALO_HEARTBEAT = 20.0
# Um job que não dá sinal de vida por este tempo é considerado interrompido.
SEGUNDOS_SEM_SINAL = 180


class TempoEsgotado(Exception):
    """A etapa atingiu o tempo máximo; a próxima continua de onde parou."""


class ExecucaoCancelada(Exception):
    """O usuário encerrou a busca."""


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atualizar(job_id: str, **campos: object) -> None:
    campos.setdefault("atualizado_em", _agora())
    get_supabase_admin().from_("nfse_download_runs").update(campos).eq("id", job_id).execute()


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


def marcar_interrompidas(
    company_id: str | None = None, segundos: int = SEGUNDOS_SEM_SINAL
) -> int:
    """Marca buscas 'executando' que pararam de dar sinal como 'interrompido'."""
    client = get_supabase_admin()
    consulta = (
        client.from_("nfse_download_runs")
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
        client.from_("nfse_download_runs").update({
            "status": "interrompido",
            "mensagem": "A busca anterior foi interrompida. Inicie novamente para "
            "continuar de onde parou.",
            "finished_at": _agora(),
            "atualizado_em": _agora(),
        }).eq("id", linha["id"]).eq("status", "executando").execute()
    return len(antigos)


def calcular_intervalo(
    ultimo_nsu: int,
    nsu_ini: int,
    nsu_fim: int,
    maximo: int = MAX_NSU_POR_EXECUCAO,
) -> tuple[int, int]:
    """Intervalo de NSUs desta execução, sem repetir o que já foi baixado."""
    inicio = max(int(ultimo_nsu or 0) + 1, int(nsu_ini or 0), 1)
    fim = int(nsu_fim or 0) or (inicio + TAMANHO_LOTE - 1)
    if fim < inicio:
        return inicio, inicio - 1
    if fim - inicio + 1 > maximo:
        fim = inicio + maximo - 1
    return inicio, fim


def formatar_data(valor: str | None) -> str:
    if not valor:
        return ""
    try:
        return datetime.fromisoformat(str(valor).replace("Z", "+00:00")).strftime("%d/%m/%y")
    except ValueError:
        return str(valor)[:10]


def _salvar_estado(client, empresa: str, nsu: int) -> None:
    client.from_("nfse_sync_state").upsert(
        {"company_id": empresa, "ultimo_nsu": nsu, "updated_at": _agora()},
        on_conflict="company_id",
    ).execute()


def _dormir(segundos: float, cancelado) -> None:
    limite = time.monotonic() + segundos
    while True:
        if cancelado():
            raise ExecucaoCancelada()
        restante = limite - time.monotonic()
        if restante <= 0:
            return
        time.sleep(min(restante, 1.0))


def _buscar_documento(cliente_adn, nsu: int, cancelado) -> bytes:
    """Duas tentativas para falhas transitórias; 204/404 seguem direto."""
    ultimo_erro: nfse_adn.AdnError | None = None
    for tentativa in range(1, 3):
        if cancelado():
            raise ExecucaoCancelada()
        try:
            return cliente_adn.documento(nsu)
        except nfse_adn.AdnError as exc:
            if exc.status in (204, 404):
                raise
            ultimo_erro = exc
            if tentativa < 2:
                _dormir(2.0 * tentativa, cancelado)
    assert ultimo_erro is not None
    raise ultimo_erro


def executar(job_id: str) -> None:
    client = get_supabase_admin()
    job = maybe_data(
        client.from_("nfse_download_runs")
        .select("*")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if not job or job.get("status") != "executando":
        return

    def falhar(mensagem: str) -> None:
        _atualizar(job_id, status="falhou", mensagem=mensagem, finished_at=_agora())
        logger.error("job NFS-e %s falhou: %s", job_id, mensagem)

    if not settings.nfse_enabled:
        falhar("Módulo NFS-e desabilitado.")
        return

    empresa = str(job["company_id"])
    outro = (
        client.from_("nfse_download_runs")
        .select("id, atualizado_em")
        .eq("company_id", empresa)
        .eq("status", "executando")
        .neq("id", job_id)
        .execute()
        .data
        or []
    )
    if any(
        not sem_sinal(linha.get("atualizado_em"), SEGUNDOS_SEM_SINAL)
        for linha in outro
    ):
        falhar("Já existe uma busca NFS-e em andamento para esta empresa.")
        return

    inicio_execucao = time.monotonic()
    ultima_verificacao = 0.0
    ultimo_heartbeat = 0.0
    cancelado_cache = False
    progresso_atual = 5
    baixadas = 0
    ja_existiam = 0
    erros = 0
    linhas: list[str] = []

    def _cancelado() -> bool:
        nonlocal ultima_verificacao, ultimo_heartbeat, cancelado_cache

        if time.monotonic() - inicio_execucao > ORCAMENTO_SEGUNDOS:
            raise TempoEsgotado()

        agora = time.monotonic()
        if agora - ultimo_heartbeat > INTERVALO_HEARTBEAT:
            _atualizar(job_id)
            ultimo_heartbeat = agora
        if agora - ultima_verificacao < INTERVALO_CANCELAMENTO:
            return cancelado_cache

        atual = maybe_data(
            client.from_("nfse_download_runs")
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
            raise ExecucaoCancelada()
        linhas.append(mensagem)
        if len(linhas) % 5 == 0:
            _atualizar(job_id, log="\n".join(linhas[-150:]))

    def atualizar_progresso(indice: int, total: int) -> None:
        nonlocal progresso_atual
        if _cancelado():
            raise ExecucaoCancelada()
        percentual = 10 + int((indice / max(total, 1)) * 85)
        if percentual >= progresso_atual + 4 or percentual >= 99:
            progresso_atual = min(percentual, 99)
            _atualizar(
                job_id,
                progresso=progresso_atual,
                baixadas=baixadas,
                ja_existiam=ja_existiam,
                erros=erros,
            )

    try:
        _atualizar(
            job_id,
            status="executando",
            progresso=5,
            mensagem=None,
            finished_at=None,
            log="Consultando o ADN...",
        )
        estado = maybe_data(
            client.from_("nfse_sync_state")
            .select("ultimo_nsu")
            .eq("company_id", empresa)
            .maybe_single()
            .execute()
        )
        ultimo = int(estado["ultimo_nsu"]) if estado else 0
        nsu_fim_solicitado = int(job.get("nsu_fim") or 0)
        inicio, fim = calcular_intervalo(
            ultimo, int(job.get("nsu_ini") or 0), nsu_fim_solicitado
        )
        if fim < inicio:
            _atualizar(
                job_id,
                status="concluido",
                progresso=100,
                mensagem="Nenhum NSU novo para buscar.",
                log="\n".join(linhas),
                finished_at=_agora(),
            )
            return

        log(f"  Buscando NSU {inicio} a {fim}...")
        if nsu_fim_solicitado and nsu_fim_solicitado > fim:
            log(f"  Limite de {MAX_NSU_POR_EXECUCAO} NSUs por busca; paramos no {fim}.")

        cliente_adn = nfse_adn.AdnClient(empresa)
        total = fim - inicio + 1
        ultimo_ok = ultimo
        parou_em: int | None = None

        for indice, nsu in enumerate(range(inicio, fim + 1), start=1):
            if _cancelado():
                raise ExecucaoCancelada()

            try:
                xml = _buscar_documento(cliente_adn, nsu, _cancelado)
            except nfse_adn.AdnError as exc:
                if exc.status in (204, 404):
                    log(f"[{nsu}] sem documento")
                    ultimo_ok = nsu
                    _salvar_estado(client, empresa, nsu)
                else:
                    erros += 1
                    log(f"[{nsu}] erro: {exc}")
                    parou_em = nsu
                    break
            else:
                try:
                    documento = nfse_adn.interpretar_documento(xml, nsu)
                except nfse_adn.AdnError as exc:
                    erros += 1
                    log(f"[{nsu}] XML inválido: {exc}")
                    parou_em = nsu
                    break

                eventos = b""
                if documento.chave:
                    try:
                        eventos = cliente_adn.eventos(documento.chave)
                    except nfse_adn.AdnError:
                        eventos = b""  # eventos são complementares

                cancelada = documento.cancelada or nfse_adn.tem_cancelamento(eventos)
                caminho = f"{empresa}/nfse/{nsu}.xml"
                try:
                    client.storage.from_(settings.storage_bucket).upload(
                        caminho,
                        xml,
                        {"upsert": "true", "content-type": "application/xml"},
                    )
                except Exception as exc:  # noqa: BLE001 - Storage é infraestrutura
                    erros += 1
                    logger.warning(
                        "job NFS-e %s: Storage falhou no NSU %s: %s", job_id, nsu, exc
                    )
                    log(f"[{nsu}] não foi possível guardar o XML")
                    parou_em = nsu
                    break

                linha = {
                    "company_id": empresa,
                    "nsu": nsu,
                    "chave": documento.chave or f"NSU-{nsu}",
                    "numero": documento.numero,
                    "serie": documento.serie,
                    "emitida_em": documento.emitida_em,
                    "valor": documento.valor,
                    "situacao": "cancelada" if cancelada else "autorizada",
                    "prestador_cnpj": documento.prestador_cnpj,
                    "tomador_cnpj": documento.tomador_cnpj,
                    "storage_path": caminho,
                    "eventos": eventos.decode("utf-8", errors="ignore") or None,
                    "updated_at": _agora(),
                }
                existente = maybe_data(
                    client.from_("nfse_notes")
                    .select("id")
                    .eq("company_id", empresa)
                    .eq("nsu", nsu)
                    .maybe_single()
                    .execute()
                )
                if existente:
                    client.from_("nfse_notes").update(linha).eq(
                        "id", existente["id"]
                    ).execute()
                    ja_existiam += 1
                else:
                    client.from_("nfse_notes").insert(linha).execute()
                    baixadas += 1

                # Só avança o "último NSU" depois que o XML e o registro estão salvos.
                ultimo_ok = nsu
                _salvar_estado(client, empresa, nsu)
                data = formatar_data(documento.emitida_em)
                log(f"[{nsu}] baixada do dia {data}" if data else f"[{nsu}] baixada")
                if cancelada:
                    log("        + cancelada")

            atualizar_progresso(indice, total)

        status_final = "concluido" if erros == 0 else "com_erros"
        mensagem = f"{baixadas} nota(s) nova(s) até o NSU {ultimo_ok}."
        if parou_em is not None:
            mensagem += (
                f" A busca parou no NSU {parou_em}; inicie novamente para continuar."
            )
        _atualizar(
            job_id,
            status=status_final,
            progresso=100,
            baixadas=baixadas,
            ja_existiam=ja_existiam,
            erros=erros,
            mensagem=mensagem,
            log="\n".join(linhas[-150:]),
            finished_at=_agora(),
        )
    except TempoEsgotado:
        _atualizar(
            job_id,
            status="interrompido",
            progresso=progresso_atual,
            baixadas=baixadas,
            ja_existiam=ja_existiam,
            erros=erros,
            mensagem="O tempo desta etapa terminou. A busca continua de onde parou.",
            log="\n".join(linhas[-150:]),
            finished_at=_agora(),
        )
        logger.info("job NFS-e %s pausado para continuar", job_id)
    except ExecucaoCancelada:
        logger.info("job NFS-e %s encerrado pelo usuário", job_id)
    except Exception as exc:  # noqa: BLE001 - traduz falha para o usuário
        logger.exception("job NFS-e %s falhou", job_id)
        _atualizar(
            job_id,
            status="falhou",
            progresso=progresso_atual,
            baixadas=baixadas,
            ja_existiam=ja_existiam,
            erros=erros,
            mensagem="Não foi possível concluir a busca. Tente novamente em instantes.",
            log="\n".join(linhas[-150:]),
            finished_at=_agora(),
        )
