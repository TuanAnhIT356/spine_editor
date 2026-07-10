import re

from conftest import outbox_path
from fastapi.testclient import TestClient

EMAIL = "alice@example.com"
PASSWORD = "correct-horse-9"


def register(client: TestClient, email: str = EMAIL, password: str = PASSWORD):
    return client.post("/api/auth/register", json={"email": email, "password": password})


def _replay_cookie(client: TestClient, value: str) -> None:
    """Make `value` the jar's only refresh cookie. Received cookies get the
    ".local" suffix http.cookiejar adds for dotless hosts — mirror that here."""
    client.cookies.clear()
    client.cookies.set("spine_refresh", value, domain="testserver.local", path="/api/auth")


def test_register_login_me(client: TestClient) -> None:
    res = register(client)
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["email"] == EMAIL
    assert "spine_refresh" in res.cookies

    assert register(client).status_code == 409  # duplicate email

    res = client.post("/api/auth/login", json={"email": EMAIL, "password": "wrong-password"})
    assert res.status_code == 401

    res = client.post("/api/auth/login", json={"email": EMAIL.upper(), "password": PASSWORD})
    assert res.status_code == 200
    access = res.json()["access_token"]

    res = client.get("/api/auth/me", headers={"authorization": f"Bearer {access}"})
    assert res.status_code == 200
    assert res.json()["email"] == EMAIL

    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"authorization": "Bearer bogus"}).status_code == 401


def test_password_must_be_long_enough(client: TestClient) -> None:
    res = register(client, email="short@example.com", password="short")
    assert res.status_code == 422


def test_refresh_rotates_and_logout_revokes(client: TestClient) -> None:
    register(client, email="bob@example.com")

    res = client.post("/api/auth/refresh")
    assert res.status_code == 200
    first_cookie = res.cookies.get("spine_refresh")

    # Rotation: refreshing again with the NEW cookie works…
    res = client.post("/api/auth/refresh")
    assert res.status_code == 200
    assert res.cookies.get("spine_refresh") != first_cookie

    # …but replaying the OLD (rotated-out) cookie is rejected.
    _replay_cookie(client, first_cookie)
    assert client.post("/api/auth/refresh").status_code == 401

    # Fresh login, then logout revokes the session server-side.
    res = client.post("/api/auth/login", json={"email": "bob@example.com", "password": PASSWORD})
    assert res.status_code == 200
    cookie = res.cookies.get("spine_refresh")
    assert client.post("/api/auth/logout").status_code == 204
    _replay_cookie(client, cookie)
    assert client.post("/api/auth/refresh").status_code == 401


def test_forgot_and_reset(client: TestClient) -> None:
    old_cookie = register(client, email="carol@example.com").cookies.get("spine_refresh")

    # Unknown email answers 202 the same way (no user enumeration).
    res = client.post("/api/auth/forgot", json={"email": "nobody@example.com"})
    assert res.status_code == 202

    res = client.post("/api/auth/forgot", json={"email": "carol@example.com"})
    assert res.status_code == 202
    with open(outbox_path()) as f:
        token = re.search(r"token=(\S+)", f.read().splitlines()[-1]).group(1)

    res = client.post("/api/auth/reset", json={"token": token, "password": "new-password-1"})
    assert res.status_code == 204
    assert (
        client.post("/api/auth/reset", json={"token": token, "password": "again-password"})
    ).status_code == 400  # single use

    res = client.post(
        "/api/auth/login", json={"email": "carol@example.com", "password": "new-password-1"}
    )
    assert res.status_code == 200

    # Old refresh sessions die with the reset.
    _replay_cookie(client, old_cookie)
    assert client.post("/api/auth/refresh").status_code == 401

    assert (
        client.post("/api/auth/reset", json={"token": "bogus", "password": "whatever-123"})
    ).status_code == 400
