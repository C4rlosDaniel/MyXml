"""Busca de NFS-e no ADN em background (somente download/consulta).

Reaproveita o padrão do download de NFC-e: um job por empresa, progresso/log,
XMLs no Storage e last-NSU para não baixar duas vezes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import settings
from app.services import nfse_adn
from app.services.supabase_client import get_supabase_admin, maybe_data

logger = logging.getLogger("myxml.nfse")

TAMANHO_LOTE = 100  # NSUs por execução quando nsu_fim não é informado


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atualizar(job_id: str, **campos: object) -> None:
    get_supabase_admin().from_("nfse_download_runs").update(campos).eq("id", job_id).execute()


def executar(job_id: str) -> None:
    client = get_supabase_admin()
    job = maybe_data(
        client.from_("nfse_download_runs")
        .select("*")
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if not job:
        return

    def falhar(mensagem: str) -> None:
        _atualizar(job_id, status="falhou", mensagem=mensagem, finished_at=_agora())
        logger.error("job NFS-e %s falhou: %s", job_id, mensagem)

    if not settings.nfse_enabled:
        falhar("Módulo NFS-e desabilitado. Configure NFSE_ENABLED=true e o certificado A1.")
        return

    empresa = str(job["company_id"])
    outro = (
        client.from_("nfse_download_runs")
        .select("id")
        .eq("company_id", empresa)
        .eq("status", "executando")
        .neq("id", job_id)
        .limit(1)
        .execute()
        .data
    )
    if outro:
        falhar("Já existe uma busca NFS-e em andamento para esta empresa.")
        return

    try:
        _atualizar(job_id, status="executando", progresso=5, log="Consultando o ADN...")
        estado = maybe_data(
            client.from_("nfse_sync_state")
            .select("ultimo_nsu")
            .eq("company_id", empresa)
            .maybe_single()
            .execute()
        )
        ultimo = int(estado["ultimo_nsu"]) if estado else 0
        inicio = int(job.get("nsu_ini") or 0)
        inicio = max(inicio, ultimo + 1)
        fim = int(job.get("nsu_fim") or 0) or inicio + TAMANHO_LOTE - 1
        if fim < inicio:
            falhar("NSU final menor que o último NSU já baixado.")
            return

        cliente_adn = nfse_adn.AdnClient(empresa)
        linhas: list[str] = []
        baixadas = ja_existiam = erros = 0
        total = fim - inicio + 1

        def registrar(mensagem: str) -> None:
            linhas.append(mensagem)
            if len(linhas) % 5 == 0:
                _atualizar(job_id, log="\n".join(linhas[-100:]))

        for indice, nsu in enumerate(range(inicio, fim + 1), start=1):
            try:
                xml = cliente_adn.documento(nsu)
            except nfse_adn.AdnError as exc:
                if exc.status in (204, 404):
                    registrar(f"[{nsu}] sem documento")
                    continue
                raise
            documento = nfse_adn.interpretar_documento(xml, nsu)

            eventos = b""
            if documento.chave:
                try:
                    eventos = cliente_adn.eventos(documento.chave)
                except nfse_adn.AdnError:
                    eventos = b""  # eventos são complementares; não derrubam o job
            cancelada = documento.cancelada or nfse_adn.tem_cancelamento(eventos)

            caminho = f"{empresa}/nfse/{nsu}.xml"
            client.storage.from_(settings.storage_bucket).upload(
                caminho, xml, {"upsert": "true", "content-type": "application/xml"}
            )

            existente = maybe_data(
                client.from_("nfse_notes")
                .select("id")
                .eq("company_id", empresa)
                .eq("nsu", nsu)
                .maybe_single()
                .execute()
            )
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
            if existente:
                client.from_("nfse_notes").update(linha).eq("id", existente["id"]).execute()
                ja_existiam += 1
            else:
                client.from_("nfse_notes").insert(linha).execute()
                baixadas += 1

            registrar(f"[{nsu}] chave {documento.chave or 'sem chave'}")
            _atualizar(
                job_id,
                progresso=10 + int((indice / total) * 85),
                baixadas=baixadas,
                ja_existiam=ja_existiam,
            )

        client.from_("nfse_sync_state").upsert({
            "company_id": empresa,
            "ultimo_nsu": fim,
            "updated_at": _agora(),
        }).execute()

        _atualizar(
            job_id,
            status="concluido" if erros == 0 else "com_erros",
            progresso=100,
            baixadas=baixadas,
            ja_existiam=ja_existiam,
            erros=erros,
            mensagem=f"{baixadas} nota(s) nova(s) até o NSU {fim}.",
            log="\n".join(linhas[-100:]),
            finished_at=_agora(),
        )
    except Exception as exc:  # noqa: BLE001 - traduz falha para o usuário
        falhar(f"Falha na busca NFS-e: {type(exc).__name__}: {exc}")
