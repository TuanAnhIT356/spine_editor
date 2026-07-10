import asyncio
import base64
import io

from PIL import Image

from app.providers import PROVIDERS
from app.providers.mock import MockProvider
from app.providers.openai import OpenAIProvider
from app.providers.stability import StabilityProvider


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def solid(w=64, h=64, color=(200, 80, 30, 255)) -> bytes:
    return png_bytes(Image.new("RGBA", (w, h), color))


def test_capability_flags():
    assert getattr(PROVIDERS["stability"], "supports_inpaint", False) is True
    assert getattr(PROVIDERS["openai"], "supports_edit", False) is True
    assert getattr(PROVIDERS["mock"], "supports_inpaint", False) is True
    assert getattr(PROVIDERS["mock"], "supports_edit", False) is True
    assert getattr(PROVIDERS["fal"], "supports_inpaint", False) is False


def test_mock_inpaint_fills_masked_area_deterministically():
    image = solid()
    mask = Image.new("L", (64, 64), 0)
    for x in range(20, 40):
        for y in range(20, 40):
            mask.putpixel((x, y), 255)
    out1 = asyncio.run(MockProvider().inpaint("mock", image, png_bytes(mask), "p"))
    out2 = asyncio.run(MockProvider().inpaint("mock", image, png_bytes(mask), "p"))
    assert out1 == out2
    result = Image.open(io.BytesIO(out1)).convert("RGBA")
    assert result.size == (64, 64)
    assert result.getpixel((30, 30))[3] == 255  # hole filled, opaque


def test_mock_edit_tints_by_prompt_and_keeps_size():
    ref = solid(48, 96)
    a = asyncio.run(MockProvider().edit("mock", ref, "head", "1024x1024", True))
    b = asyncio.run(MockProvider().edit("mock", ref, "torso", "1024x1024", True))
    assert a != b  # different prompt -> different tint
    assert Image.open(io.BytesIO(a)).size == (48, 96)


def test_stability_inpaint_payload(monkeypatch):
    import app.providers.stability as st

    captured = {}

    class FakeRes:
        status_code = 200
        content = b"\x89PNG\r\n\x1a\nfake"

    async def fake_post(url, headers, files, timeout=180):
        captured.update(url=url, headers=headers, files=files, timeout=timeout)
        return FakeRes()

    monkeypatch.setattr(st, "http_post_multipart", fake_post)
    out = asyncio.run(StabilityProvider().inpaint("k-stab", solid(), solid(), "fix it"))
    assert out == FakeRes.content
    assert captured["url"].endswith("/v2beta/stable-image/edit/inpaint")
    assert captured["headers"]["authorization"] == "Bearer k-stab"
    assert captured["headers"]["accept"] == "image/*"
    assert captured["files"]["prompt"] == (None, "fix it")
    assert captured["files"]["output_format"] == (None, "png")
    assert captured["files"]["image"][0] == "image.png"
    assert captured["files"]["mask"][0] == "mask.png"


def test_openai_edit_payload(monkeypatch):
    import app.providers.openai as oa

    captured = {}
    b64 = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()

    class FakeRes:
        status_code = 200

        def json(self):
            return {"data": [{"b64_json": b64}]}

    async def fake_post(url, headers, files, timeout=180):
        captured.update(url=url, headers=headers, files=files)
        return FakeRes()

    monkeypatch.setattr(oa, "http_post_multipart", fake_post)
    out = asyncio.run(OpenAIProvider().edit("k-oa", solid(), "isolate head", "1024x1024", True))
    assert out == b"\x89PNG\r\n\x1a\nfake"
    assert captured["url"] == "https://api.openai.com/v1/images/edits"
    assert captured["headers"]["authorization"] == "Bearer k-oa"
    assert captured["files"]["model"] == (None, "gpt-image-1.5")
    assert captured["files"]["prompt"] == (None, "isolate head")
    assert captured["files"]["size"] == (None, "1024x1024")
    assert captured["files"]["background"] == (None, "transparent")
    assert captured["files"]["image[]"][0] == "reference.png"


def test_providers_endpoint_reports_capabilities(auth_client):
    res = auth_client.get("/api/generate/providers")
    byname = {p["name"]: p for p in res.json()}
    assert byname["stability"]["supports_inpaint"] is True
    assert byname["openai"]["supports_edit"] is True
    assert byname["mock"]["supports_inpaint"] and byname["mock"]["supports_edit"]
    assert byname["runware"]["supports_inpaint"] is False
