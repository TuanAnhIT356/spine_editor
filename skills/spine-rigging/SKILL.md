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
   - a target bone parented to root). NOTE: the editor's evaluator does not
     apply IK yet — the constraint exports correctly for runtimes, but the
     viewport/preview ignores it, so pose limbs with direct rotations for now.
6. **Look at your work**: `screenshot_viewport` after each stage. If bones sit
   in the wrong place, fix with `set_bone_transform` and screenshot again.
7. Finish with `validate_project` — the issues array must be empty.

## Checks and gotchas

- Every mutation is undoable: a wrong step is one `undo` away.
- Names must be unique per type; `rename_bone` cascades all references safely.
- Removing a bone fails while children/slots/constraints reference it — that
  error tells you what to detach first.
- The screenshot has a transparent background and shows the world grid
  (100-unit cells) — use it to judge scale and placement.
