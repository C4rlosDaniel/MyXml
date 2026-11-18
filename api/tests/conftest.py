import os

os.environ.setdefault("MOCK_MODE", "true")
os.environ.setdefault("CERT_ENCRYPTION_KEY", "test-key-only")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)
