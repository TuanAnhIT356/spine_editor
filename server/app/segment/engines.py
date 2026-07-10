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


class SegmentUnavailableError(Exception):
    """Dependency/model missing — surfaced as HTTP 503."""


class PoseNotFoundError(Exception):
    """No (usable) person detected — surfaced as HTTP 422."""


POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)

# Canonical humanoid used by the fake pose (fractions of width/height).
FAKE_POSE_FRACTIONS: dict[str, tuple[float, float]] = {
    "nose": (0.50, 0.10),
    "left_ear": (0.44, 0.10),
    "right_ear": (0.56, 0.10),
    "left_shoulder": (0.35, 0.22),
    "right_shoulder": (0.65, 0.22),
    "left_elbow": (0.28, 0.35),
    "right_elbow": (0.72, 0.35),
    "left_wrist": (0.24, 0.48),
    "right_wrist": (0.76, 0.48),
    "left_hip": (0.42, 0.50),
    "right_hip": (0.58, 0.50),
    "left_knee": (0.40, 0.70),
    "right_knee": (0.60, 0.70),
    "left_ankle": (0.39, 0.92),
    "right_ankle": (0.61, 0.92),
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
        raise SegmentUnavailableError("rembg not installed — run `uv sync` in server/") from err
    if _rembg_session is None:
        _rembg_session = new_session("u2net")
    return remove(png, session=_rembg_session)


def detect_pose(png: bytes) -> PoseResult:
    width, height = _image_size(png)
    if _fake_enabled():
        landmarks = {
            name: (fx * width, fy * height, 1.0) for name, (fx, fy) in FAKE_POSE_FRACTIONS.items()
        }
        return PoseResult(landmarks=landmarks, width=width, height=height)

    global _pose_landmarker
    try:
        import mediapipe as mp
        import numpy as np
    except ImportError as err:  # pragma: no cover - depends on install
        raise SegmentUnavailableError("mediapipe not installed — run `uv sync` in server/") from err

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
        raise PoseNotFoundError("No person detected in the image")
    pose = result.pose_landmarks[0]
    landmarks: dict[str, tuple[float, float, float]] = {}
    for name, idx in LANDMARK_INDICES.items():
        lm = pose[idx]
        landmarks[name] = (lm.x * width, lm.y * height, lm.visibility or 0.0)
    return PoseResult(landmarks=landmarks, width=width, height=height)
