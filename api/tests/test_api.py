from app.services import certificate_vault


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
