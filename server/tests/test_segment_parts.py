from app.segment.parts import build_prompts
from app.segment.schemas import PoseResult

FRACTIONS = {
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


def pose(w=400, h=800, drop: set[str] | None = None, vis=1.0) -> PoseResult:
    lm = {
        name: (fx * w, fy * h, 0.0 if drop and name in drop else vis)
        for name, (fx, fy) in FRACTIONS.items()
    }
    return PoseResult(landmarks=lm, width=w, height=h)


def test_full_pose_yields_all_ten_parts():
    names = [p.name for p in build_prompts(pose())]
    assert names == [
        "head",
        "torso",
        "upper_arm_l",
        "lower_arm_l",
        "upper_arm_r",
        "lower_arm_r",
        "upper_leg_l",
        "lower_leg_l",
        "upper_leg_r",
        "lower_leg_r",
    ]


def test_limb_prompts_sit_on_the_correct_side():
    by_name = {p.name: p for p in build_prompts(pose())}
    left = by_name["upper_arm_l"]
    right = by_name["upper_arm_r"]
    assert all(pt.x < 200 for pt in left.points if pt.label == 1)
    assert all(pt.x > 200 for pt in right.points if pt.label == 1)


def test_fg_points_lie_inside_box():
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
