"""Image-generation provider interface.

Adapters receive the user's decrypted API key per call (keys never live on the
adapter), and return raw PNG bytes. `supports_transparent` gates the
`transparent` flag server-side so the UI can explain instead of failing deep
inside a provider call.
"""

from typing import Protocol

import httpx


class ProviderError(Exception):
    """Provider-side failure with a client-safe message (never contains keys)."""


class ImageProvider(Protocol):
    name: str
    supports_transparent: bool
    # Rough USD cost per image for the pre-call estimate shown in the UI.
    approx_cost_usd: float

    async def generate(self, key: str, prompt: str, size: str, transparent: bool) -> bytes: ...


def parse_size(size: str) -> tuple[int, int]:
    try:
        w, h = size.lower().split("x")
        return int(w), int(h)
    except ValueError as err:
        raise ProviderError(f"Invalid size '{size}', expected e.g. 1024x1024") from err


async def http_post_json(
    url: str, headers: dict[str, str], payload: object, timeout: int = 180
) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(url, headers=headers, json=payload)
    if res.status_code >= 400:
        # Provider error bodies can leak request details — keep only the status
        # and a trimmed snippet.
        snippet = res.text[:200]
        raise ProviderError(f"Provider HTTP {res.status_code}: {snippet}")
    return res


async def http_get_bytes(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=180) as client:
        res = await client.get(url)
    if res.status_code >= 400:
        raise ProviderError(f"Image download failed: HTTP {res.status_code}")
    return res.content
