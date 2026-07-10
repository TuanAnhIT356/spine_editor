"""Local mock provider: renders a flat-color PNG without any network call.
Used by tests and e2e runs, and handy for trying the UI without paying."""

import hashlib
import io
import struct
import zlib

from PIL import Image, ImageFilter

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
    supports_inpaint = True
    supports_edit = True
    approx_cost_usd = 0.0

    async def generate(self, key: str, prompt: str, size: str, transparent: bool) -> bytes:
        width, height = parse_size(size)
        digest = hashlib.sha256(prompt.encode()).digest()
        alpha = 128 if transparent else 255
        return _png(width, height, (digest[0], digest[1], digest[2], alpha))

    async def inpaint(self, key: str, image_png: bytes, mask_png: bytes, prompt: str) -> bytes:
        image = Image.open(io.BytesIO(image_png)).convert("RGBA")
        mask = Image.open(io.BytesIO(mask_png)).convert("L")
        if mask.size != image.size:
            mask = mask.resize(image.size, Image.NEAREST)
        blurred = image.filter(ImageFilter.GaussianBlur(8))
        blurred.putalpha(255)
        out = Image.composite(blurred, image, mask)
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()

    async def edit(
        self, key: str, image_png: bytes, prompt: str, size: str, transparent: bool
    ) -> bytes:
        image = Image.open(io.BytesIO(image_png)).convert("RGBA")
        digest = hashlib.sha256(prompt.encode()).digest()
        tint = Image.new("RGBA", image.size, (digest[0], digest[1], digest[2], 255))
        out = Image.blend(image, tint, 0.5)
        out.putalpha(image.getchannel("A"))
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()
