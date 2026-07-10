import asyncio
import base64
import io

from PIL import Image

from app.segment.backends import BACKENDS, MockBackend
from app.segment.cutout import cut_part
from app.segment.schemas import Box, PartPrompt, Point


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def solid(w, h, color=(200, 80, 30, 255)) -> bytes:
    return png_bytes(Image.new("RGBA", (w, h), color))


def decode(data_url: str) -> Image.Image:
    b64 = data_url.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(b64)))


def test_mock_backend_masks_the_box():
    prompt = PartPrompt(name="p", points=[], box=Box(x0=10, y0=20, x1=40, y1=60))
    mask_png = asyncio.run(MockBackend().mask(solid(100, 100), prompt))
    mask = Image.open(io.BytesIO(mask_png)).convert("L")
    assert mask.size == (100, 100)
    assert mask.getpixel((25, 40)) > 200  # inside box
    assert mask.getpixel((5, 5)) < 50  # outside


def test_mock_backend_without_box_circles_the_points():
    prompt = PartPrompt(name="p", points=[Point(x=50, y=50, label=1)], box=None)
    mask_png = asyncio.run(MockBackend().mask(solid(100, 100), prompt))
    mask = Image.open(io.BytesIO(mask_png)).convert("L")
    assert mask.getpixel((50, 50)) > 200


def test_cut_part_crops_to_mask_bbox_with_origin():
    image = solid(100, 100)
    mask_img = Image.new("L", (100, 100), 0)
    for x in range(10, 40):
        for y in range(20, 60):
            mask_img.putpixel((x, y), 255)
    cut = cut_part(image, png_bytes(mask_img), "torso")
    assert cut is not None
    assert (cut.x, cut.y, cut.width, cut.height) == (10, 20, 30, 40)
    out = decode(cut.image)
    assert out.size == (30, 40)
    assert out.getpixel((0, 0))[3] == 255  # inside mask keeps alpha
    # empty mask yields no part
    assert cut_part(image, png_bytes(Image.new("L", (100, 100), 0)), "x") is None


def test_backends_registry():
    assert set(BACKENDS) == {"fal", "mock"}
    assert BACKENDS["mock"].approx_cost_usd == 0.0


def test_fal_backend_maps_prompts_and_decodes_data_uri(monkeypatch):
    import app.segment.backends as bk

    captured: dict = {}
    mask_b64 = base64.b64encode(png_bytes(Image.new("L", (10, 10), 255))).decode()

    class FakeRes:
        def json(self):
            return {"image": {"url": f"data:image/png;base64,{mask_b64}"}}

    async def fake_post(url, headers, payload, timeout=180):
        captured.update(url=url, headers=headers, payload=payload, timeout=timeout)
        return FakeRes()

    monkeypatch.setattr(bk, "http_post_json", fake_post)
    prompt = PartPrompt(
        name="p",
        points=[Point(x=5, y=6, label=1), Point(x=1, y=2, label=0)],
        box=Box(x0=0, y0=0, x1=9, y1=9),
    )
    out = asyncio.run(bk.FalSam2Backend().with_key("k123").mask(solid(10, 10), prompt))
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
    assert captured["headers"]["authorization"] == "Key k123"
    assert captured["timeout"] == 60
    assert captured["payload"]["prompts"] == [
        {"x": 5, "y": 6, "label": 1},
        {"x": 1, "y": 2, "label": 0},
    ]
    assert captured["payload"]["box_prompts"] == [{"x_min": 0, "y_min": 0, "x_max": 9, "y_max": 9}]
    assert captured["payload"]["image_url"].startswith("data:image/png;base64,")
