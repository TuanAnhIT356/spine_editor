"""fal.ai cloud segmentation (BYOK): quality background removal and SAM 2
point/box-prompted masks. Used when the local heuristics aren't enough."""

import base64

from ..providers.base import ProviderError, http_get_bytes, http_post_json


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode()


async def _image_from_result(payload: dict, field: str) -> bytes:
    entry = payload.get(field)
    if isinstance(entry, list):
        entry = entry[0] if entry else None
    if not isinstance(entry, dict) or "url" not in entry:
        raise ProviderError(f"fal.ai returned no '{field}' image")
    url: str = entry["url"]
    if url.startswith("data:"):
        return base64.b64decode(url.split(",", 1)[1])
    return await http_get_bytes(url)


async def remove_background(key: str, png: bytes) -> bytes:
    res = await http_post_json(
        "https://fal.run/fal-ai/imageutils/rembg",
        {"authorization": f"Key {key}"},
        {"image_url": _data_url(png)},
    )
    return await _image_from_result(res.json(), "image")


async def sam_mask(
    key: str, png: bytes, points: list[dict[str, float]], boxes: list[dict[str, float]]
) -> bytes:
    """SAM 2 mask for point prompts ({x,y,label: 1|0}) and/or boxes
    ({x_min,y_min,x_max,y_max}). Returns the mask PNG (white = selected)."""
    payload: dict[str, object] = {"image_url": _data_url(png)}
    if points:
        payload["prompts"] = [
            {"x": p["x"], "y": p["y"], "label": int(p.get("label", 1))} for p in points
        ]
    if boxes:
        payload["box_prompts"] = boxes
    res = await http_post_json(
        "https://fal.run/fal-ai/sam2/image",
        {"authorization": f"Key {key}"},
        payload,
    )
    return await _image_from_result(res.json(), "image")
