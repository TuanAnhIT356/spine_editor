import base64
import io

from PIL import Image


def data_url(w=128, h=128) -> str:
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (90, 120, 40, 255)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_part_set_from_subject_generates_reference_and_ten_parts(auth_client):
    res = auth_client.post(
        "/api/generate/part-set",
        json={"provider": "mock", "subject": "a brave knight", "size": "256x256"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reference"].startswith("data:image/png;base64,")
    assert [p["name"] for p in body["parts"]] == [
        "head",
        "torso",
        "upper_arm_l",
        "lower_arm_l",
        "upper_arm_r",
        "lower_arm_r",
        "upper_leg_l",
        "lower_leg_l",
        "upper_leg_r",
        "lower_leg_r",
    ]
    assert body["warnings"] == []
    # the reference landed in the gallery
    gallery = auth_client.get("/api/generate").json()
    assert any("brave knight" in e["prompt"] for e in gallery)


def test_part_set_from_reference_skips_generation(auth_client):
    res = auth_client.post(
        "/api/generate/part-set",
        json={"provider": "mock", "reference": data_url(), "parts": ["head", "torso"]},
    )
    assert res.status_code == 200
    assert len(res.json()["parts"]) == 2


def test_part_set_requires_subject_xor_reference(auth_client):
    both = auth_client.post(
        "/api/generate/part-set",
        json={"provider": "mock", "subject": "x", "reference": data_url()},
    )
    neither = auth_client.post("/api/generate/part-set", json={"provider": "mock"})
    assert both.status_code == 400 and neither.status_code == 400


def test_part_set_guards(auth_client):
    no_edit = auth_client.post("/api/generate/part-set", json={"provider": "fal", "subject": "x"})
    assert no_edit.status_code == 400
    too_many = auth_client.post(
        "/api/generate/part-set",
        json={"provider": "mock", "reference": data_url(), "parts": [f"p{i}" for i in range(21)]},
    )
    assert too_many.status_code == 400
