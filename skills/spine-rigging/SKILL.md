---
name: spine-rigging
description: Rig a 2D character in the Spine editor via MCP tools — build a bone hierarchy, import and attach images, set draw order, add IK. Use when asked to create or edit a skeleton/rig.
---

# Rigging a character

Prereq: the `spine-editor` MCP server is configured and the editor tab is open
(it auto-connects). `get_project_state` errors with "No editor connected" until
then. Call `new_project` only when starting from scratch — it wipes the document.

## Coordinate system

Y is UP, rotations are degrees counter-clockwise. A bone's x/y are in its
PARENT's space; `length` extends along the bone's +X axis. Convention for limbs:
point the bone's +X from joint to joint (e.g. a thigh bone at rotation -90
points down), so child bones sit at `x = parent.length`.

## Workflow

1. `get_project_state` — see what exists before touching anything.
2. Build the hierarchy trunk-first with `add_bone`: root → hip → torso → head,
   then limbs out from the trunk. Give every bone a real `length` (it defines
   the visual bone and helps later IK/mesh work). Chain children at
   `x = parent.length`.
3. `import_image` (data URL) then `attach_image` to the owning bone. The slot
   and attachment take the image name. Attachments render centered on the bone
   origin — offset/rotate the attachment relative to the bone afterwards via
   the exported JSON conventions if needed (attachment editing tools land in a
   later phase; prefer positioning bones to match the art).
4. `set_draw_order` — index 0 draws furthest behind. Typical order: far limbs,
   torso, near limbs, head.
5. `add_ik_constraint` for legs/arms you want to pose by target (1-2 bone chain
   plus a target bone parented to root). IK IS evaluated in the viewport: a
   2-bone chain bends so the lower bone's tip reaches the target
   (bendPositive picks the side); move the target bone to pose the limb.
   softness/compress/stretch are exported but not applied in previews.
6. **Look at your work**: `screenshot_viewport` after each stage. If bones sit
   in the wrong place, fix with `set_bone_transform` and screenshot again.
7. Finish with `validate_project` — the issues array must be empty.

## Constraints beyond IK

- `add_transform_constraint` copies a target bone's rotation/position/scale
  onto other bones with per-channel mixes — great for counter-rotation or
  keeping accessories aligned.
- `add_path` puts a bezier spline on a slot; `add_path_constraint` then pins a
  bone chain to it (`positionMode`/`spacingMode`/`rotateMode`). Both are
  evaluated in the viewport — animate the constraint's `position` timeline for
  conveyor/orbit motion. Path points are editable in the editor UI (Edit).
- `add_physics_constraint` gives a bone spring physics (tails, hair, cloth):
  set `rotate: 1` for pendulum swing or `x/y: 1` for positional jiggle, tune
  `inertia`/`strength`/`damping`/`gravity`. Preview is deterministic in the
  editor; the exported data runs the official runtime's simulation in-game.

## Meshes, weights, clipping (advanced rigging)

- `create_mesh` converts a slot's region image into a deformable grid mesh
  (`cols`/`rows` control density). Then `set_deform_keyframe` animates vertices
  or `set_mesh_vertices` reshapes the base mesh.
- `bind_weights` makes a mesh follow MULTIPLE bones (limbs, cloth, hair):
  pass the bone chain — every vertex gets distance-based weights (≤4 bones,
  normalized) and the mesh deforms automatically when those bones move.
  Verify with a screenshot after rotating a bound bone.
- `add_clipping` masks slots: it creates a clipping slot placed just before
  the target slot in the draw order; everything from there until `end` renders
  only inside the polygon. The polygon IS evaluated/previewed in the viewport.
- `add_bounding_box` (hit-test polygons) and `add_point` (named anchors like
  muzzles/hands) attach game metadata to slots; both render as outlines in the
  editor and round-trip to the exported JSON.

## Checks and gotchas

- Every mutation is undoable: a wrong step is one `undo` away.
- Names must be unique per type; `rename_bone` cascades all references safely.
- Removing a bone fails while children/slots/constraints reference it — that
  error tells you what to detach first.
- The screenshot has a transparent background and shows the world grid
  (100-unit cells) — use it to judge scale and placement.
