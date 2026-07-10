"""Local mock provider: renders a flat-color PNG without any network call.
Used by tests and e2e runs, and handy for trying the UI without paying."""

import hashlib
import struct
import zlib

from .base import parse_size


def _png(width: int, height: int, rgba: tuple[int, int, int, int]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    row = b"\x00" + bytes(rgba) * width
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


class MockProvider:
    name = "mock"
    supports_transparent = True
    approx_cost_usd = 0.0

    async def generate(self, key: str, prompt: str, size: str, transparent: bool) -> bytes:
        width, height = parse_size(size)
        digest = hashlib.sha256(prompt.encode()).digest()
        alpha = 128 if transparent else 255
        return _png(width, height, (digest[0], digest[1], digest[2], alpha))
