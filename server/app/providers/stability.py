"""Stability AI stable-image core generation (raw PNG response)."""

import httpx

from .base import ProviderError, http_post_multipart


class StabilityProvider:
    name = "stability"
    supports_transparent = False  # use remove-background (Phase 13) for alpha
    supports_inpaint = True
    approx_cost_usd = 0.03

    async def inpaint(self, key: str, image_png: bytes, mask_png: bytes, prompt: str) -> bytes:
        res = await http_post_multipart(
            "https://api.stability.ai/v2beta/stable-image/edit/inpaint",
            {"authorization": f"Bearer {key}", "accept": "image/*"},
            {
                "image": ("image.png", image_png, "image/png"),
                "mask": ("mask.png", mask_png, "image/png"),
                "prompt": (None, prompt),
                "output_format": (None, "png"),
            },
        )
        return res.content

    async def generate(self, key: str, prompt: str, size: str, transparent: bool) -> bytes:
        async with httpx.AsyncClient(timeout=180) as client:
            res = await client.post(
                "https://api.stability.ai/v2beta/stable-image/generate/core",
                headers={"authorization": f"Bearer {key}", "accept": "image/*"},
                files={
                    "prompt": (None, prompt),
                    "output_format": (None, "png"),
                },
            )
        if res.status_code >= 400:
            raise ProviderError(f"Provider HTTP {res.status_code}: {res.text[:200]}")
        return res.content
