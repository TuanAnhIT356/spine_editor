"""OpenAI image generation (gpt-image-1.5 — the newest model that still
supports `background: transparent`; gpt-image-2 rejects it)."""

import base64

from .base import ProviderError, http_post_json, http_post_multipart


class OpenAIProvider:
    name = "openai"
    supports_transparent = True
    supports_edit = True
    approx_cost_usd = 0.07

    async def edit(
        self, key: str, image_png: bytes, prompt: str, size: str, transparent: bool
    ) -> bytes:
        files: dict[str, tuple] = {
            "model": (None, "gpt-image-1.5"),
            "image[]": ("reference.png", image_png, "image/png"),
            "prompt": (None, prompt),
            "size": (None, size),
            "output_format": (None, "png"),
        }
        if transparent:
            files["background"] = (None, "transparent")
        res = await http_post_multipart(
            "https://api.openai.com/v1/images/edits",
            {"authorization": f"Bearer {key}"},
            files,
        )
        data = res.json().get("data") or []
        if not data or "b64_json" not in data[0]:
            raise ProviderError("OpenAI returned no edited image data")
        return base64.b64decode(data[0]["b64_json"])

    async def generate(self, key: str, prompt: str, size: str, transparent: bool) -> bytes:
        payload: dict[str, object] = {
            "model": "gpt-image-1.5",
            "prompt": prompt,
            "size": size,
            "output_format": "png",
        }
        if transparent:
            payload["background"] = "transparent"
        res = await http_post_json(
            "https://api.openai.com/v1/images/generations",
            {"authorization": f"Bearer {key}"},
            payload,
        )
        data = res.json().get("data") or []
        if not data or "b64_json" not in data[0]:
            raise ProviderError("OpenAI returned no image data")
        return base64.b64decode(data[0]["b64_json"])
