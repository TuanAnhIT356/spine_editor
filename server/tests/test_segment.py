import base64
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image


def data_url(img: Image.Image) -> str:
    out = BytesIO()
    img.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def decode(url: str) -> Image.Image:
    return Image.open(BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGBA")


def two_blob_sheet() -> Image.Image:
    """Transparent 120x80 canvas with two disjoint opaque rectangles."""
    img = Image.new("RGBA", (120, 80), (0, 0, 0, 0))
    for x in range(10, 40):
        for y in range(10, 40):
            img.putpixel((x, y), (255, 0, 0, 255))
    for x in range(70, 110):
        for y in range(30, 70):
            img.putpixel((x, y), (0, 0, 255, 255))
    return img


def test_split_parts(auth_client: TestClient) -> None:
    res = auth_client.post(
        "/api/segment/parts", json={"image": data_url(two_blob_sheet()), "min_area": 10}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["width"] == 120 and body["height"] == 80
    parts = body["parts"]
    assert len(parts) == 2
    # Sorted by area desc: the blue 40x40 blob first, red 30x30 second.
    assert (parts[0]["width"], parts[0]["height"]) == (40, 40)
    assert (parts[0]["x"], parts[0]["y"]) == (70, 30)
    assert (parts[1]["x"], parts[1]["y"]) == (10, 10)
    assert parts[0]["name"] == "part-1"
    cropped = decode(parts[0]["data_url"])
    assert cropped.size == (40, 40)
    assert cropped.getpixel((5, 5)) == (0, 0, 255, 255)

    # crop=False keeps the full canvas so centered imports preserve layout.
    res = auth_client.post(
        "/api/segment/parts",
        json={"image": data_url(two_blob_sheet()), "min_area": 10, "crop": False},
    )
    uncropped = decode(res.json()["parts"][0]["data_url"])
    assert uncropped.size == (120, 80)
    assert uncropped.getpixel((80, 40))[3] == 255  # blue blob present
    assert uncropped.getpixel((20, 20))[3] == 0  # red blob masked out


def test_remove_bg_local(auth_client: TestClient) -> None:
    img = Image.new("RGBA", (60, 60), (200, 200, 200, 255))  # flat grey backdrop
    for x in range(20, 40):
        for y in range(20, 40):
            img.putpixel((x, y), (10, 60, 200, 255))
    res = auth_client.post("/api/segment/remove-bg", json={"image": data_url(img)})
    assert res.status_code == 200
    out = decode(res.json()["data_url"])
    assert out.getpixel((2, 2))[3] == 0  # backdrop cleared
    assert out.getpixel((30, 30)) == (10, 60, 200, 255)  # subject intact


def test_pose_landmarks(auth_client: TestClient) -> None:
    img = Image.new("RGBA", (100, 200), (0, 0, 0, 0))
    for x in range(20, 80):
        for y in range(10, 190):
            img.putpixel((x, y), (255, 255, 255, 255))
    res = auth_client.post("/api/segment/pose", json={"image": data_url(img)})
    body = res.json()
    marks = body["landmarks"]
    assert set(marks) >= {"head", "neck", "hip", "hand_l", "foot_r"}
    assert body["bbox"] == {"x": 20, "y": 10, "width": 60, "height": 180}
    assert marks["head"]["x"] == 50.0  # centered horizontally
    assert marks["hip"]["y"] == round(10 + 0.52 * 180, 1)


def test_segment_guards(auth_client: TestClient) -> None:
    ok = data_url(Image.new("RGBA", (8, 8), (0, 0, 0, 0)))
    assert (
        auth_client.post("/api/segment/remove-bg", json={"image": "nonsense"})
    ).status_code == 400
    assert (
        auth_client.post("/api/segment/remove-bg", json={"image": ok, "provider": "nope"})
    ).status_code == 400
    # SAM requires prompts, and a fal key.
    assert (auth_client.post("/api/segment/sam", json={"image": ok})).status_code == 400
    res = auth_client.post("/api/segment/sam", json={"image": ok, "points": [{"x": 1, "y": 1}]})
    assert res.status_code == 400
    assert "fal" in res.json()["detail"]
