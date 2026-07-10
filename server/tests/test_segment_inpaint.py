import base64
import io

from PIL import Image

from app.segment.cutout import hole_mask


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def rect_mask(w, h, x0, y0, x1, y1) -> bytes:
    m = Image.new("L", (w, h), 0)
    for x in range(x0, x1):
        for y in range(y0, y1):
            m.putpixel((x, y), 255)
    return png_bytes(m)


def data_url(w=200, h=400) -> str:
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (120, 60, 20, 255)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_hole_mask_is_overlap_of_others_inside_bbox():
    target = rect_mask(100, 100, 10, 10, 60, 60)  # bbox (10,10,60,60)
    other = rect_mask(100, 100, 40, 40, 80, 80)  # overlaps 40..60
    hole = hole_mask(target, [other], (10, 10, 60, 60))
    assert hole is not None
    m = Image.open(io.BytesIO(hole)).convert("L")
    assert m.size == (50, 50)  # bbox-sized
    assert m.getpixel((35, 35)) > 200  # (45,45) in image coords -> hole
    assert m.getpixel((5, 5)) < 50  # (15,15) -> no other part there


def test_hole_mask_below_threshold_is_none():
    target = rect_mask(100, 100, 10, 10, 60, 60)
    tiny = rect_mask(100, 100, 10, 10, 15, 15)  # 25 px² < 200
    assert hole_mask(target, [tiny], (10, 10, 60, 60)) is None


def test_parts_with_mock_inpaint_marks_overlapping_parts(auth_client):
    res = auth_client.post(
        "/api/segment/parts",
        json={"image": data_url(), "backend": "mock", "inpaint": True, "inpaint_provider": "mock"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["warnings"] == []
    inpainted = [p["name"] for p in body["parts"] if p["inpainted"]]
    # mock masks are boxes; limbs overlap the torso box, so torso must be patched
    assert "torso" in inpainted


def test_inpaint_provider_without_capability_is_400(auth_client):
    res = auth_client.post(
        "/api/segment/parts",
        json={"image": data_url(), "backend": "mock", "inpaint": True, "inpaint_provider": "fal"},
    )
    assert res.status_code == 400


def test_inpaint_without_key_is_400(auth_client):
    res = auth_client.post(
        "/api/segment/parts",
        json={
            "image": data_url(),
            "backend": "mock",
            "inpaint": True,
            "inpaint_provider": "stability",
        },
    )
    assert res.status_code == 400
    assert "key" in res.json()["detail"].lower()
