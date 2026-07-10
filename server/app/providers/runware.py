"""Runware image inference — LayerDiffuse gives native-alpha PNGs, the best
edges for game parts (hair, fur) without a remove-background pass."""

import base64
import uuid

from .base import ProviderError, http_post_json, parse_size


class RunwareProvider:
    name = "runware"
    supports_transparent = True
    approx_cost_usd = 0.01

    async def generate(self, key: str, prompt: str, size: str, transparent: bool) -> bytes:
        width, height = parse_size(size)
        task: dict[str, object] = {
            "taskType": "imageInference",
            "taskUUID": str(uuid.uuid4()),
            "positivePrompt": prompt,
            "width": width,
            "height": height,
            "numberResults": 1,
            "outputType": "base64Data",
            "outputFormat": "PNG",
        }
        if transparent:
            task["advancedFeatures"] = {"layerDiffuse": True}
        res = await http_post_json(
            "https://api.runware.ai/v1",
            {"authorization": f"Bearer {key}"},
            [task],
        )
        body = res.json()
        images = [d for d in body.get("data", []) if d.get("imageBase64Data")]
        if not images:
            raise ProviderError(f"Runware returned no image: {str(body)[:200]}")
        return base64.b64decode(images[0]["imageBase64Data"])
