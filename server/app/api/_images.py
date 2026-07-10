"""Shared image-decoding guard for routers that accept data-URL images."""

import base64
import io

from fastapi import HTTPException
from PIL import Image

MAX_SIDE = 4096


def decode_image(image: str, max_side: int = MAX_SIDE) -> bytes:
    try:
        b64 = image.split(",", 1)[1] if image.startswith("data:") else image
        raw = base64.b64decode(b64)
        with Image.open(io.BytesIO(raw)) as im:
            if max(im.size) > max_side:
                raise HTTPException(
                    status_code=400, detail=f"Image larger than {max_side}px on a side"
                )
        return raw
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=400, detail="Could not decode image") from err
