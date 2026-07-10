from fastapi.testclient import TestClient

PROJECT = {
    "name": "walker",
    "data": {
        "format": "spine-editor-project",
        "version": 1,
        "spine": {"skeleton": {"spine": "4.2"}, "bones": [{"name": "root"}]},
        "assets": [],
    },
    "thumbnail": "data:image/png;base64,AAA=",
}


def test_projects_crud(auth_client: TestClient) -> None:
    assert auth_client.get("/api/projects").json() == []

    res = auth_client.post("/api/projects", json=PROJECT)
    assert res.status_code == 201
    project = res.json()
    pid = project["id"]
    assert project["data"]["spine"]["bones"] == [{"name": "root"}]

    listed = auth_client.get("/api/projects").json()
    assert len(listed) == 1
    assert listed[0]["name"] == "walker"
    assert "data" not in listed[0]  # summaries stay light
    assert listed[0]["thumbnail"].startswith("data:image/png")

    res = auth_client.put(f"/api/projects/{pid}", json={"name": "runner"})
    assert res.status_code == 200
    res = auth_client.put(
        f"/api/projects/{pid}", json={"data": {**PROJECT["data"], "assets": [{"name": "arm"}]}}
    )
    assert res.status_code == 200

    full = auth_client.get(f"/api/projects/{pid}").json()
    assert full["name"] == "runner"
    assert full["data"]["assets"] == [{"name": "arm"}]

    assert auth_client.delete(f"/api/projects/{pid}").status_code == 204
    assert auth_client.get(f"/api/projects/{pid}").status_code == 404


def test_projects_are_per_user(auth_client: TestClient) -> None:
    pid = auth_client.post("/api/projects", json=PROJECT).json()["id"]

    # A second user cannot see or touch the first user's project.
    other = auth_client.post(
        "/api/auth/register", json={"email": "mallory@example.com", "password": "password123"}
    ).json()["access_token"]
    headers = {"authorization": f"Bearer {other}"}
    assert auth_client.get("/api/projects", headers=headers).json() == []
    assert auth_client.get(f"/api/projects/{pid}", headers=headers).status_code == 404
    assert auth_client.delete(f"/api/projects/{pid}", headers=headers).status_code == 404
    assert (
        auth_client.put(f"/api/projects/{pid}", json={"name": "stolen"}, headers=headers)
    ).status_code == 404


def test_projects_require_auth(client: TestClient) -> None:
    client.headers.pop("authorization", None)
    assert client.get("/api/projects").status_code == 401
