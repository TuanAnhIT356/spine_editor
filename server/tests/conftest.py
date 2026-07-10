"""Test fixtures: an app instance backed by a temporary data dir + SQLite file.

Config is env-driven and imported at module load, so the env vars are set
before any `app.*` import happens (pytest imports conftest first).
"""

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="spine-server-test-")
os.environ["SPINE_SERVER_DATA_DIR"] = _tmp
os.environ["SPINE_SERVER_SECRET"] = "test-secret-not-for-production"
os.environ["SPINE_SERVER_AUTH_RATE_LIMIT"] = "1000"  # the suite registers many users

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture()
def auth_client(client: TestClient) -> TestClient:
    """A client registered + logged in as a fresh user (auth header pre-set)."""
    email = f"user{os.urandom(4).hex()}@example.com"
    res = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert res.status_code == 200, res.text
    client.headers["authorization"] = f"Bearer {res.json()['access_token']}"
    return client


def outbox_path() -> str:
    return os.path.join(_tmp, "outbox.log")
