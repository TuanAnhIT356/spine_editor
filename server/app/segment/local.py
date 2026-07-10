"""Pure-Pillow segmentation: no ML models, runs anywhere (CI, Render free).

Three operations:
- remove_background: flood-fill from the corners over a near-uniform backdrop.
- split_parts: connected components on the alpha channel — a transparent
  character/part sheet falls apart into its islands.
- estimate_pose: proportional landmark template fitted to the silhouette
  bounding box (classic ~7.5-heads figure). A deliberate approximation: good
  enough to seed bones and SAM point prompts, refined by hand or by a real
  pose model later.
"""

from collections import deque
from dataclasses import dataclass
from io import BytesIO

from PIL import Image

MAX_DIM = 2048
ALPHA_THRESHOLD = 16


def _load_rgba(png: bytes) -> Image.Image:
    img = Image.open(BytesIO(png)).convert("RGBA")
    if max(img.size) > MAX_DIM:
        img.thumbnail((MAX_DIM, MAX_DIM))
    return img


def _to_png(img: Image.Image) -> bytes:
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def remove_background(png: bytes, tolerance: int = 24) -> bytes:
    """Clears the backdrop by flood-filling from the four corners. Works for
    flat / lightly gradiented backgrounds (typical AI output); busy backdrops
    need a real model (rembg / fal)."""
    img = _load_rgba(png)
    w, h = img.size
    px = img.load()

    def close(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
        return (
            abs(a[0] - b[0]) <= tolerance
            and abs(a[1] - b[1]) <= tolerance
            and abs(a[2] - b[2]) <= tolerance
        )

    seen = bytearray(w * h)
    queue: deque[tuple[int, int, tuple[int, int, int, int]]] = deque()
    for cx, cy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        queue.append((cx, cy, px[cx, cy]))
    while queue:
        x, y, ref = queue.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        current = px[x, y]
        if current[3] > 0 and not close(current, ref):
            continue
        seen[y * w + x] = 1
        px[x, y] = (0, 0, 0, 0)
        queue.extend(((x + 1, y, ref), (x - 1, y, ref), (x, y + 1, ref), (x, y - 1, ref)))
    return _to_png(img)


@dataclass
class Part:
    name: str
    png: bytes
    x: int
    y: int
    width: int
    height: int


def split_parts(png: bytes, min_area: int = 64, crop: bool = True) -> tuple[list[Part], int, int]:
    """Splits opaque islands (4-connected on alpha) into separate images.
    Returns (parts sorted by area desc, source width, source height). With
    crop=False each part keeps the full canvas so relative placement survives
    a centered import."""
    img = _load_rgba(png)
    w, h = img.size
    alpha = img.getchannel("A").tobytes()
    labels = [0] * (w * h)
    parts: list[Part] = []
    next_label = 0

    for start in range(w * h):
        if labels[start] or alpha[start] < ALPHA_THRESHOLD:
            continue
        next_label += 1
        stack = [start]
        labels[start] = next_label
        pixels: list[int] = []
        while stack:
            i = stack.pop()
            pixels.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if not labels[j] and alpha[j] >= ALPHA_THRESHOLD:
                        labels[j] = next_label
                        stack.append(j)
        if len(pixels) < min_area:
            continue
        xs = [i % w for i in pixels]
        ys = [i // w for i in pixels]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        # Mask everything outside this component so overlapping bboxes don't
        # drag neighbour pixels along.
        component = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        cpx = component.load()
        spx = img.load()
        for i in pixels:
            x, y = i % w, i // w
            cpx[x, y] = spx[x, y]
        out = component.crop((x0, y0, x1 + 1, y1 + 1)) if crop else component
        parts.append(
            Part(
                name="",
                png=_to_png(out),
                x=x0,
                y=y0,
                width=x1 - x0 + 1,
                height=y1 - y0 + 1,
            )
        )

    parts.sort(key=lambda p: p.width * p.height, reverse=True)
    for index, part in enumerate(parts):
        part.name = f"part-{index + 1}"
    return parts, w, h


# (dx, dy) in silhouette-bbox fractions: x from bbox left, y from bbox top.
POSE_TEMPLATE: dict[str, tuple[float, float]] = {
    "head": (0.5, 0.07),
    "neck": (0.5, 0.16),
    "shoulder_l": (0.34, 0.2),
    "shoulder_r": (0.66, 0.2),
    "elbow_l": (0.22, 0.33),
    "elbow_r": (0.78, 0.33),
    "hand_l": (0.12, 0.46),
    "hand_r": (0.88, 0.46),
    "hip": (0.5, 0.52),
    "knee_l": (0.42, 0.72),
    "knee_r": (0.58, 0.72),
    "foot_l": (0.4, 0.96),
    "foot_r": (0.6, 0.96),
}


def estimate_pose(png: bytes) -> dict[str, object]:
    """Landmarks from a front-facing full-body silhouette via a proportional
    template over the opaque bounding box. Pixel coordinates, origin top-left."""
    img = _load_rgba(png)
    bbox = img.getchannel("A").point(lambda a: 255 if a >= ALPHA_THRESHOLD else 0).getbbox()
    if bbox is None:
        return {"landmarks": {}, "width": img.width, "height": img.height, "bbox": None}
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    landmarks = {
        name: {"x": round(x0 + fx * bw, 1), "y": round(y0 + fy * bh, 1)}
        for name, (fx, fy) in POSE_TEMPLATE.items()
    }
    return {
        "landmarks": landmarks,
        "width": img.width,
        "height": img.height,
        "bbox": {"x": x0, "y": y0, "width": bw, "height": bh},
    }
