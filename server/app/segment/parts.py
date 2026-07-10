"""Turn pose landmarks into per-part SAM prompts. Pure logic — no models.

Foreground points sit along the limb segment (25/50/75%), background points
at neighbouring part centers, and the box wraps the segment with padding so
SAM has both a hint and a bound.
"""

from .schemas import Box, PartPrompt, Point, PoseResult

# MediaPipe BlazePose 33-landmark indices for the subset we use.
LANDMARK_INDICES: dict[str, int] = {
    "nose": 0,
    "left_ear": 7,
    "right_ear": 8,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_elbow": 13,
    "right_elbow": 14,
    "left_wrist": 15,
    "right_wrist": 16,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
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

# Canonical part order for strategy-A generation and UI defaults.
DEFAULT_PART_NAMES: list[str] = ["head", "torso", *[name for name, _, _ in LIMBS]]

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
        name: (x, y) for name, (x, y, v) in pose.landmarks.items() if v >= MIN_VISIBILITY
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

    # head — around nose/ears, background at the torso center.
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
            [
                (nose[0] - half, nose[1] - ear_dist * 1.4),
                (nose[0] + half, nose[1] + ear_dist * 1.2),
            ],
            0,
            pose.width,
            pose.height,
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
