from fastapi.testclient import TestClient


def test_providers_listing(auth_client: TestClient) -> None:
    providers = {p["name"]: p for p in auth_client.get("/api/generate/providers").json()}
    assert {"openai", "stability", "runware", "fal", "mock"} <= set(providers)
    assert providers["mock"]["has_key"] is True  # mock never needs a key
    assert providers["openai"]["has_key"] is False
    assert providers["openai"]["supports_transparent"] is True
    assert providers["stability"]["supports_transparent"] is False

    auth_client.put("/api/keys/openai", json={"key": "sk-test-1234"})
    providers = {p["name"]: p for p in auth_client.get("/api/generate/providers").json()}
    assert providers["openai"]["has_key"] is True


def test_generate_with_mock_provider(auth_client: TestClient) -> None:
    res = auth_client.post(
        "/api/generate",
        json={"provider": "mock", "prompt": "a knight", "size": "64x32", "transparent": True},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["data_url"].startswith("data:image/png;base64,")
    assert body["provider"] == "mock"

    # Gallery: entry listed without payload, full fetch has it, delete removes it.
    listed = auth_client.get("/api/generate").json()
    assert [e["prompt"] for e in listed] == ["a knight"]
    assert "data_url" not in listed[0]
    full = auth_client.get(f"/api/generate/{body['id']}").json()
    assert full["data_url"] == body["data_url"]
    assert auth_client.delete(f"/api/generate/{body['id']}").status_code == 204
    assert auth_client.get("/api/generate").json() == []


def test_generate_guards(auth_client: TestClient) -> None:
    # Unknown provider
    res = auth_client.post("/api/generate", json={"provider": "nope", "prompt": "x"})
    assert res.status_code == 400

    # Transparency not supported
    res = auth_client.post(
        "/api/generate", json={"provider": "stability", "prompt": "x", "transparent": True}
    )
    assert res.status_code == 400
    assert "transparent" in res.json()["detail"]

    # Missing key for a real provider
    res = auth_client.post(
        "/api/generate", json={"provider": "runware", "prompt": "x", "transparent": True}
    )
    assert res.status_code == 400
    assert "No API key" in res.json()["detail"]

    # Bad size string surfaces as a provider error, not a 500
    res = auth_client.post(
        "/api/generate", json={"provider": "mock", "prompt": "x", "size": "huge"}
    )
    assert res.status_code == 502


def test_gallery_is_per_user(auth_client: TestClient) -> None:
    auth_client.post("/api/generate", json={"provider": "mock", "prompt": "mine"})
    other = auth_client.post(
        "/api/auth/register", json={"email": "gen-other@example.com", "password": "password123"}
    ).json()["access_token"]
    headers = {"authorization": f"Bearer {other}"}
    assert auth_client.get("/api/generate", headers=headers).json() == []
