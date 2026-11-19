from fastapi import HTTPException

from app.config import settings
from app.services import admin_password, certificate_vault


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_licenses_mock(client):
    response = client.get("/licenses")
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_download_requires_supabase(client):
    response = client.post("/downloads", json={"company_id": "x", "period": "2026-11"})
    assert response.status_code == 501


def test_validation_does_not_crash(client):
    response = client.post("/downloads", json={})
    assert response.status_code in (422, 501)


def test_vault_roundtrip():
    token = certificate_vault.encrypt(b"pfx-de-teste")
    assert certificate_vault.decrypt(token) == b"pfx-de-teste"


class _FakeResponse:
    def __init__(self, status_code: int, user_id: str = "admin-id") -> None:
        self.status_code = status_code
        self._user_id = user_id

    def json(self) -> dict:
        return {"user": {"id": self._user_id}}


def test_admin_password_uses_direct_http(monkeypatch):
    """Não pode chamar sign_in_with_password no cliente admin compartilhado:
    isso troca o header para o token do usuário e quebra o RLS nas limpezas."""
    chamados: list[dict] = []

    def fake_post(url, **kwargs):
        chamados.append(kwargs)
        return _FakeResponse(200)

    monkeypatch.setattr(settings, "mock_mode", False)
    monkeypatch.setattr(admin_password.httpx, "post", fake_post)
    admin_password.verify({"id": "admin-id", "email": "admin@myxml.com.br"}, "admin123")

    assert len(chamados) == 1
    assert chamados[0]["json"]["password"] == "admin123"


def test_maybe_data_none():
    """maybe_single().execute() devolve None quando não há linha (sem .data)."""
    from app.services.supabase_client import maybe_data

    assert maybe_data(None) is None


def test_admin_password_wrong(monkeypatch):
    monkeypatch.setattr(settings, "mock_mode", False)
    monkeypatch.setattr(
        admin_password.httpx, "post", lambda *a, **k: _FakeResponse(401)
    )
    try:
        admin_password.verify({"id": "admin-id", "email": "admin@myxml.com.br"}, "errada")
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("senha errada deveria ser rejeitada")
