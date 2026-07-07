---
name: spine-animating
description: Animate a rigged Spine skeleton via MCP tools — keyframes, curves, timing patterns for idle/walk/attack cycles. Use when asked to create or tune an animation.
---

# Animating a skeleton

Prereq: a rigged skeleton (see spine-rigging). `get_skeleton_tree` lists bones
and existing animations.

## Keyframe semantics (critical)

`set_bone_keyframe` values are RELATIVE TO THE SETUP POSE:

- `rotate`: `value` in degrees is ADDED to the bone's setup rotation. value 0
  = setup pose, not "pointing right".
- `translate`: `x`/`y` offsets added to setup position.
- `scale`: `x`/`y` FACTORS multiplied with setup scale — 1 means unchanged.
- Times are seconds. Curves: omit = linear, `"stepped"` = hold, or bezier
  `[cx1, cy1, cx2, cy2]` per channel (cx in seconds between the two keys, cy in
  value units) — translate/scale need 8 numbers (x block then y block).

## Workflow

1. `create_animation` — switches the editor to animate mode.
2. Key the EXTREME poses first (e.g. contact and passing poses of a walk), then
   in-betweens only where the interpolation looks wrong.
3. For a seamless loop, the last key of every timeline must equal its first key
   (same values, final time = cycle duration).
4. **Check visually after every pose**: `preview_at_time` then
   `screenshot_viewport`. Sample midpoints too — interpolation surprises live
   between keys. `play_animation` is for the human watching the editor.
5. `set_slot_attachment_keyframe` switches images over time (blinks, mouth
   shapes); `attachment: null` hides the slot.
6. `validate_project`, then `export_spine_json`.

## Timing patterns

- Idle: 1-2s loop; torso rotate ±2-4°, head slightly delayed (offset its keys
  ~0.1s after the torso's), gentle hip bob (translate y ±3-8).
- Walk cycle: 0.8-1.2s; legs opposite phase (offset by half the cycle), arms
  counter-swing opposite their leg, hip lowest at contact, highest at passing.
- Attack: anticipation (wind-up, ~20% of duration, eased in), fast strike
  (stepped or sharp bezier), recovery back to start values.
- Prefer easing (bezier) over linear for organic motion; keep linear for
  mechanical things.

## Gotchas

- Keying the same bone/timeline/time again REPLACES that key (including its
  curve) — re-pass `curve` when updating a key.
- The evaluator applies bone timelines, slot attachment timelines, IK
  (solve + timeline mix/bendPositive), transform constraints, slot colors
  (`set_slot_color_keyframe`, rgba+alpha) and mesh deform. Animate a limb by
  keying translate on its IK TARGET bone. Draw-order timelines and
  path/physics constraints are stored/exported but not previewed.
- Squash/flags/hair: `create_mesh` turns a slot's image into a grid mesh,
  then `set_deform_keyframe` moves vertices (x,y offsets, bone-local).
- Events: `set_event` to define, `set_event_keyframe` to fire at a time —
  they export correctly; previews don't visualize them.
- Undo works per keyframe; `delete_bone_keyframe` needs the exact key time.
