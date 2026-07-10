# Phase 13 Slice 1 — Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full strategy-B pipeline — remove-bg (rembg local) → pose landmarks (MediaPipe local) → per-part SAM masks (fal.ai BYOK or free mock) → mask-review dialog in the editor → import parts as assets with source origins (+ optional place-on-canvas).

**Architecture:** New `server/app/segment/` module (schemas, engines, PART_RECIPES, `SegmentBackend` protocol, cutout) + `/api/segment` router mirroring `generate.py` guard patterns. Editor gets `SegmentModal` mirroring `GenerateModal`, an optional `origin` field on `ImageAsset`, and a Composite-based place-on-canvas mirroring `store.attachAsset`. `SPINE_SERVER_SEGMENT_FAKE=1` swaps rembg/pose for deterministic fakes so pytest/e2e never download models.

**Tech Stack:** FastAPI, Pillow, numpy, rembg (onnxruntime), mediapipe (Tasks PoseLandmarker), httpx → `fal.run/fal-ai/sam2/image`, React/zustand, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-11-phase13-segmentation-design.md`

## Global Constraints

- Branch `claude/phase13-segmentation` (spec committed).
- pnpm via shim: `export PATH="/private/tmp/claude-501/-Users-tuananh-Projects-you-spine-editor/6b990f26-97bc-4e20-b105-3db5aab338c5/scratchpad/bin:$PATH"`; Python via `uv` from `server/`.
- No torch, no new DB tables, no MCP tool, no inpaint (spec §7).
- pytest must pass offline with no model downloads: `server/tests/conftest.py` sets `SPINE_SERVER_SEGMENT_FAKE=1` before app import.
- Part names exactly: `head, torso, upper_arm_l, lower_arm_l, upper_arm_r, lower_arm_r, upper_leg_l, lower_leg_l, upper_leg_r, lower_leg_r`.
- Backend names exactly: `fal`, `mock`. Image side limit 4096px; max 20 parts/request; fal per-part timeout 60s.
- All Python: ruff clean (line 100); all TS: prettier + eslint clean.

---

### Task 1: Deps + schemas + PART_RECIPES (pure logic)

**Files:**

- Modify: `server/pyproject.toml` (dependencies array)
- Create: `server/app/segment/__init__.py`, `server/app/segment/schemas.py`, `server/app/segment/parts.py`
- Test: `server/tests/test_segment_parts.py`

**Interfaces:**

- Produces: `Point{x:int,y:int,label:int}`, `Box{x0,y0,x1,y1:int}`, `PartPrompt{name:str,points:list[Point],box:Box|None}`, `PartCut{name:str,image:str,x:int,y:int,width:int,height:int}` (pydantic); `PoseResult{landmarks:dict[str,tuple[float,float,float]],width:int,height:int}` (dataclass); `build_prompts(pose: PoseResult) -> list[PartPrompt]`; `LANDMARK_INDICES: dict[str,int]`.

- [ ] **Step 1: Add deps**

In `server/pyproject.toml` `dependencies`, append: `"rembg>=2.0"`, `"mediapipe>=0.10"`, `"numpy>=1.26"`, `"pillow>=10"`. Run from `server/`: `uv sync` — expect resolution success (onnxruntime pulled by rembg).

- [ ] **Step 2: Write the failing tests**

Create `server/tests/test_segment_parts.py`:

```python
from app.segment.parts import build_prompts
from app.segment.schemas import PoseResult

FRACTIONS = {
    "nose": (0.50, 0.10), "left_ear": (0.44, 0.10), "right_ear": (0.56, 0.10),
    "left_shoulder": (0.35, 0.22), "right_shoulder": (0.65, 0.22),
    "left_elbow": (0.28, 0.35), "right_elbow": (0.72, 0.35),
    "left_wrist": (0.24, 0.48), "right_wrist": (0.76, 0.48),
    "left_hip": (0.42, 0.50), "right_hip": (0.58, 0.50),
    "left_knee": (0.40, 0.70), "right_knee": (0.60, 0.70),
    "left_ankle": (0.39, 0.92), "right_ankle": (0.61, 0.92),
}


def pose(w=400, h=800, drop: set[str] | None = None, vis=1.0) -> PoseResult:
    lm = {
        name: (fx * w, fy * h, 0.0 if drop and name in drop else vis)
        for name, (fx, fy) in FRACTIONS.items()
    }
    return PoseResult(landmarks=lm, width=w, height=h)


def test_full_pose_yields_all_ten_parts():
    names = [p.name for p in build_prompts(pose())]
    assert names == [
        "head", "torso",
        "upper_arm_l", "lower_arm_l", "upper_arm_r", "lower_arm_r",
        "upper_leg_l", "lower_leg_l", "upper_leg_r", "lower_leg_r",
    ]


def test_limb_prompts_sit_on_the_correct_side():
    by_name = {p.name: p for p in build_prompts(pose())}
    left = by_name["upper_arm_l"]
    right = by_name["upper_arm_r"]
    assert all(pt.x < 200 for pt in left.points if pt.label == 1)
    assert all(pt.x > 200 for pt in right.points if pt.label == 1)


def test_fg_points_lie_inside_box_and_bg_outside():
    for p in build_prompts(pose()):
        assert p.box is not None
        for pt in p.points:
            inside = p.box.x0 <= pt.x <= p.box.x1 and p.box.y0 <= pt.y <= p.box.y1
            if pt.label == 1:
                assert inside, f"{p.name} fg point outside box"


def test_boxes_are_clamped_to_image():
    for p in build_prompts(pose(w=100, h=100)):
        assert p.box is not None
        assert 0 <= p.box.x0 < p.box.x1 <= 100
        assert 0 <= p.box.y0 < p.box.y1 <= 100


def test_low_visibility_landmark_skips_dependent_parts():
    names = [p.name for p in build_prompts(pose(drop={"left_elbow"}))]
    assert "upper_arm_l" not in names and "lower_arm_l" not in names
    assert "upper_arm_r" in names
```

- [ ] **Step 3: Run tests to verify they fail**

Run from `server/`: `uv run pytest tests/test_segment_parts.py -q`
Expected: FAIL — `ModuleNotFoundError: app.segment`.

- [ ] **Step 4: Implement schemas + parts**

`server/app/segment/__init__.py`: empty (module marker).

`server/app/segment/schemas.py`:

```python
"""Shared shapes for the segmentation pipeline (strategy B)."""

from dataclasses import dataclass

from pydantic import BaseModel, Field


class Point(BaseModel):
    x: int
    y: int
    label: int = Field(ge=0, le=1, description="1=foreground, 0=background")


class Box(BaseModel):
    x0: int
    y0: int
    x1: int
    y1: int


class PartPrompt(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    points: list[Point] = []
    box: Box | None = None


class PartCut(BaseModel):
    """One cut-out part: RGBA PNG data URL + its origin in the source image
    (pixels, top-left origin)."""

    name: str
    image: str
    x: int
    y: int
    width: int
    height: int


@dataclass
class PoseResult:
    """Landmarks in PIXEL coordinates: name -> (x, y, visibility)."""

    landmarks: dict[str, tuple[float, float, float]]
    width: int
    height: int
```

`server/app/segment/parts.py`:

```python
"""Turn pose landmarks into per-part SAM prompts. Pure logic — no models.

Foreground points sit along the limb segment (25/50/75%), background points
at neighbouring part centers, and the box wraps the segment with padding so
SAM has both a hint and a bound.
"""

from .schemas import Box, PartPrompt, Point, PoseResult

# MediaPipe BlazePose 33-landmark indices for the subset we use.
LANDMARK_INDICES: dict[str, int] = {
    "nose": 0, "left_ear": 7, "right_ear": 8,
    "left_shoulder": 11, "right_shoulder": 12,
    "left_elbow": 13, "right_elbow": 14,
    "left_wrist": 15, "right_wrist": 16,
    "left_hip": 23, "right_hip": 24,
    "left_knee": 25, "right_knee": 26,
    "left_ankle": 27, "right_ankle": 28,
}

MIN_VISIBILITY = 0.5
# (part, from-landmark, to-landmark) in output order.
LIMBS: list[tuple[str, str, str]] = [
    ("upper_arm_l", "left_shoulder", "left_elbow"),
    ("lower_arm_l", "left_elbow", "left_wrist"),
    ("upper_arm_r", "right_shoulder", "right_elbow"),
    ("lower_arm_r", "right_elbow", "right_wrist"),
    ("upper_leg_l", "left_hip", "left_knee"),
    ("lower_leg_l", "left_knee", "left_ankle"),
    ("upper_leg_r", "right_hip", "right_knee"),
    ("lower_leg_r", "right_knee", "right_ankle"),
]

XY = tuple[float, float]


def _lerp(a: XY, b: XY, t: float) -> XY:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _mid(a: XY, b: XY) -> XY:
    return _lerp(a, b, 0.5)


def _pt(p: XY, label: int) -> Point:
    return Point(x=round(p[0]), y=round(p[1]), label=label)


def _box(points: list[XY], pad: float, w: int, h: int) -> Box | None:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0 = max(0, round(min(xs) - pad))
    y0 = max(0, round(min(ys) - pad))
    x1 = min(w, round(max(xs) + pad))
    y1 = min(h, round(max(ys) + pad))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return Box(x0=x0, y0=y0, x1=x1, y1=y1)


def build_prompts(pose: PoseResult) -> list[PartPrompt]:
    vis: dict[str, XY] = {
        name: (x, y)
        for name, (x, y, v) in pose.landmarks.items()
        if v >= MIN_VISIBILITY
    }
    out: list[PartPrompt] = []

    def torso_center() -> XY | None:
        need = ["left_shoulder", "right_shoulder", "left_hip", "right_hip"]
        if any(n not in vis for n in need):
            return None
        sx = sum(vis[n][0] for n in need) / 4
        sy = sum(vis[n][1] for n in need) / 4
        return (sx, sy)

    center = torso_center()

    # head — around nose/ears, background at the shoulders.
    if "nose" in vis:
        nose = vis["nose"]
        ear_dist = (
            abs(vis["right_ear"][0] - vis["left_ear"][0])
            if "left_ear" in vis and "right_ear" in vis
            else pose.width * 0.15
        )
        pts = [_pt(nose, 1)]
        if "left_ear" in vis and "right_ear" in vis:
            pts.append(_pt(_mid(vis["left_ear"], vis["right_ear"]), 1))
        if center:
            pts.append(_pt(center, 0))
        half = max(ear_dist * 1.1, 8)
        box = _box(
            [(nose[0] - half, nose[1] - ear_dist * 1.4), (nose[0] + half, nose[1] + ear_dist * 1.2)],
            0, pose.width, pose.height,
        )
        out.append(PartPrompt(name="head", points=pts, box=box))

    # torso — shoulder/hip quad, background at nose + elbows.
    if center:
        corners = [vis[n] for n in ("left_shoulder", "right_shoulder", "left_hip", "right_hip")]
        pts = [
            _pt(center, 1),
            _pt(_mid(vis["left_shoulder"], vis["right_shoulder"]), 1),
            _pt(_mid(vis["left_hip"], vis["right_hip"]), 1),
        ]
        for bg in ("nose", "left_elbow", "right_elbow"):
            if bg in vis:
                pts.append(_pt(vis[bg], 0))
        span = max(max(p[0] for p in corners) - min(p[0] for p in corners), 1)
        box = _box(corners, span * 0.15, pose.width, pose.height)
        out.append(PartPrompt(name="torso", points=pts, box=box))

    # limbs — 25/50/75% along the bone segment, background at torso center.
    for name, a_name, b_name in LIMBS:
        if a_name not in vis or b_name not in vis:
            continue
        a, b = vis[a_name], vis[b_name]
        seg_len = max(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5, 1)
        pts = [_pt(_lerp(a, b, t), 1) for t in (0.25, 0.5, 0.75)]
        if center:
            pts.append(_pt(center, 0))
        pad = max(seg_len * 0.2, 12)
        box = _box([a, b], pad, pose.width, pose.height)
        out.append(PartPrompt(name=name, points=pts, box=box))

    # Stable order: head, torso, then LIMBS order.
    order = {"head": 0, "torso": 1, **{n: i + 2 for i, (n, _, _) in enumerate(LIMBS)}}
    out.sort(key=lambda p: order[p.name])
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_segment_parts.py -q` → PASS (5 tests).

- [ ] **Step 6: Lint + commit**

```bash
uv run ruff check . && uv run ruff format .
git add server/pyproject.toml server/uv.lock server/app/segment server/tests/test_segment_parts.py
git commit -m "P13: segmentation schemas + landmark-to-prompt recipes"
```

---

### Task 2: Cutout + backends (mock, fal)

**Files:**

- Create: `server/app/segment/cutout.py`, `server/app/segment/backends.py`
- Test: `server/tests/test_segment_cutout.py`

**Interfaces:**

- Consumes: `PartPrompt`, `PartCut`, `Point`, `Box` from Task 1.
- Produces: `cut_part(image_png: bytes, mask_png: bytes, name: str) -> PartCut | None`; `SegmentBackend` protocol `{name: str, approx_cost_usd: float, async mask(image_png: bytes, prompt: PartPrompt) -> bytes}`; `MockBackend()`, `FalSam2Backend()`; `BACKENDS: dict[str, SegmentBackend]`; `png_data_url(b: bytes) -> str`.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_segment_cutout.py`:

```python
import asyncio
import base64
import io

from PIL import Image

from app.segment.backends import BACKENDS, MockBackend
from app.segment.cutout import cut_part
from app.segment.schemas import Box, PartPrompt, Point


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def solid(w, h, color=(200, 80, 30, 255)) -> bytes:
    return png_bytes(Image.new("RGBA", (w, h), color))


def decode(data_url: str) -> Image.Image:
    b64 = data_url.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(b64)))


def test_mock_backend_masks_the_box():
    prompt = PartPrompt(name="p", points=[], box=Box(x0=10, y0=20, x1=40, y1=60))
    mask_png = asyncio.run(MockBackend().mask(solid(100, 100), prompt))
    mask = Image.open(io.BytesIO(mask_png)).convert("L")
    assert mask.size == (100, 100)
    assert mask.getpixel((25, 40)) > 200  # inside box
    assert mask.getpixel((5, 5)) < 50  # outside


def test_mock_backend_without_box_circles_the_points():
    prompt = PartPrompt(name="p", points=[Point(x=50, y=50, label=1)], box=None)
    mask_png = asyncio.run(MockBackend().mask(solid(100, 100), prompt))
    mask = Image.open(io.BytesIO(mask_png)).convert("L")
    assert mask.getpixel((50, 50)) > 200


def test_cut_part_crops_to_mask_bbox_with_origin():
    image = solid(100, 100)
    mask_img = Image.new("L", (100, 100), 0)
    for x in range(10, 40):
        for y in range(20, 60):
            mask_img.putpixel((x, y), 255)
    cut = cut_part(image, png_bytes(mask_img), "torso")
    assert cut is not None
    assert (cut.x, cut.y, cut.width, cut.height) == (10, 20, 30, 40)
    out = decode(cut.image)
    assert out.size == (30, 40)
    assert out.getpixel((0, 0))[3] == 255  # inside mask keeps alpha
    # a pixel that was outside the mask but inside... bbox == mask here, so
    # instead verify empty mask returns None:
    assert cut_part(image, png_bytes(Image.new("L", (100, 100), 0)), "x") is None


def test_backends_registry():
    assert set(BACKENDS) == {"fal", "mock"}
    assert BACKENDS["mock"].approx_cost_usd == 0.0


def test_fal_backend_maps_prompts_and_decodes_data_uri(monkeypatch):
    import app.segment.backends as bk

    captured: dict = {}
    mask_b64 = base64.b64encode(png_bytes(Image.new("L", (10, 10), 255))).decode()

    class FakeRes:
        def json(self):
            return {"image": {"url": f"data:image/png;base64,{mask_b64}"}}

    async def fake_post(url, headers, payload, timeout=180):
        captured.update(url=url, headers=headers, payload=payload, timeout=timeout)
        return FakeRes()

    monkeypatch.setattr(bk, "http_post_json", fake_post)
    prompt = PartPrompt(
        name="p",
        points=[Point(x=5, y=6, label=1), Point(x=1, y=2, label=0)],
        box=Box(x0=0, y0=0, x1=9, y1=9),
    )
    out = asyncio.run(bk.FalSam2Backend().with_key("k123").mask(solid(10, 10), prompt))
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
    assert captured["headers"]["authorization"] == "Key k123"
    assert captured["timeout"] == 60
    assert captured["payload"]["prompts"] == [
        {"x": 5, "y": 6, "label": 1},
        {"x": 1, "y": 2, "label": 0},
    ]
    assert captured["payload"]["box_prompts"] == [{"x_min": 0, "y_min": 0, "x_max": 9, "y_max": 9}]
    assert captured["payload"]["image_url"].startswith("data:image/png;base64,")
```

Supporting change in `server/app/providers/base.py`: give `http_post_json` a
`timeout: int = 180` keyword parameter and pass it to `httpx.AsyncClient(timeout=timeout)`
(default unchanged for existing providers).

- [ ] **Step 2: Run to verify FAIL** — `uv run pytest tests/test_segment_cutout.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`server/app/segment/cutout.py`:

```python
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
        name=name, image=png_data_url(buf.getvalue()),
        x=x0, y=y0, width=x1 - x0, height=y1 - y0,
    )
```

`server/app/segment/backends.py`:

```python
"""Mask backends: SAM 2 via fal.ai (BYOK) and a free deterministic mock.

The protocol returns a black/white mask PNG the size of the input image;
`cutout.cut_part` does the rest. A local SAM backend can slot in later
without touching the API layer.
"""

import base64
import io
from typing import Protocol

from PIL import Image, ImageDraw

from ..providers.base import ProviderError, http_get_bytes, http_post_json
from .cutout import png_data_url
from .schemas import PartPrompt

FAL_SAM2_URL = "https://fal.run/fal-ai/sam2/image"


class SegmentBackend(Protocol):
    name: str
    approx_cost_usd: float

    async def mask(self, image_png: bytes, prompt: PartPrompt) -> bytes: ...


class MockBackend:
    """Free/offline: mask = the prompt box (or a circle around fg points)."""

    name = "mock"
    approx_cost_usd = 0.0

    async def mask(self, image_png: bytes, prompt: PartPrompt) -> bytes:
        size = Image.open(io.BytesIO(image_png)).size
        mask = Image.new("L", size, 0)
        draw = ImageDraw.Draw(mask)
        if prompt.box is not None:
            draw.rectangle((prompt.box.x0, prompt.box.y0, prompt.box.x1, prompt.box.y1), fill=255)
        else:
            fg = [(p.x, p.y) for p in prompt.points if p.label == 1]
            if fg:
                cx = sum(x for x, _ in fg) / len(fg)
                cy = sum(y for _, y in fg) / len(fg)
                r = max(max(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 for x, y in fg), 20)
                draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
        buf = io.BytesIO()
        mask.save(buf, format="PNG")
        return buf.getvalue()


class FalSam2Backend:
    """fal.ai fal-ai/sam2/image — point + box prompts, returns the mask image."""

    name = "fal"
    approx_cost_usd = 0.01

    def __init__(self) -> None:
        self._key = ""

    def with_key(self, key: str) -> "FalSam2Backend":
        b = FalSam2Backend()
        b._key = key
        return b

    async def mask(self, image_png: bytes, prompt: PartPrompt) -> bytes:
        payload: dict[str, object] = {
            "image_url": png_data_url(image_png),
            "prompts": [{"x": p.x, "y": p.y, "label": p.label} for p in prompt.points],
            "sync_mode": True,
            "output_format": "png",
        }
        if prompt.box is not None:
            payload["box_prompts"] = [{
                "x_min": prompt.box.x0, "y_min": prompt.box.y0,
                "x_max": prompt.box.x1, "y_max": prompt.box.y1,
            }]
        res = await http_post_json(
            FAL_SAM2_URL, {"authorization": f"Key {self._key}"}, payload, timeout=60
        )
        image = res.json().get("image") or {}
        url = image.get("url")
        if not url:
            raise ProviderError("fal.ai SAM2 returned no mask image")
        if url.startswith("data:"):
            return base64.b64decode(url.split(",", 1)[1])
        return await http_get_bytes(url)


BACKENDS: dict[str, SegmentBackend] = {
    "fal": FalSam2Backend(),
    "mock": MockBackend(),
}
```

- [ ] **Step 4: Run to verify PASS** — `uv run pytest tests/test_segment_cutout.py -q` → 4 pass.

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check . && uv run ruff format .
git add server/app/segment/cutout.py server/app/segment/backends.py server/tests/test_segment_cutout.py
git commit -m "P13: cutout + mock/fal SAM2 segment backends"
```

---

### Task 3: Engines — rembg + MediaPipe pose (+ deterministic fakes)

**Files:**

- Create: `server/app/segment/engines.py`
- Test: `server/tests/test_segment_engines.py`

**Interfaces:**

- Consumes: `PoseResult`, `LANDMARK_INDICES` from Task 1.
- Produces: `remove_background(png: bytes) -> bytes`; `detect_pose(png: bytes) -> PoseResult` (raises `PoseNotFound`); exceptions `SegmentUnavailable(Exception)` (missing deps → 503), `PoseNotFound(Exception)` (→ 422); `FAKE_POSE_FRACTIONS: dict[str, tuple[float, float]]`; `_fake_enabled() -> bool` reads env at call time.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_segment_engines.py` (conftest already forces fake mode):

```python
import io

from PIL import Image

from app.segment.engines import FAKE_POSE_FRACTIONS, detect_pose, remove_background
from app.segment.parts import LANDMARK_INDICES, build_prompts


def png(w=200, h=400) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (10, 10, 10, 255)).save(buf, format="PNG")
    return buf.getvalue()


def test_fake_remove_background_is_passthrough():
    data = png()
    assert remove_background(data) == data


def test_fake_pose_scales_to_image_and_covers_needed_landmarks():
    result = detect_pose(png(200, 400))
    assert result.width == 200 and result.height == 400
    assert set(LANDMARK_INDICES) <= set(result.landmarks)
    x, y, vis = result.landmarks["nose"]
    fx, fy = FAKE_POSE_FRACTIONS["nose"]
    assert (x, y, vis) == (fx * 200, fy * 400, 1.0)


def test_fake_pose_feeds_recipes_end_to_end():
    prompts = build_prompts(detect_pose(png()))
    assert len(prompts) == 10
```

- [ ] **Step 2: Run to verify FAIL** — `ModuleNotFoundError: app.segment.engines`. Also update `server/tests/conftest.py`: alongside its existing pre-import env setup, add `os.environ.setdefault("SPINE_SERVER_SEGMENT_FAKE", "1")` (match the file's existing style — read it first).

- [ ] **Step 3: Implement `server/app/segment/engines.py`**

```python
"""Local engines: rembg remove-bg and MediaPipe pose landmarks.

Heavy imports are lazy (503 with an install hint when missing) and models
cache under server/data/models. SPINE_SERVER_SEGMENT_FAKE=1 swaps both for
deterministic fakes so tests/e2e/CI never download models.
"""

import io
import os
from pathlib import Path

import httpx
from PIL import Image

from ..config import config
from .parts import LANDMARK_INDICES
from .schemas import PoseResult


class SegmentUnavailable(Exception):
    """Dependency/model missing — surfaced as HTTP 503."""


class PoseNotFound(Exception):
    """No (usable) person detected — surfaced as HTTP 422."""


POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)

# Canonical humanoid used by the fake pose (fractions of width/height).
FAKE_POSE_FRACTIONS: dict[str, tuple[float, float]] = {
    "nose": (0.50, 0.10), "left_ear": (0.44, 0.10), "right_ear": (0.56, 0.10),
    "left_shoulder": (0.35, 0.22), "right_shoulder": (0.65, 0.22),
    "left_elbow": (0.28, 0.35), "right_elbow": (0.72, 0.35),
    "left_wrist": (0.24, 0.48), "right_wrist": (0.76, 0.48),
    "left_hip": (0.42, 0.50), "right_hip": (0.58, 0.50),
    "left_knee": (0.40, 0.70), "right_knee": (0.60, 0.70),
    "left_ankle": (0.39, 0.92), "right_ankle": (0.61, 0.92),
}

_rembg_session = None
_pose_landmarker = None


def _fake_enabled() -> bool:
    return os.environ.get("SPINE_SERVER_SEGMENT_FAKE") == "1"


def _models_dir() -> Path:
    d = Path(config.data_dir) / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _image_size(png: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(png)).size


def remove_background(png: bytes) -> bytes:
    if _fake_enabled():
        return png
    global _rembg_session
    try:
        os.environ.setdefault("U2NET_HOME", str(_models_dir()))
        from rembg import new_session, remove
    except ImportError as err:  # pragma: no cover - depends on install
        raise SegmentUnavailable("rembg not installed — run `uv sync` in server/") from err
    if _rembg_session is None:
        _rembg_session = new_session("u2net")
    return remove(png, session=_rembg_session)


def detect_pose(png: bytes) -> PoseResult:
    width, height = _image_size(png)
    if _fake_enabled():
        landmarks = {
            name: (fx * width, fy * height, 1.0)
            for name, (fx, fy) in FAKE_POSE_FRACTIONS.items()
        }
        return PoseResult(landmarks=landmarks, width=width, height=height)

    global _pose_landmarker
    try:
        import mediapipe as mp
        import numpy as np
    except ImportError as err:  # pragma: no cover - depends on install
        raise SegmentUnavailable("mediapipe not installed — run `uv sync` in server/") from err

    model_path = _models_dir() / "pose_landmarker_lite.task"
    if not model_path.exists():
        res = httpx.get(POSE_MODEL_URL, timeout=120, follow_redirects=True)
        res.raise_for_status()
        model_path.write_bytes(res.content)

    if _pose_landmarker is None:
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
        )
        _pose_landmarker = mp.tasks.vision.PoseLandmarker.create_from_options(options)

    rgba = Image.open(io.BytesIO(png)).convert("RGBA")
    frame = mp.Image(image_format=mp.ImageFormat.SRGBA, data=np.asarray(rgba))
    result = _pose_landmarker.detect(frame)
    if not result.pose_landmarks:
        raise PoseNotFound("No person detected in the image")
    pose = result.pose_landmarks[0]
    landmarks: dict[str, tuple[float, float, float]] = {}
    for name, idx in LANDMARK_INDICES.items():
        lm = pose[idx]
        landmarks[name] = (lm.x * width, lm.y * height, lm.visibility or 0.0)
    return PoseResult(landmarks=landmarks, width=width, height=height)
```

Check `config.data_dir` is the real attribute name in `server/app/config.py` (grep `data_dir`) — if it differs (e.g. `config.data_path`), use that name here and in tests.

- [ ] **Step 4: Run to verify PASS** — `uv run pytest tests/test_segment_engines.py -q` → 3 pass.

- [ ] **Step 5: Real-engine opt-in test** — append to the same test file:

```python
import os

import pytest


@pytest.mark.skipif(os.environ.get("SEGMENT_REAL") != "1", reason="set SEGMENT_REAL=1 to run real engines")
def test_real_engines_smoke(monkeypatch):
    monkeypatch.delenv("SPINE_SERVER_SEGMENT_FAKE", raising=False)
    data = png(320, 640)
    out = remove_background(data)  # downloads u2net on first run
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
    try:
        detect_pose(data)  # downloads pose_landmarker_lite.task; blank image →
    except Exception as err:  # PoseNotFound is the EXPECTED outcome here
        assert type(err).__name__ == "PoseNotFound"
```

- [ ] **Step 6: Full pytest + lint + commit**

```bash
uv run pytest -q && uv run ruff check . && uv run ruff format .
git add server/app/segment/engines.py server/tests/test_segment_engines.py server/tests/conftest.py
git commit -m "P13: rembg + MediaPipe engines with deterministic fake mode"
```

---

### Task 4: `/api/segment` router + API tests

**Files:**

- Create: `server/app/api/segment.py`
- Modify: `server/app/main.py` (import + `app.include_router(segment.router)`)
- Test: `server/tests/test_segment_api.py`

**Interfaces:**

- Consumes: everything from Tasks 1–3; `CurrentUser`, `DbSession` from `app.deps`; `ApiKey` model; `decrypt_secret` from `app.security`; `ProviderError` from `app.providers`.
- Produces: endpoints `POST /api/segment/remove-bg`, `POST /api/segment/pose`, `POST /api/segment/parts`, `GET /api/segment/backends` — consumed by editor Task 5.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_segment_api.py`:

```python
import base64
import io

from PIL import Image


def data_url(w=200, h=400) -> str:
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (120, 60, 20, 255)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_segment_requires_auth(client):
    assert client.post("/api/segment/pose", json={"image": data_url()}).status_code == 401


def test_backends_listing(auth_client):
    res = auth_client.get("/api/segment/backends")
    assert res.status_code == 200
    byname = {b["name"]: b for b in res.json()}
    assert byname["mock"]["has_key"] is True
    assert byname["fal"]["has_key"] is False  # no key stored in this fixture


def test_remove_bg_fake_passthrough(auth_client):
    img = data_url()
    res = auth_client.post("/api/segment/remove-bg", json={"image": img})
    assert res.status_code == 200
    assert res.json()["image"].startswith("data:image/png;base64,")


def test_pose_returns_ten_part_prompts(auth_client):
    res = auth_client.post("/api/segment/pose", json={"image": data_url()})
    assert res.status_code == 200
    body = res.json()
    assert body["width"] == 200 and body["height"] == 400
    assert len(body["parts"]) == 10
    assert body["parts"][0]["name"] == "head"


def test_parts_mock_end_to_end(auth_client):
    res = auth_client.post(
        "/api/segment/parts", json={"image": data_url(), "backend": "mock"}
    )
    assert res.status_code == 200
    parts = res.json()["parts"]
    assert len(parts) == 10
    for p in parts:
        assert p["image"].startswith("data:image/png;base64,")
        assert 0 <= p["x"] and 0 <= p["y"]
        assert p["width"] > 0 and p["height"] > 0
        assert p["x"] + p["width"] <= 200 and p["y"] + p["height"] <= 400


def test_parts_fal_without_key_is_400(auth_client):
    res = auth_client.post(
        "/api/segment/parts", json={"image": data_url(), "backend": "fal"}
    )
    assert res.status_code == 400
    assert "key" in res.json()["detail"].lower()


def test_oversized_image_rejected(auth_client):
    res = auth_client.post("/api/segment/remove-bg", json={"image": data_url(5000, 100)})
    assert res.status_code == 400


def test_too_many_parts_rejected(auth_client):
    parts = [
        {"name": f"p{i}", "points": [{"x": 1, "y": 1, "label": 1}]} for i in range(21)
    ]
    res = auth_client.post(
        "/api/segment/parts", json={"image": data_url(), "backend": "mock", "parts": parts}
    )
    assert res.status_code == 400
```

- [ ] **Step 2: Run to verify FAIL** — 404s (router absent).

- [ ] **Step 3: Implement `server/app/api/segment.py`**

```python
"""Segmentation pipeline (Phase 13 strategy B): remove-bg, pose landmarks,
per-part SAM masks. The fal key is decrypted only here, right before the
call, mirroring generate.py."""

import base64
import io

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import ApiKey
from ..providers import ProviderError
from ..security import decrypt_secret
from ..segment.backends import BACKENDS, FalSam2Backend
from ..segment.cutout import cut_part, png_data_url
from ..segment.engines import PoseNotFound, SegmentUnavailable, detect_pose, remove_background
from ..segment.parts import build_prompts
from ..segment.schemas import PartCut, PartPrompt

router = APIRouter(prefix="/api/segment", tags=["segment"])

MAX_SIDE = 4096
MAX_PARTS = 20


class ImageRequest(BaseModel):
    image: str = Field(min_length=32)


class PartsRequest(ImageRequest):
    backend: str = "mock"
    parts: list[PartPrompt] | None = None


class BackendInfo(BaseModel):
    name: str
    has_key: bool
    approx_cost_usd: float


def _decode(image: str) -> bytes:
    try:
        b64 = image.split(",", 1)[1] if image.startswith("data:") else image
        raw = base64.b64decode(b64)
        with Image.open(io.BytesIO(raw)) as im:
            if max(im.size) > MAX_SIDE:
                raise HTTPException(
                    status_code=400, detail=f"Image larger than {MAX_SIDE}px on a side"
                )
        return raw
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=400, detail="Could not decode image") from err


def _guarded_pose(png: bytes):
    try:
        return detect_pose(png)
    except PoseNotFound as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except SegmentUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


@router.post("/remove-bg", response_model=ImageRequest)
def remove_bg(body: ImageRequest, user: CurrentUser) -> ImageRequest:
    png = _decode(body.image)
    try:
        return ImageRequest(image=png_data_url(remove_background(png)))
    except SegmentUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


class PoseResponse(BaseModel):
    landmarks: dict[str, tuple[float, float, float]]
    width: int
    height: int
    parts: list[PartPrompt]


@router.post("/pose", response_model=PoseResponse)
def pose(body: ImageRequest, user: CurrentUser) -> PoseResponse:
    png = _decode(body.image)
    result = _guarded_pose(png)
    return PoseResponse(
        landmarks=result.landmarks, width=result.width, height=result.height,
        parts=build_prompts(result),
    )


class PartsResponse(BaseModel):
    parts: list[PartCut]


@router.post("/parts", response_model=PartsResponse)
async def parts(body: PartsRequest, user: CurrentUser, db: DbSession) -> PartsResponse:
    png = _decode(body.image)
    backend = BACKENDS.get(body.backend)
    if backend is None:
        raise HTTPException(status_code=400, detail=f"Unknown backend '{body.backend}'")
    prompts = body.parts if body.parts is not None else build_prompts(_guarded_pose(png))
    if len(prompts) > MAX_PARTS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_PARTS} parts per request")
    if isinstance(backend, FalSam2Backend):
        record = db.scalar(
            select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == "fal")
        )
        if record is None:
            raise HTTPException(
                status_code=400,
                detail="No API key stored for 'fal' — add it in the Server dialog",
            )
        backend = backend.with_key(decrypt_secret(record.key_encrypted))
    cuts: list[PartCut] = []
    try:
        for prompt in prompts:
            mask = await backend.mask(png, prompt)
            cut = cut_part(png, mask, prompt.name)
            if cut is not None:
                cuts.append(cut)
    except ProviderError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    return PartsResponse(parts=cuts)


@router.get("/backends", response_model=list[BackendInfo])
def backends(user: CurrentUser, db: DbSession) -> list[BackendInfo]:
    keyed = {k.provider for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id))}
    return [
        BackendInfo(
            name=b.name, has_key=(b.name == "mock" or b.name in keyed),
            approx_cost_usd=b.approx_cost_usd,
        )
        for b in BACKENDS.values()
    ]
```

In `server/app/main.py`: extend the import to `from .api import auth, generate, keys, projects, segment, settings` and add `app.include_router(segment.router)` after the generate router.

- [ ] **Step 4: Run to verify PASS** — `uv run pytest tests/test_segment_api.py -q` → 8 pass; then full `uv run pytest -q` → everything green.

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check . && uv run ruff format .
git add server/app/api/segment.py server/app/main.py server/tests/test_segment_api.py
git commit -m "P13: /api/segment router (remove-bg, pose, parts, backends)"
```

---

### Task 5: Editor — api wrappers, ImageAsset.origin, SegmentModal, toolbar

**Files:**

- Modify: `packages/editor/src/server/api.ts` (append segment section)
- Modify: `packages/editor/src/state/store.ts:17-22` (ImageAsset)
- Create: `packages/editor/src/components/SegmentModal.tsx`
- Modify: `packages/editor/src/components/Toolbar.tsx` (state + button + mount, mirror Generate at lines 33-35 and ~200)
- Modify: `packages/editor/src/styles.css` (small additions at end)

**Interfaces:**

- Consumes: Task 4 endpoints; `useEditor` store (`assets`, `addAssets`, `execute`); core `AddSlot`, `AddSkinAttachment`, `Composite`, `createSlot` (all already imported elsewhere in the editor — import from `@spine-editor/core`).
- Produces: toolbar "Segment" button opening the modal; assets with `origin` metadata.

- [ ] **Step 1: api.ts wrappers** — append (matching the file's existing export style):

```ts
// ---- segmentation (Phase 13) ----

export interface SegPoint {
  x: number;
  y: number;
  label: 0 | 1;
}
export interface SegBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface SegPartPrompt {
  name: string;
  points: SegPoint[];
  box?: SegBox | null;
}
export interface SegPartCut {
  name: string;
  image: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SegBackendInfo {
  name: string;
  has_key: boolean;
  approx_cost_usd: number;
}
export interface SegPoseResponse {
  landmarks: Record<string, [number, number, number]>;
  width: number;
  height: number;
  parts: SegPartPrompt[];
}

export const segmentRemoveBg = (image: string) =>
  request<{ image: string }>('/api/segment/remove-bg', { method: 'POST', body: { image } });
export const segmentPose = (image: string) =>
  request<SegPoseResponse>('/api/segment/pose', { method: 'POST', body: { image } });
export const segmentParts = (image: string, backend: string, parts?: SegPartPrompt[]) =>
  request<{ parts: SegPartCut[] }>('/api/segment/parts', {
    method: 'POST',
    body: { image, backend, ...(parts ? { parts } : {}) },
  });
export const segmentBackends = () => request<SegBackendInfo[]>('/api/segment/backends');
```

Before writing, open `api.ts` and match `request()`'s ACTUAL signature (it may take `(path, init)` with a JSON string body or an options object — mirror how `generateImage` calls it, exactly).

- [ ] **Step 2: ImageAsset origin** — in `store.ts` change lines 17–22 to:

```ts
export interface ImageAsset {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  /** Where this asset was cut from (segmentation): px, top-left origin. */
  origin?: { x: number; y: number; sourceWidth: number; sourceHeight: number };
}
```

Verify project save/load round-trips it: assets are serialized as-is (`project-sync.ts:13` spreads `Object.values(s.assets)`), and load uses the stored objects — grep the project-open path (`replaceProject` callers) and confirm no field whitelist; if one exists, add `origin` passthrough.

- [ ] **Step 3: SegmentModal.tsx** — create with this exact structure (abridged only in CSS classes, which reuse existing ones):

```tsx
import { useEffect, useRef, useState } from 'react';
import { AddSkinAttachment, AddSlot, Composite, createSlot } from '@spine-editor/core';
import {
  segmentBackends,
  segmentParts,
  segmentPose,
  segmentRemoveBg,
  type SegBackendInfo,
  type SegPartCut,
  type SegPartPrompt,
} from '../server/api.js';
import { uniqueName, useEditor, type ImageAsset } from '../state/store.js';

interface ReviewPart {
  prompt: SegPartPrompt;
  cut: SegPartCut | null;
  visible: boolean;
}

const COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#bcf60c',
  '#fabebe',
  '#008080',
];

export function SegmentModal({ onClose }: { onClose: () => void }) {
  const assets = useEditor((s) => s.assets);
  const [sourceName, setSourceName] = useState('');
  const [image, setImage] = useState(''); // current working dataURL
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [beforeBg, setBeforeBg] = useState(''); // undo one step for Remove BG
  const [backends, setBackends] = useState<SegBackendInfo[]>([]);
  const [backend, setBackend] = useState('mock');
  const [parts, setParts] = useState<ReviewPart[]>([]);
  const [selected, setSelected] = useState(0);
  const [placeOnCanvas, setPlaceOnCanvas] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    segmentBackends()
      .then((list) => {
        setBackends(list);
        const fal = list.find((b) => b.name === 'fal' && b.has_key);
        setBackend(fal ? 'fal' : 'mock');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function loadFrom(dataUrl: string) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    setImage(dataUrl);
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    setParts([]);
    setBeforeBg('');
  }

  function pickAsset(name: string) {
    setSourceName(name);
    const a = assets[name];
    if (a) void loadFrom(a.dataUrl);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSourceName(file.name.replace(/\.[a-z]+$/i, ''));
    const reader = new FileReader();
    reader.onload = () => void loadFrom(String(reader.result));
    reader.readAsDataURL(file);
  }

  // redraw canvas: image + overlays
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !imgSize) return;
    const scale = Math.min(1, 420 / imgSize.w, 420 / imgSize.h);
    canvas.width = imgSize.w * scale;
    canvas.height = imgSize.h * scale;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.src = image;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      parts.forEach((p, i) => {
        if (!p.visible) return;
        const color = COLORS[i % COLORS.length]!;
        ctx.strokeStyle = color;
        ctx.fillStyle = color + '44';
        const r = p.cut ?? null;
        const box = r ? { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height } : p.prompt.box;
        if (box) {
          ctx.fillRect(
            box.x0 * scale,
            box.y0 * scale,
            (box.x1 - box.x0) * scale,
            (box.y1 - box.y0) * scale,
          );
          ctx.strokeRect(
            box.x0 * scale,
            box.y0 * scale,
            (box.x1 - box.x0) * scale,
            (box.y1 - box.y0) * scale,
          );
        }
        for (const pt of p.prompt.points) {
          ctx.fillStyle = pt.label === 1 ? '#2e7d32' : '#c62828';
          ctx.beginPath();
          ctx.arc(pt.x * scale, pt.y * scale, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    };
  }, [image, imgSize, parts]);

  function canvasPoint(e: React.MouseEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas || !imgSize) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / imgSize.w;
    return {
      x: Math.round((e.clientX - rect.left) / scale),
      y: Math.round((e.clientY - rect.top) / scale),
    };
  }

  function addPoint(e: React.MouseEvent) {
    const pt = canvasPoint(e);
    const part = parts[selected];
    if (!pt || !part) return;
    const label = e.altKey ? 0 : 1;
    const next = [...parts];
    next[selected] = {
      ...part,
      prompt: { ...part.prompt, points: [...part.prompt.points, { ...pt, label }] },
    };
    setParts(next);
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const onRemoveBg = () =>
    run(async () => {
      setBeforeBg(image);
      const res = await segmentRemoveBg(image);
      await loadFrom(res.image);
      setBeforeBg(image);
    });

  const onDetect = () =>
    run(async () => {
      const res = await segmentParts(image, backend);
      const pose = await segmentPose(image);
      const prompts = new Map(pose.parts.map((p) => [p.name, p]));
      setParts(
        res.parts.map((cut) => ({
          prompt: prompts.get(cut.name) ?? { name: cut.name, points: [] },
          cut,
          visible: true,
        })),
      );
      setSelected(0);
    });

  const onRerunPart = (index: number) =>
    run(async () => {
      const part = parts[index];
      if (!part) return;
      const res = await segmentParts(image, backend, [part.prompt]);
      const next = [...parts];
      next[index] = { ...part, cut: res.parts[0] ?? null };
      setParts(next);
    });

  function onImport() {
    if (!imgSize) return;
    const state = useEditor.getState();
    const newAssets: ImageAsset[] = [];
    const commands = [];
    for (const part of parts) {
      if (!part.cut) continue;
      const cut = part.cut;
      let name = part.prompt.name;
      let n = 2;
      while (state.assets[name] || newAssets.some((a) => a.name === name)) {
        name = `${part.prompt.name}-${n++}`;
      }
      newAssets.push({
        name,
        dataUrl: cut.image,
        width: cut.width,
        height: cut.height,
        origin: { x: cut.x, y: cut.y, sourceWidth: imgSize.w, sourceHeight: imgSize.h },
      });
      if (placeOnCanvas) {
        const slotName = uniqueName(name, (s) => state.doc.data.slots.some((sl) => sl.name === s));
        commands.push(new AddSlot(createSlot(slotName, 'root', { attachment: name })));
        commands.push(
          new AddSkinAttachment('default', slotName, name, {
            x: cut.x + cut.width / 2 - imgSize.w / 2,
            y: imgSize.h / 2 - (cut.y + cut.height / 2),
            width: cut.width,
            height: cut.height,
          }),
        );
      }
    }
    if (newAssets.length === 0) {
      setError('No parts to import');
      return;
    }
    state.addAssets(newAssets);
    if (commands.length > 0) {
      state.execute(new Composite('Import segmented parts', commands));
    }
    setNotice(`Imported ${newAssets.length} parts${placeOnCanvas ? ' onto the canvas' : ''}.`);
  }

  const selectedBackend = backends.find((b) => b.name === backend);

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div
        className="shortcuts-panel server-modal generate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-title">Segment character (AI)</div>
        <div className="gen-options">
          <select value={sourceName} onChange={(e) => pickAsset(e.target.value)}>
            <option value="">— pick an imported image —</option>
            {Object.keys(assets).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <input type="file" accept="image/png,image/webp,image/jpeg" onChange={onFile} />
        </div>
        {image && (
          <>
            <div className="gen-options">
              <button disabled={busy} onClick={() => void onRemoveBg()}>
                Remove BG
              </button>
              {beforeBg && (
                <button disabled={busy} onClick={() => void loadFrom(beforeBg)}>
                  Undo BG
                </button>
              )}
              <select value={backend} onChange={(e) => setBackend(e.target.value)}>
                {backends.map((b) => (
                  <option key={b.name} value={b.name} disabled={!b.has_key}>
                    {b.name}
                    {b.has_key ? '' : ' (no key)'}
                  </option>
                ))}
              </select>
              <button disabled={busy} onClick={() => void onDetect()}>
                {busy ? 'Working…' : 'Detect parts'}
              </button>
            </div>
            {selectedBackend && (
              <div className="gen-estimate">
                {selectedBackend.name === 'mock'
                  ? 'mock: free box masks (no AI call) — for trying the flow'
                  : `~$${(selectedBackend.approx_cost_usd * 10).toFixed(2)} for ~10 parts, billed to your fal key`}
              </div>
            )}
            <div className="segment-layout">
              <canvas
                ref={canvasRef}
                className="segment-canvas"
                title="Click: add foreground point to selected part · Alt+click: background point"
                onClick={addPoint}
              />
              {parts.length > 0 && (
                <div className="segment-parts">
                  {parts.map((p, i) => (
                    <div key={i} className={`key-row${i === selected ? ' selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={p.visible}
                        onChange={() => {
                          const next = [...parts];
                          next[i] = { ...p, visible: !p.visible };
                          setParts(next);
                        }}
                      />
                      <input
                        value={p.prompt.name}
                        onFocus={() => setSelected(i)}
                        onChange={(e) => {
                          const next = [...parts];
                          next[i] = { ...p, prompt: { ...p.prompt, name: e.target.value } };
                          setParts(next);
                        }}
                      />
                      <button
                        disabled={busy}
                        title="Re-run this part"
                        onClick={() => void onRerunPart(i)}
                      >
                        ↻
                      </button>
                      <button
                        disabled={busy}
                        title="Remove part"
                        onClick={() => setParts(parts.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {parts.length > 0 && (
              <div className="gen-options">
                <label className="row-inline">
                  <input
                    type="checkbox"
                    checked={placeOnCanvas}
                    onChange={(e) => setPlaceOnCanvas(e.target.checked)}
                  />
                  Place on canvas
                </label>
                <button disabled={busy} onClick={onImport}>
                  Import parts
                </button>
              </div>
            )}
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}
        <button className="close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Toolbar** — mirror the Generate wiring: add `const [showSegment, setShowSegment] = useState(false);` next to line 35, a button right after the Generate button (`title={serverUser ? 'Segment a character image into parts (AI)' : 'Sign in first (Server)'}`, label `Segment`, `onClick={() => setShowSegment(true)}`), and `{showSegment && <SegmentModal onClose={() => setShowSegment(false)} />}` where GenerateModal is mounted; import at top.

- [ ] **Step 5: styles.css** — append:

```css
.segment-layout {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.segment-canvas {
  border: 1px solid #333;
  cursor: crosshair;
  max-width: 420px;
}
.segment-parts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 420px;
  overflow-y: auto;
}
.segment-parts .key-row.selected {
  outline: 1px solid #4363d8;
}
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @spine-editor/editor typecheck && pnpm lint && pnpm format:check` (prettier --write touched files if needed).

```bash
git add packages/editor/src/server/api.ts packages/editor/src/state/store.ts packages/editor/src/components/SegmentModal.tsx packages/editor/src/components/Toolbar.tsx packages/editor/src/styles.css
git commit -m "P13: Segment dialog — review masks, point prompts, import parts"
```

---

### Task 6: E2E flow + docs + full verification

**Files:**

- Modify: `packages/editor/e2e/server.mjs` (append segment flow before the final summary; requires server started with `SPINE_SERVER_SEGMENT_FAKE=1`)
- Modify: `PLAN.md` (§7.6 Phase 13 note), `CLAUDE.md` (project summary sentence)

- [ ] **Step 1: server.mjs flow** — after the existing mock-generate/import-asset flow (search for the generate section; the imported asset name from that flow is reused here), append:

```js
// ---- Phase 13: segment the generated asset into parts (fake engines + mock backend)
console.error('[e2e] segment flow');
await page.click('button:has-text("Segment")');
await page.selectOption('.generate-modal select', { index: 1 }); // first imported asset
await page.click('button:has-text("Detect parts")');
await page.waitForSelector('.segment-parts .key-row', { timeout: 15000 });
const partCount = await page.locator('.segment-parts .key-row').count();
// rename the first part
const firstName = page
  .locator(
    '.segment-parts .key-row input[type=text], .segment-parts .key-row input:not([type=checkbox])',
  )
  .first();
await firstName.fill('my-head');
await page.click('button:has-text("Import parts")');
await page.waitForSelector('.form-notice');
const segState = await page.evaluate(() => {
  const s = window.__spineEditor.getState();
  return {
    assetNames: Object.keys(s.assets),
    slotNames: s.doc.data.slots.map((sl) => sl.name),
    headOrigin: s.assets['my-head']?.origin ?? null,
  };
});
await page.click('.generate-modal .close');
```

and add to the final summary object:

```js
segmentParts: partCount,
segmentAssetImported: segState.assetNames.includes('my-head'),
segmentSlotPlaced: segState.slotNames.includes('my-head'),
segmentOriginSaved: !!segState.headOrigin,
```

Adjust selectors to the real DOM after Task 5 (run once headed if needed); the flow must assert: ≥ 8 parts detected, renamed asset exists, slot placed, origin persisted.

- [ ] **Step 2: Run the full e2e**

```bash
pnpm --filter @spine-editor/editor build
(cd packages/editor && npx vite preview --port 4173 &)
(cd server && SPINE_SERVER_SEGMENT_FAKE=1 SPINE_SERVER_DATA_DIR=/tmp/spine-e2e-data uv run uvicorn app.main:app --port 8100 &)
sleep 3
node packages/editor/e2e/server.mjs e2e-out/server http://localhost:4173/ /tmp/spine-e2e-data
```

Expected: JSON summary with the four new `segment*` fields true/≥8 and all pre-existing fields unchanged. Kill both background processes after (`lsof -ti :4173 :8100 | xargs kill`).

- [ ] **Step 3: Docs**

- `PLAN.md` §7.6 Phase 13: add a `> Ghi chú thực hiện:` block (same style as Phases 11–12) summarizing slice 1 done (rembg+MediaPipe local, SAM fal BYOK + mock, review dialog, import + place-on-canvas, fake-engine env for CI) and noting slice 2 leftovers (inpaint, strategy A, MCP tool, SAM local).
- `CLAUDE.md`: in the Phase-12/bridge sentence area, append one sentence: Phase 13 slice 1 done — `/api/segment` (rembg, MediaPipe pose, SAM2 via fal BYOK or mock) + editor Segment dialog importing parts as positioned assets; `SPINE_SERVER_SEGMENT_FAKE=1` for CI/e2e.

- [ ] **Step 4: Full verification + commit**

```bash
(cd server && uv run pytest -q && uv run ruff check . && uv run ruff format --check .)
pnpm typecheck && pnpm test && pnpm lint && pnpm format:check
git add packages/editor/e2e/server.mjs PLAN.md CLAUDE.md
git commit -m "P13: e2e segment flow + docs"
```

---

### Final acceptance (spec §6)

- [ ] `uv run pytest` green, offline, no model downloads (§6.1)
- [ ] e2e `server.mjs` passes the segment flow with fake engines (§6.2)
- [ ] Manual real run on dev machine: real rembg + MediaPipe (+ fal if key) on a real character image → parts land correctly (§6.3) — run once, note results
- [ ] ruff + full Node suite green (§6.4)
- [ ] PLAN.md + CLAUDE.md updated (§6.5)
