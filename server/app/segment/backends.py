"""Mask backends: SAM 2 via fal.ai (BYOK) and a free deterministic mock.

The protocol returns a black/white mask PNG the size of the input image;
`cutout.cut_part` does the rest. A local SAM backend can slot in later
without touching the API layer.
"""

import base64
import io
from typing import Protocol

from PIL import Image, ImageDraw

from ..providers.base import ProviderError, http_get_bytes, http_post_json
from .cutout import png_data_url
from .schemas import PartPrompt

FAL_SAM2_URL = "https://fal.run/fal-ai/sam2/image"


class SegmentBackend(Protocol):
    name: str
    approx_cost_usd: float

    async def mask(self, image_png: bytes, prompt: PartPrompt) -> bytes: ...


class MockBackend:
    """Free/offline: mask = the prompt box (or a circle around fg points)."""

    name = "mock"
    approx_cost_usd = 0.0

    async def mask(self, image_png: bytes, prompt: PartPrompt) -> bytes:
        size = Image.open(io.BytesIO(image_png)).size
        mask = Image.new("L", size, 0)
        draw = ImageDraw.Draw(mask)
        if prompt.box is not None:
            draw.rectangle((prompt.box.x0, prompt.box.y0, prompt.box.x1, prompt.box.y1), fill=255)
        else:
            fg = [(p.x, p.y) for p in prompt.points if p.label == 1]
            if fg:
                cx = sum(x for x, _ in fg) / len(fg)
                cy = sum(y for _, y in fg) / len(fg)
                r = max(max(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 for x, y in fg), 20)
                draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
        buf = io.BytesIO()
        mask.save(buf, format="PNG")
        return buf.getvalue()


class FalSam2Backend:
    """fal.ai fal-ai/sam2/image — point + box prompts, returns the mask image."""

    name = "fal"
    approx_cost_usd = 0.01

    def __init__(self) -> None:
        self._key = ""

    def with_key(self, key: str) -> "FalSam2Backend":
        b = FalSam2Backend()
        b._key = key
        return b

    async def mask(self, image_png: bytes, prompt: PartPrompt) -> bytes:
        payload: dict[str, object] = {
            "image_url": png_data_url(image_png),
            "prompts": [{"x": p.x, "y": p.y, "label": p.label} for p in prompt.points],
            "sync_mode": True,
            "output_format": "png",
        }
        if prompt.box is not None:
            payload["box_prompts"] = [
                {
                    "x_min": prompt.box.x0,
                    "y_min": prompt.box.y0,
                    "x_max": prompt.box.x1,
                    "y_max": prompt.box.y1,
                }
            ]
        res = await http_post_json(
            FAL_SAM2_URL, {"authorization": f"Key {self._key}"}, payload, timeout=60
        )
        image = res.json().get("image") or {}
        url = image.get("url")
        if not url:
            raise ProviderError("fal.ai SAM2 returned no mask image")
        if url.startswith("data:"):
            return base64.b64decode(url.split(",", 1)[1])
        return await http_get_bytes(url)


BACKENDS: dict[str, SegmentBackend] = {
    "fal": FalSam2Backend(),
    "mock": MockBackend(),
}
