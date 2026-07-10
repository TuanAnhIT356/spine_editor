"""Stability AI stable-image core generation (raw PNG response)."""

import httpx

from .base import ProviderError


class StabilityProvider:
    name = "stability"
    supports_transparent = False  # use remove-background (Phase 13) for alpha
    approx_cost_usd = 0.03

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
