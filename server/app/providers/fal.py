"""fal.ai FLUX inference (fast, cheap; no native transparency)."""

from .base import ProviderError, http_get_bytes, http_post_json, parse_size


class FalProvider:
    name = "fal"
    supports_transparent = False
    approx_cost_usd = 0.003

    async def generate(self, key: str, prompt: str, size: str, transparent: bool) -> bytes:
        width, height = parse_size(size)
        res = await http_post_json(
            "https://fal.run/fal-ai/flux/schnell",
            {"authorization": f"Key {key}"},
            {"prompt": prompt, "image_size": {"width": width, "height": height}, "num_images": 1},
        )
        images = res.json().get("images") or []
        if not images or "url" not in images[0]:
            raise ProviderError("fal.ai returned no image")
        return await http_get_bytes(images[0]["url"])
