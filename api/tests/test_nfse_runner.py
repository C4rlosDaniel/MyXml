"""Runner da NFS-e exercitado com um ADN e um Supabase simulados (sem rede).

Cobrem o que mais dói em produção: lote do ADN, retomada pelo último NSU,
404 no fim da fila, falha isolada sem perder o que já foi salvo, eventos de
cancelamento e cancelamento no meio do lote.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.services import nfse_adn, nfse_runner


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chave(nsu: int) -> str:
    return f"{nsu:050d}"


def _xml(nsu: int, dia: str = "2026-11-18T14:32:00") -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfse xmlns="http://www.portalfiscal.inf.br/nfse">
  <infNFSe>
    <chave>{_chave(nsu)}</chave>
    <nNFSe>{nsu}</nNFSe>
    <serie>1</serie>
    <dhEmi>{dia}</dhEmi>
    <valores><vLiq>10.50</vLiq></valores>
    <prest><CNPJ>30720420000103</CNPJ></prest>
    <toma><CNPJ>12345678000190</CNPJ></toma>
  </infNFSe>
</nfse>""".encode("utf-8")


def _evento(chave: str) -> bytes:
    return (
        f"<evento><chave>{chave}</chave><tpEvento>101101</tpEvento>"
        "<xDescricao>Cancelamento de NFS-e</xDescricao></evento>"
    ).encode("utf-8")


def _item(
    nsu: int,
    dia: str = "2026-11-18T14:32:00",
    *,
    chave: str | None = None,
    tipo_documento: str = "NFSE",
    tipo_evento: str = "",
) -> nfse_adn.ItemDfe:
    chave = chave or _chave(nsu)
    xml = _evento(chave) if tipo_documento == "EVENTO" else _xml(nsu, dia)
    return nfse_adn.ItemDfe(
        nsu=nsu,
        chave=chave,
        tipo_documento=tipo_documento,
        tipo_evento=tipo_evento,
        xml=xml,
    )


def _resposta(*itens: nfse_adn.ItemDfe) -> nfse_adn.RespostaDfe:
    return nfse_adn.RespostaDfe(status="DOCUMENTOS_LOCALIZADOS", itens=list(itens))


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    """Subconjunto do query builder do supabase-py usado pelo runner."""

    def __init__(self, tabelas: dict, tabela: str):
        self.tabelas = tabelas
        self.tabela = tabela
        self.op: str | None = None
        self.payload = None
        self.filtros: list[tuple[str, str, object]] = []
        self.single = False
        self.limite: int | None = None
        self.on_conflict: str | None = None

    def select(self, _colunas: str = "*"):
        self.op = "select"
        return self

    def insert(self, payload):
        self.op = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.op = "update"
        self.payload = payload
        return self

    def upsert(self, payload, on_conflict=None, **_kwargs):
        self.op = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def eq(self, coluna: str, valor):
        self.filtros.append(("eq", coluna, valor))
        return self

    def neq(self, coluna: str, valor):
        self.filtros.append(("neq", coluna, valor))
        return self

    def limit(self, n: int):
        self.limite = n
        return self

    def maybe_single(self):
        self.single = True
        return self

    def _casa(self, linha: dict) -> bool:
        for operacao, coluna, valor in self.filtros:
            if operacao == "eq" and linha.get(coluna) != valor:
                return False
            if operacao == "neq" and linha.get(coluna) == valor:
                return False
        return True

    def execute(self) -> FakeResponse:
        linhas = self.tabelas.setdefault(self.tabela, [])
        encontradas = [linha for linha in linhas if self._casa(linha)]

        if self.op == "select":
            if self.single:
                return FakeResponse(dict(encontradas[0]) if encontradas else None)
            if self.limite is not None:
                encontradas = encontradas[: self.limite]
            return FakeResponse([dict(linha) for linha in encontradas])

        if self.op == "insert":
            linha = dict(self.payload)
            linha.setdefault("id", f"{self.tabela}-{len(linhas) + 1}")
            linhas.append(linha)
            return FakeResponse([dict(linha)])

        if self.op == "update":
            for linha in encontradas:
                linha.update(self.payload)
            return FakeResponse([dict(linha) for linha in encontradas])

        if self.op == "upsert":
            chave = self.on_conflict or "id"
            for linha in linhas:
                if linha.get(chave) == self.payload.get(chave):
                    linha.update(self.payload)
                    return FakeResponse([dict(linha)])
            linha = dict(self.payload)
            linha.setdefault("id", f"{self.tabela}-{len(linhas) + 1}")
            linhas.append(linha)
            return FakeResponse([dict(linha)])

        raise AssertionError(f"operação inesperada: {self.op}")


class FakeStorage:
    def __init__(self):
        self.arquivos: dict[str, bytes] = {}
        self.bucket = ""
        self.falhar_apos: int | None = None
        self.envios = 0
        self.ao_enviar = None

    def from_(self, bucket: str):
        self.bucket = bucket
        return self

    def upload(self, caminho: str, conteudo: bytes, _opcoes=None):
        self.envios += 1
        if self.ao_enviar is not None:
            self.ao_enviar(self.envios)
        if self.falhar_apos is not None and self.envios > self.falhar_apos:
            raise RuntimeError("Storage indisponível")
        self.arquivos[f"{self.bucket}/{caminho}"] = conteudo
        return FakeResponse([{"path": caminho}])


class FakeClient:
    def __init__(self):
        self.tabelas: dict[str, list[dict]] = {}
        self.storage = FakeStorage()

    def from_(self, tabela: str) -> FakeQuery:
        return FakeQuery(self.tabelas, tabela)


class FakeAdnClient:
    respostas: dict[int, nfse_adn.RespostaDfe | Exception] = {}
    chamadas: list[int] = []

    def __init__(self, _empresa: str, _cnpj: str) -> None:
        pass

    def consultar(self, nsu: int, lote: bool = True) -> nfse_adn.RespostaDfe:
        assert lote is True
        FakeAdnClient.chamadas.append(nsu)
        valor = FakeAdnClient.respostas.get(nsu)
        if isinstance(valor, Exception):
            raise valor
        return valor or nfse_adn.RespostaDfe(status="NENHUM_DOCUMENTO_LOCALIZADO")


@pytest.fixture
def cenario(monkeypatch):
    fake = FakeClient()
    FakeAdnClient.chamadas = []
    FakeAdnClient.respostas = {}
    monkeypatch.setattr(nfse_runner, "get_supabase_admin", lambda: fake)
    monkeypatch.setattr(nfse_adn, "AdnClient", FakeAdnClient)
    monkeypatch.setattr(settings, "nfse_enabled", True)
    monkeypatch.setattr(nfse_runner, "_dormir", lambda *_args: None)
    return fake


def _job(fake: FakeClient, **campos) -> dict:
    fake.tabelas["companies"] = [{"id": "empresa-1", "cnpj": "30.720.420/0002-94"}]
    job = {
        "id": "job-1",
        "company_id": "empresa-1",
        "status": "executando",
        "nsu_ini": 1,
        "nsu_fim": 3,
        "atualizado_em": _agora(),
    }
    job.update(campos)
    fake.tabelas["nfse_download_runs"] = [job]
    return job


def test_baixa_o_lote_e_grava_o_ultimo_a_cada_item(cenario):
    _job(cenario)
    FakeAdnClient.respostas = {
        1: _resposta(
            _item(1),
            _item(2, "2026-11-17T08:00:00"),
        )
    }

    nfse_runner.executar("job-1")

    # O lote trouxe 1 e 2; a próxima consulta (3) veio vazia e encerrou.
    assert FakeAdnClient.chamadas == [1, 3]

    notas = cenario.tabelas["nfse_notes"]
    assert [nota["nsu"] for nota in notas] == [1, 2]
    assert notas[0]["situacao"] == "autorizada"
    assert notas[0]["storage_path"] == "empresa-1/nfse/1.xml"
    assert notas[0]["prestador_cnpj"] == "30720420000103"
    assert notas[0]["tomador_cnpj"] == "12345678000190"
    assert len(cenario.storage.arquivos) == 2

    # 404 é fim da fila: NÃO avança para 3. A próxima execução tenta o 3 de novo.
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 2

    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "concluido"
    assert job["baixadas"] == 2
    assert job["erros"] == 0
    assert job["progresso"] == 100
    assert "[1] baixada do dia 18/11/26" in job["log"]
    assert "baixada do dia 17/11/26" in job["log"]


def test_retoma_do_ultimo_nsu_salvo(cenario):
    _job(cenario, nsu_ini=0, nsu_fim=4)
    cenario.tabelas["nfse_sync_state"] = [
        {"company_id": "empresa-1", "ultimo_nsu": 2, "updated_at": _agora()}
    ]
    FakeAdnClient.respostas = {3: _resposta(_item(3))}

    nfse_runner.executar("job-1")

    assert FakeAdnClient.chamadas == [3, 4]
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 3
    assert [nota["nsu"] for nota in cenario.tabelas["nfse_notes"]] == [3]


def test_fim_da_fila_nao_avanca_o_ultimo_nsu(cenario):
    _job(cenario, nsu_ini=0, nsu_fim=10)
    cenario.tabelas["nfse_sync_state"] = [
        {"company_id": "empresa-1", "ultimo_nsu": 5, "updated_at": _agora()}
    ]

    nfse_runner.executar("job-1")

    assert FakeAdnClient.chamadas == [6]
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 5
    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "concluido"
    assert job["baixadas"] == 0
    assert "até o NSU 5" in job["mensagem"]
    assert "sem documentos novos" in job["log"]


def test_falha_isolada_para_no_nsu_e_preserva_o_que_ja_foi_salvo(cenario):
    _job(cenario)
    FakeAdnClient.respostas = {
        1: _resposta(_item(1)),
        2: nfse_adn.AdnError("tempo esgotado", 500),
    }

    nfse_runner.executar("job-1")

    # Duas tentativas no NSU 2 e o lote para; o NSU 3 fica para a próxima.
    assert FakeAdnClient.chamadas == [1, 2, 2]
    assert [nota["nsu"] for nota in cenario.tabelas["nfse_notes"]] == [1]
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 1

    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "com_erros"
    assert job["erros"] == 1
    assert "parou no NSU 2" in job["mensagem"]


def test_rejeicao_400_nao_fica_em_retry(cenario):
    _job(cenario)
    FakeAdnClient.respostas = {
        1: nfse_adn.AdnError("E2245: Não há procuração", 400)
    }

    nfse_runner.executar("job-1")

    assert FakeAdnClient.chamadas == [1]
    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "com_erros"
    assert "E2245" in job["log"]


def test_cancelamento_no_meio_do_lote_preserva_a_nota(cenario, monkeypatch):
    _job(cenario)
    FakeAdnClient.respostas = {1: _resposta(_item(1), _item(2))}
    # Sem a janela de 5s, o runner percebe o cancelamento logo após a 1ª nota.
    monkeypatch.setattr(nfse_runner, "INTERVALO_CANCELAMENTO", 0)

    def cancela_apos_primeiro(envios: int) -> None:
        if envios == 1:
            cenario.tabelas["nfse_download_runs"][0]["status"] = "falhou"

    cenario.storage.ao_enviar = cancela_apos_primeiro

    nfse_runner.executar("job-1")

    assert FakeAdnClient.chamadas == [1]
    assert [nota["nsu"] for nota in cenario.tabelas["nfse_notes"]] == [1]
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 1
    assert cenario.tabelas["nfse_download_runs"][0]["status"] == "falhou"


def test_falha_de_storage_nao_avanca_o_ultimo_nsu(cenario):
    _job(cenario)
    FakeAdnClient.respostas = {1: _resposta(_item(1), _item(2))}
    cenario.storage.falhar_apos = 1

    nfse_runner.executar("job-1")

    assert [nota["nsu"] for nota in cenario.tabelas["nfse_notes"]] == [1]
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 1
    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "com_erros"
    assert "parou no NSU 2" in job["mensagem"]


def test_evento_de_cancelamento_atualiza_a_nota_existente(cenario):
    _job(cenario, nsu_fim=2)
    cenario.tabelas["nfse_notes"] = [
        {
            "id": "nota-1",
            "company_id": "empresa-1",
            "nsu": 1,
            "chave": _chave(1),
            "situacao": "autorizada",
            "eventos": None,
            "storage_path": "empresa-1/nfse/1.xml",
        }
    ]
    FakeAdnClient.respostas = {
        1: _resposta(
            _item(1),
            _item(2, chave=_chave(1), tipo_documento="EVENTO", tipo_evento="101101"),
        )
    }

    nfse_runner.executar("job-1")

    notas = cenario.tabelas["nfse_notes"]
    assert len(notas) == 1
    assert notas[0]["situacao"] == "cancelada"
    assert "Cancelamento de NFS-e" in notas[0]["eventos"]
    assert any("eventos/" in caminho for caminho in cenario.storage.arquivos)
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 2


def test_evento_sem_nota_nao_derruba_o_lote(cenario):
    _job(cenario, nsu_fim=2)
    FakeAdnClient.respostas = {
        1: _resposta(
            _item(1, chave=_chave(9), tipo_documento="EVENTO", tipo_evento="101101"),
        )
    }

    nfse_runner.executar("job-1")

    assert cenario.tabelas["nfse_notes"] == []
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 1
    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "concluido"
    assert "sem nota correspondente" in job["log"]


def test_nota_cancelada_nao_volta_para_autorizada(cenario):
    _job(cenario, nsu_fim=1)
    cenario.tabelas["nfse_notes"] = [
        {
            "id": "nota-1",
            "company_id": "empresa-1",
            "nsu": 1,
            "chave": _chave(1),
            "situacao": "cancelada",
            "eventos": "<evento/>",
        }
    ]
    FakeAdnClient.respostas = {1: _resposta(_item(1))}

    nfse_runner.executar("job-1")

    notas = cenario.tabelas["nfse_notes"]
    assert len(notas) == 1
    assert notas[0]["situacao"] == "cancelada"
    assert cenario.tabelas["nfse_download_runs"][0]["ja_existiam"] == 1


def test_dps_nao_vira_nota_e_avanca_o_nsu(cenario):
    _job(cenario, nsu_fim=1)
    FakeAdnClient.respostas = {
        1: _resposta(
            nfse_adn.ItemDfe(
                nsu=1,
                chave="",
                tipo_documento="DPS",
                tipo_evento="",
                xml=b"<DPS><infDPS/></DPS>",
            )
        )
    }

    nfse_runner.executar("job-1")

    assert cenario.tabelas.get("nfse_notes", []) == []
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 1
    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "concluido"
    assert "DPS ignorado" in job["log"]


def test_sem_cnpj_nao_chama_o_adn(cenario):
    _job(cenario)
    cenario.tabelas["companies"] = []

    nfse_runner.executar("job-1")

    assert FakeAdnClient.chamadas == []
    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "falhou"
    assert "CNPJ" in job["mensagem"]


def test_intervalo_respeita_o_maximo_por_execucao():
    assert nfse_runner.calcular_intervalo(0, 0, 0) == (1, 100)
    assert nfse_runner.calcular_intervalo(10, 0, 0) == (11, 110)
    assert nfse_runner.calcular_intervalo(0, 1, 500) == (1, 100)
    assert nfse_runner.calcular_intervalo(0, 50, 60, maximo=5) == (50, 54)
    # Já passou do fim pedido: nada a fazer.
    assert nfse_runner.calcular_intervalo(10, 0, 5) == (11, 10)


def test_formata_e_detecta_job_sem_sinal():
    assert nfse_runner.formatar_data("2026-11-18T14:32:00") == "18/11/26"
    assert nfse_runner.formatar_data("2026-11-18T14:32:00-03:00") == "18/11/26"
    assert nfse_runner.formatar_data(None) == ""

    agora = datetime.now(timezone.utc)
    assert nfse_runner.sem_sinal(agora.isoformat(), 180) is False
    assert nfse_runner.sem_sinal((agora - timedelta(minutes=5)).isoformat(), 180) is True
    assert nfse_runner.sem_sinal(None, 180) is True
