import os


def register_and_login(client, email: str) -> str:
    client.post("/api/auth/register", json={"email": email, "password": "pw-123456"})
    res = client.post("/api/auth/login", json={"email": email, "password": "pw-123456"})
    return res.json()["access_token"]


def test_conversations_crud_and_title_default(auth_client):
    created = auth_client.post("/api/chat/conversations", json={}).json()
    assert created["title"] == "New chat"
    assert created["project_id"] is None

    listed = auth_client.get("/api/chat/conversations").json()
    assert created["id"] in [c["id"] for c in listed]

    msgs = auth_client.get(f"/api/chat/conversations/{created['id']}/messages").json()
    assert msgs == []

    assert auth_client.delete(f"/api/chat/conversations/{created['id']}").status_code == 200
    listed = auth_client.get("/api/chat/conversations").json()
    assert created["id"] not in [c["id"] for c in listed]


def test_conversations_filter_by_project(auth_client):
    proj = auth_client.post("/api/projects", json={"name": "p", "data": {}}).json()
    auth_client.post("/api/chat/conversations", json={"project_id": proj["id"]})
    auth_client.post("/api/chat/conversations", json={})
    scoped = auth_client.get(f"/api/chat/conversations?project_id={proj['id']}").json()
    assert len(scoped) >= 1
    assert all(c["project_id"] == proj["id"] for c in scoped)


def test_conversations_require_auth(client):
    res = client.get("/api/chat/conversations", headers={"authorization": "Bearer invalid-token"})
    assert res.status_code == 401


def test_foreign_conversation_is_404(auth_client, client):
    conv = auth_client.post("/api/chat/conversations", json={}).json()
    other = register_and_login(client, f"other{os.urandom(4).hex()}@example.com")
    res = client.get(
        f"/api/chat/conversations/{conv['id']}/messages",
        headers={"authorization": f"Bearer {other}"},
    )
    assert res.status_code == 404
