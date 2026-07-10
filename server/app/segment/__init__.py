"""Segmentation backends.

- "local": pure Pillow (always available) — flood-fill remove-bg, alpha
  connected-components part split, proportional pose heuristic.
- "rembg": optional local ML remove-bg — installed via `uv sync --group ml`.
- "fal": cloud BYOK — quality remove-bg + SAM 2 prompted masks.
"""

from . import fal, local

try:  # optional heavy dependency (uv sync --group ml)
    from rembg import remove as _rembg_remove  # type: ignore[import-not-found]

    def rembg_remove(png: bytes) -> bytes:
        return _rembg_remove(png)

    HAS_REMBG = True
except ImportError:  # pragma: no cover - exercised only with the ml group
    HAS_REMBG = False

    def rembg_remove(png: bytes) -> bytes:
        raise RuntimeError("rembg is not installed on this server (uv sync --group ml)")


__all__ = ["local", "fal", "rembg_remove", "HAS_REMBG"]
