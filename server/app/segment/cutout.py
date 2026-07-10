"""Apply a mask to the source image and crop the part out."""

import base64
import io

from PIL import Image, ImageChops

from .schemas import PartCut


def png_data_url(b: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(b).decode()


def cut_part(image_png: bytes, mask_png: bytes, name: str) -> PartCut | None:
    image = Image.open(io.BytesIO(image_png)).convert("RGBA")
    mask = Image.open(io.BytesIO(mask_png)).convert("L")
    if mask.size != image.size:
        mask = mask.resize(image.size, Image.NEAREST)
    mask = mask.point(lambda p: 255 if p > 127 else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return None
    alpha = ImageChops.multiply(image.getchannel("A"), mask)
    image.putalpha(alpha)
    cropped = image.crop(bbox)
    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    x0, y0, x1, y1 = bbox
    return PartCut(
        name=name,
        image=png_data_url(buf.getvalue()),
        x=x0,
        y=y0,
        width=x1 - x0,
        height=y1 - y0,
    )


def hole_mask(
    target_mask_png: bytes,
    other_masks_png: list[bytes],
    bbox: tuple[int, int, int, int],
    min_area_px: int = 200,
) -> bytes | None:
    """Union of the OTHER parts' masks inside the target's bbox — the area the
    target part loses to occluders. Returned mask is cropped to the bbox so it
    aligns with the part cut; None when the hole is negligible."""
    target = Image.open(io.BytesIO(target_mask_png)).convert("L")
    union = Image.new("L", target.size, 0)
    for raw in other_masks_png:
        other = Image.open(io.BytesIO(raw)).convert("L")
        if other.size != union.size:
            other = other.resize(union.size, Image.NEAREST)
        union = ImageChops.lighter(union, other)
    union = union.point(lambda p: 255 if p > 127 else 0)
    cropped = union.crop(bbox)
    area = sum(1 for p in cropped.getdata() if p > 0)
    if area <= min_area_px:
        return None
    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    return buf.getvalue()
