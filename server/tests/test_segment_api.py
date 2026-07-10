import base64
import io

from PIL import Image


def data_url(w=200, h=400) -> str:
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (120, 60, 20, 255)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_segment_requires_auth(client):
    # Explicit invalid token: the shared session client may carry a previous
    # test's auth header (auth_client mutates it), so don't rely on ambient state.
    res = client.post(
        "/api/segment/pose",
        json={"image": data_url()},
        headers={"authorization": "Bearer invalid-token"},
    )
    assert res.status_code == 401


def test_backends_listing(auth_client):
    res = auth_client.get("/api/segment/backends")
    assert res.status_code == 200
    byname = {b["name"]: b for b in res.json()}
    assert byname["mock"]["has_key"] is True
    assert byname["fal"]["has_key"] is False  # no key stored in this fixture


def test_remove_bg_fake_passthrough(auth_client):
    img = data_url()
    res = auth_client.post("/api/segment/remove-bg", json={"image": img})
    assert res.status_code == 200
    assert res.json()["image"].startswith("data:image/png;base64,")


def test_pose_returns_ten_part_prompts(auth_client):
    res = auth_client.post("/api/segment/pose", json={"image": data_url()})
    assert res.status_code == 200
    body = res.json()
    assert body["width"] == 200 and body["height"] == 400
    assert len(body["parts"]) == 10
    assert body["parts"][0]["name"] == "head"


def test_parts_mock_end_to_end(auth_client):
    res = auth_client.post("/api/segment/parts", json={"image": data_url(), "backend": "mock"})
    assert res.status_code == 200
    parts = res.json()["parts"]
    assert len(parts) == 10
    for p in parts:
        assert p["image"].startswith("data:image/png;base64,")
        assert p["x"] >= 0 and p["y"] >= 0
        assert p["width"] > 0 and p["height"] > 0
        assert p["x"] + p["width"] <= 200 and p["y"] + p["height"] <= 400


def test_parts_fal_without_key_is_400(auth_client):
    res = auth_client.post("/api/segment/parts", json={"image": data_url(), "backend": "fal"})
    assert res.status_code == 400
    assert "key" in res.json()["detail"].lower()


def test_oversized_image_rejected(auth_client):
    res = auth_client.post("/api/segment/remove-bg", json={"image": data_url(5000, 100)})
    assert res.status_code == 400


def test_too_many_parts_rejected(auth_client):
    parts = [{"name": f"p{i}", "points": [{"x": 1, "y": 1, "label": 1}]} for i in range(21)]
    res = auth_client.post(
        "/api/segment/parts", json={"image": data_url(), "backend": "mock", "parts": parts}
    )
    assert res.status_code == 400
