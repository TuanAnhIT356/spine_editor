from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import ApiKey
from app.security import decrypt_secret


def test_key_vault_masks_and_encrypts(auth_client: TestClient) -> None:
    secret = "sk-test-abcdef1234567890wxyz"
    res = auth_client.put("/api/keys/openai", json={"key": secret})
    assert res.status_code == 200
    assert res.json() == {
        "provider": "openai",
        "last4": "wxyz",
        "created_at": res.json()["created_at"],
    }

    listed = auth_client.get("/api/keys").json()
    assert [k["provider"] for k in listed] == ["openai"]
    assert listed[0]["last4"] == "wxyz"
    assert all(secret not in str(v) for k in listed for v in k.values())  # never echoed

    # Encrypted at rest, decryptable server-side (for Phase 12 adapters).
    with SessionLocal() as db:
        # Filter by last4 — other test users may also have stored openai keys.
        record = db.scalar(
            select(ApiKey).where(ApiKey.provider == "openai", ApiKey.last4 == "wxyz")
        )
        assert secret not in record.key_encrypted
        assert decrypt_secret(record.key_encrypted) == secret

    # Overwrite rotates the stored key.
    auth_client.put("/api/keys/openai", json={"key": "sk-other-key-9999"})
    assert auth_client.get("/api/keys").json()[0]["last4"] == "9999"

    assert auth_client.delete("/api/keys/openai").status_code == 204
    assert auth_client.get("/api/keys").json() == []


def test_settings_round_trip(auth_client: TestClient) -> None:
    assert auth_client.get("/api/settings").json() == {}
    payload = {"theme": "dark", "defaultProvider": "openai", "gen": {"size": 1024}}
    assert auth_client.put("/api/settings", json=payload).json() == payload
    assert auth_client.get("/api/settings").json() == payload


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json()["status"] == "ok"
