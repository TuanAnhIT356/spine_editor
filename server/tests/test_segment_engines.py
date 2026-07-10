import io
import os

import pytest
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


@pytest.mark.skipif(
    os.environ.get("SEGMENT_REAL") != "1", reason="set SEGMENT_REAL=1 to run real engines"
)
def test_real_engines_smoke(monkeypatch):
    monkeypatch.delenv("SPINE_SERVER_SEGMENT_FAKE", raising=False)
    data = png(320, 640)
    out = remove_background(data)  # downloads u2net on first run
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
    try:
        detect_pose(data)  # downloads pose_landmarker_lite.task; blank image →
    except Exception as err:  # PoseNotFoundError is the EXPECTED outcome here
        assert type(err).__name__ == "PoseNotFoundError"
