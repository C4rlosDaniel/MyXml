"""Runner da NFS-e exercitado com um ADN e um Supabase simulados (sem rede).

Cobrem o que mais dói em produção: retomada pelo último NSU, 204/404, falha
isolada sem perder o que já foi salvo e cancelamento no meio do lote.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.services import nfse_adn, nfse_runner


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _xml(nsu: int, dia: str = "2026-11-18T14:32:00") -> bytes:
    chave = f"{nsu:050d}"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfse xmlns="http://www.portalfiscal.inf.br/nfse">
  <chave>{chave}</chave>
  <nNFS>{nsu}</nNFS>
  <serie>1</serie>
  <dEmi>{dia}</dEmi>
  <vNFS>10.50</vNFS>
  <cnpjPrestador>30720420000103</cnpjPrestador>
  <cnpjTomador>12345678000190</cnpjTomador>
</nfse>""".encode("utf-8")


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

    def from_(self, bucket: str):
        self.bucket = bucket
        return self

    def upload(self, caminho: str, conteudo: bytes, _opcoes=None):
        self.envios += 1
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
    respostas: dict[int, bytes | Exception] = {}
    chamadas: list[int] = []

    def __init__(self, _empresa: str) -> None:
        pass

    def documento(self, nsu: int) -> bytes:
        FakeAdnClient.chamadas.append(nsu)
        valor = FakeAdnClient.respostas.get(
            nsu, nfse_adn.AdnError("sem documento", 404)
        )
        if isinstance(valor, Exception):
            raise valor
        return valor

    def eventos(self, _chave: str) -> bytes:
        return b"<eventos/>"


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


def test_baixa_os_nsus_e_grava_o_ultimo_a_cada_documento(cenario):
    _job(cenario)
    FakeAdnClient.respostas = {1: _xml(1), 2: _xml(2, "2026-11-17T08:00:00")}

    nfse_runner.executar("job-1")

    notas = cenario.tabelas["nfse_notes"]
    assert [nota["nsu"] for nota in notas] == [1, 2]
    assert notas[0]["situacao"] == "autorizada"
    assert notas[0]["storage_path"] == "empresa-1/nfse/1.xml"
    assert len(cenario.storage.arquivos) == 2

    # 204/404 também avança: não faz sentido pedir o mesmo NSU vazio de novo.
    estado = cenario.tabelas["nfse_sync_state"]
    assert estado == [
        {
            "id": "nfse_sync_state-1",
            "company_id": "empresa-1",
            "ultimo_nsu": 3,
            "updated_at": estado[0]["updated_at"],
        }
    ]

    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "concluido"
    assert job["baixadas"] == 2
    assert job["erros"] == 0
    assert job["progresso"] == 100
    assert "baixada do dia 17/11/26" in job["log"]
    assert "[1] baixada do dia 18/11/26" in job["log"]


def test_retoma_do_ultimo_nsu_salvo(cenario):
    _job(cenario, nsu_ini=0, nsu_fim=4)
    cenario.tabelas["nfse_sync_state"] = [
        {"company_id": "empresa-1", "ultimo_nsu": 2, "updated_at": _agora()}
    ]
    FakeAdnClient.respostas = {3: _xml(3)}

    nfse_runner.executar("job-1")

    assert FakeAdnClient.chamadas == [3, 4]
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 4
    assert [nota["nsu"] for nota in cenario.tabelas["nfse_notes"]] == [3]


def test_falha_isolada_para_no_nsu_e_preserva_o_que_ja_foi_salvo(cenario):
    _job(cenario)
    FakeAdnClient.respostas = {
        1: _xml(1),
        2: nfse_adn.AdnError("tempo esgotado", None),
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


def test_cancelamento_no_meio_do_lote_preserva_a_nota(cenario, monkeypatch):
    _job(cenario)
    FakeAdnClient.respostas = {1: _xml(1), 2: _xml(2)}
    # Sem a janela de 5s, o runner percebe o cancelamento logo após a 1ª nota.
    monkeypatch.setattr(nfse_runner, "INTERVALO_CANCELAMENTO", 0)

    documento_original = FakeAdnClient.documento

    def documento_e_cancela(self, nsu: int) -> bytes:
        xml = documento_original(self, nsu)
        cenario.tabelas["nfse_download_runs"][0]["status"] = "falhou"
        return xml

    monkeypatch.setattr(FakeAdnClient, "documento", documento_e_cancela)

    nfse_runner.executar("job-1")

    assert FakeAdnClient.chamadas == [1]
    assert [nota["nsu"] for nota in cenario.tabelas["nfse_notes"]] == [1]
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 1
    assert cenario.tabelas["nfse_download_runs"][0]["status"] == "falhou"


def test_falha_de_storage_nao_avanca_o_ultimo_nsu(cenario):
    _job(cenario)
    FakeAdnClient.respostas = {1: _xml(1), 2: _xml(2)}
    cenario.storage.falhar_apos = 1

    nfse_runner.executar("job-1")

    assert [nota["nsu"] for nota in cenario.tabelas["nfse_notes"]] == [1]
    assert cenario.tabelas["nfse_sync_state"][0]["ultimo_nsu"] == 1
    job = cenario.tabelas["nfse_download_runs"][0]
    assert job["status"] == "com_erros"
    assert "parou no NSU 2" in job["mensagem"]


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
