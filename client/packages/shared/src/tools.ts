/**
 * Single source of truth for the 62 editor tools: name, description, zod
 * params shape, the bridge op that implements it, and how to present the
 * result. Consumed by the MCP server (registers them as MCP tools) and by
 * the editor's chat client (sends JSON Schemas to the chat loop and
 * executes dispatched ops).
 */

import { z, type ZodRawShape } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { BridgeOp } from './index.js';

export interface ToolDef {
  name: string;
  description: string;
  shape: ZodRawShape;
  op: BridgeOp;
  result: 'text' | 'image' | 'atlas';
}

const curveSchema = z
  .union([z.literal('stepped'), z.array(z.number())])
  .optional()
  .describe(
    'Omit for linear; "stepped" to hold; or bezier control values (4 numbers per channel: cx1, cy1, cx2, cy2 in time/value space).',
  );

function def(op: BridgeOp, description: string, shape: ZodRawShape, name: string = op): ToolDef {
  return { name, description, shape, op, result: 'text' };
}

export const TOOL_DEFS: ToolDef[] = [
  // ---------------------------------------------------------------- observe
  def(
    'get_project_state',
    'Full editor state: mode, selection, current animation/time, imported images, the whole Spine JSON document and validation issues. Call this first to orient yourself.',
    {},
  ),
  def(
    'get_skeleton_tree',
    'Compact rig overview: bones (name/parent/transform), slots with draw order, IK constraints, and animation names.',
    {},
  ),
  {
    name: 'screenshot_viewport',
    description:
      'PNG screenshot of the editor viewport showing the current pose. Use after edits and after preview_at_time to SEE the result — this is your visual feedback loop.',
    shape: {},
    op: 'screenshot',
    result: 'image',
  },
  def(
    'validate',
    'Referential-integrity check. Returns issues (empty array = clean). Run before exporting.',
    {},
    'validate_project',
  ),
  // ------------------------------------------------------------------- rig
  def(
    'new_project',
    'Replace the current document with an empty skeleton (root bone + default skin). Destructive — asks for no confirmation.',
    {},
  ),
  def(
    'add_bone',
    "Add a bone. x/y are in the parent bone's space; rotation in degrees CCW; length is visual/tooling length along the bone's +X axis. Returns the created name.",
    {
      parent: z.string().describe('Parent bone name (the root bone is "root").'),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      rotation: z.number().optional(),
      length: z.number().optional(),
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
    },
  ),
  def(
    'set_bone_transform',
    "Patch a bone's setup-pose transform (only the fields you pass change).",
    {
      bone: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      rotation: z.number().optional(),
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      shearX: z.number().optional(),
      shearY: z.number().optional(),
      length: z.number().optional(),
    },
  ),
  def('rename_bone', 'Rename a bone; all references (slots, constraints, timelines) follow.', {
    from: z.string(),
    to: z.string(),
  }),
  def('remove_bone', 'Remove a bone (fails while children/slots/constraints still reference it).', {
    name: z.string(),
  }),
  def('reparent_bone', 'Move a bone under a new parent (local transform values are kept).', {
    bone: z.string(),
    parent: z.string(),
  }),
  def(
    'import_image',
    'Import an image (data URL) into the project so it can be attached to bones.',
    {
      name: z.string().describe('Asset name without extension, e.g. "arm-upper".'),
      dataUrl: z.string().describe('data:image/png;base64,... payload.'),
    },
  ),
  def(
    'import_audio',
    'Import an audio clip (data URL) as a project audio asset. Reference it from an event via set_event { audio: <asset> } — the editor then plays it during playback/scrub and shows its waveform in the dopesheet.',
    {
      name: z.string().describe('Asset name without extension, e.g. "footstep".'),
      dataUrl: z.string().describe('data:audio/wav;base64,... payload.'),
    },
  ),
  def(
    'segment_image',
    'Segment an imported image asset into body parts (head/torso/limbs) via the opt-in backend (editor must be signed in to the server). backend "mock" is free; "fal"/"local" need setup. Imports the parts as assets and, by default, places them on the canvas as root slots.',
    {
      asset: z.string().describe('Name of an imported image asset'),
      backend: z.string().optional().describe('Segment backend: mock (default), fal, local'),
      place_on_canvas: z.boolean().optional().describe('Default true'),
    },
  ),
  def(
    'attach_image',
    'Create a slot on a bone showing an imported image as a region attachment (slot + attachment named after the image). Returns the slot name.',
    { asset: z.string(), bone: z.string() },
  ),
  def(
    'generate_image',
    'Generate character art with an AI provider (runs on the opt-in backend using the ' +
      "signed-in user's stored API key) and import it as a project image. Provider " +
      '"mock" is free and local (flat color) — use it for tests. Returns the asset name.',
    {
      provider: z
        .enum(['openai', 'stability', 'runware', 'fal', 'mock'])
        .describe('openai/runware support transparent backgrounds.'),
      prompt: z.string().describe('Describe the character or part; be specific about pose/style.'),
      size: z.string().optional().describe('e.g. "1024x1024" (default).'),
      transparent: z.boolean().optional().describe('Default true; required for game parts.'),
      name: z.string().optional().describe('Asset name; auto-generated when omitted.'),
    },
  ),
  def('set_draw_order', 'Move a slot to a draw-order index (0 = drawn first / furthest behind).', {
    slot: z.string(),
    index: z.number().int().min(0),
  }),
  def('add_ik_constraint', 'Add an IK constraint: 1-2 chained bones reach toward a target bone.', {
    name: z.string(),
    bones: z.array(z.string()).min(1).max(2),
    target: z.string(),
    mix: z.number().optional(),
    bendPositive: z.boolean().optional(),
    order: z.number().optional(),
  }),
  // --------------------------------------------------------------- animate
  def(
    'create_animation',
    'Create an animation and switch the editor to animate mode with it active.',
    {
      name: z.string(),
    },
  ),
  def(
    'set_bone_keyframe',
    'Set a keyframe on a bone timeline. VALUES ARE RELATIVE TO THE SETUP POSE: rotate/translate/shear values are offsets added to setup; scale values are factors multiplied with setup (1 = unchanged). rotate uses "value"; translate/scale/shear use x/y.',
    {
      animation: z.string(),
      bone: z.string(),
      timeline: z.enum(['rotate', 'translate', 'scale', 'shear']),
      time: z.number().min(0).describe('Seconds.'),
      value: z.number().optional().describe('For rotate (degrees offset).'),
      x: z.number().optional(),
      y: z.number().optional(),
      curve: curveSchema,
    },
  ),
  def('delete_bone_keyframe', 'Delete the keyframe at an exact time on a bone timeline.', {
    animation: z.string(),
    bone: z.string(),
    timeline: z.enum(['rotate', 'translate', 'scale', 'shear']),
    time: z.number().min(0),
  }),
  def(
    'set_slot_attachment_keyframe',
    'Key which attachment a slot shows at a time (frame-by-frame switching). attachment: null hides the slot.',
    {
      animation: z.string(),
      slot: z.string(),
      time: z.number().min(0),
      attachment: z.string().nullable(),
    },
  ),
  def(
    'preview',
    'Pose the viewport at a time in an animation (pauses playback). Follow with screenshot_viewport to see it. Returns the animation duration.',
    { animation: z.string().optional(), time: z.number().min(0) },
    'preview_at_time',
  ),
  def(
    'play',
    'Start looping playback in the editor (visual check for a human watching; use preview_at_time + screenshots for your own checks).',
    { animation: z.string().optional(), loop: z.boolean().optional() },
    'play_animation',
  ),
  def('stop', 'Pause playback; returns the current time.', {}, 'stop_playback'),
  def('undo', 'Undo the last edit (AI and user edits share one history).', {}),
  def('redo', 'Redo the last undone edit.', {}),
  def(
    'create_mesh',
    "Convert a slot's region attachment into a deformable grid mesh (cols x rows cells). Vertices run row by row from the image's top-left; each vertex is an x,y pair. Use set_deform_keyframe afterwards to animate them.",
    {
      slot: z.string(),
      cols: z.number().int().min(1).optional(),
      rows: z.number().int().min(1).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    },
  ),
  def(
    'set_deform_keyframe',
    "Key vertex offsets on a mesh attachment (default skin). vertices = x,y offset pairs added to the setup vertices; optional offset = start index into the flattened array for sparse keys. Values are in the bone's local space.",
    {
      animation: z.string(),
      slot: z.string(),
      attachment: z.string(),
      time: z.number().min(0),
      vertices: z.array(z.number()),
      offset: z.number().int().min(0).optional(),
      curve: curveSchema,
    },
  ),
  def(
    'set_slot_color_keyframe',
    'Key a slot\'s tint color (8-digit rgba hex like "ff8800ff"). Evaluated in previews; curve blocks are per r/g/b/a channel.',
    {
      animation: z.string(),
      slot: z.string(),
      time: z.number().min(0),
      color: z.string().regex(/^[0-9a-fA-F]{8}$/),
      curve: curveSchema,
    },
  ),
  def('set_event', 'Define (or redefine) a named event with default payload values.', {
    name: z.string(),
    int: z.number().int().optional(),
    float: z.number().optional(),
    string: z.string().optional(),
    audio: z.string().optional(),
    volume: z.number().optional(),
    balance: z.number().optional(),
  }),
  def(
    'set_event_keyframe',
    'Fire a defined event at a time in an animation (payload fields override the defaults).',
    {
      animation: z.string(),
      name: z.string(),
      time: z.number().min(0),
      int: z.number().int().optional(),
      float: z.number().optional(),
      string: z.string().optional(),
      volume: z.number().optional(),
      balance: z.number().optional(),
    },
  ),
  def('delete_event_keyframe', 'Remove an event key (matched by event name and time).', {
    animation: z.string(),
    name: z.string(),
    time: z.number().optional(),
  }),
  def(
    'set_draw_order_keyframe',
    'Key the slot draw order at a time. Offsets move slots from their setup index (offset = targetIndex - setupIndex); pass an empty array to key a reset to the setup order. Draw order keys are stepped (no interpolation).',
    {
      animation: z.string(),
      time: z.number().optional(),
      offsets: z.array(z.object({ slot: z.string(), offset: z.number() })),
    },
  ),
  def('delete_draw_order_keyframe', 'Remove the draw order key at a time.', {
    animation: z.string(),
    time: z.number().optional(),
  }),
  def(
    'shift_keys',
    "Retime bone keys in one undo step: t' = pivot + (t - pivot) * scale + offset. Filters: bone (one bone only), timeline (one timeline only). Bezier handles move with their keys. Fails if the retime would collide two keys.",
    {
      animation: z.string(),
      bone: z.string().optional(),
      timeline: z.string().optional(),
      offset: z.number().optional(),
      scale: z.number().optional(),
      pivot: z.number().optional(),
    },
  ),
  def('set_playback_speed', 'Set the editor playback rate multiplier (0.1–4; 1 = realtime).', {
    speed: z.number(),
  }),
  def(
    'set_mesh_vertices',
    "Replace a vertex-based attachment's vertices (mesh/boundingbox/clipping). Unweighted: x,y pairs in the slot bone's space matching the vertex count. Weighted meshes accept the full influence layout (boneCount, then boneIndex,x,y,weight per influence).",
    {
      slot: z.string(),
      attachment: z.string().optional().describe("Defaults to the slot's active attachment."),
      vertices: z.array(z.number()),
    },
  ),
  def(
    'bind_weights',
    'Convert an unweighted mesh to bone weights: each vertex gets distance-based weights over the given bones (max 4 influences, normalized). After binding, bones deform the mesh automatically.',
    {
      slot: z.string(),
      attachment: z.string().optional(),
      bones: z.array(z.string()).describe('Bone names to bind (e.g. a limb chain).'),
    },
  ),
  def(
    'edit_mesh',
    "Edit mesh geometry: add/remove a vertex (automatic Delaunay retriangulation), weld near-duplicate vertices, or reset to a fresh 3x3 grid. Geometry changes clear the mesh's deform keys (one undo step, like Spine). Coordinates are in the slot bone's local space.",
    {
      slot: z.string().describe('Slot whose mesh attachment to edit'),
      attachment: z
        .string()
        .optional()
        .describe('Attachment name (defaults to the active attachment)'),
      action: z.enum(['add_vertex', 'remove_vertex', 'weld', 'reset']),
      x: z.number().optional().describe('add_vertex: local x'),
      y: z.number().optional().describe('add_vertex: local y'),
      vertexIndex: z.number().int().optional().describe('remove_vertex: vertex index to remove'),
      threshold: z.number().optional().describe('weld: merge distance (default 1)'),
    },
  ),
  def(
    'adjust_weights',
    'Weight tools for a mesh: auto (recompute distance-based weights), smooth (average with neighbors), prune (drop small influences), swap (exchange two bones), remove_bone (unbind one bone, re-normalizing the rest).',
    {
      slot: z.string().describe('Slot whose mesh attachment to adjust'),
      attachment: z
        .string()
        .optional()
        .describe('Attachment name (defaults to the active attachment)'),
      action: z.enum(['auto', 'smooth', 'prune', 'swap', 'remove_bone']),
      bones: z
        .array(z.string())
        .optional()
        .describe('auto: bones to bind (defaults to currently bound)'),
      iterations: z.number().int().optional().describe('smooth: passes (default 1)'),
      maxInfluences: z
        .number()
        .int()
        .optional()
        .describe('auto/prune: max bones per vertex (default 4)'),
      threshold: z.number().optional().describe('prune: drop influences below this (default 0.01)'),
      boneA: z.string().optional().describe('swap: first bone'),
      boneB: z.string().optional().describe('swap: second bone'),
      bone: z.string().optional().describe('remove_bone: bone to unbind'),
    },
  ),
  def(
    'add_clipping',
    'Create a clipping slot just before `slot` in the draw order. Its polygon (slot-bone space) masks all slots from there until `end` (default: slot itself). Returns the created slot name.',
    {
      slot: z.string(),
      end: z.string().optional(),
      vertices: z
        .array(z.number())
        .optional()
        .describe('Polygon x,y pairs; default 100×100 square.'),
    },
  ),
  def(
    'add_bounding_box',
    'Add a bounding box attachment (polygon for game-side hit testing) to a slot.',
    {
      slot: z.string(),
      name: z.string().optional(),
      vertices: z.array(z.number()).optional().describe('Polygon x,y pairs; default 80×80 square.'),
    },
  ),
  def(
    'add_point',
    'Add a point attachment (named position + rotation, e.g. a muzzle or hand anchor) to a slot.',
    {
      slot: z.string(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      rotation: z.number().optional(),
    },
  ),
  def(
    'rig_from_parts',
    'Auto-rig: builds a full skeleton (hip/spine/head + limbs, 2-bone IK with targets, correct draw order) from canonically named parts placed on the canvas (head, torso, upper/lower_arm_l/r, upper/lower_leg_l/r — e.g. from segment_image with place_on_canvas). One undo step. Requires a torso part.',
    { ik: z.boolean().optional().describe('Add IK constraints (default true)') },
  ),
  def(
    'apply_preset_animation',
    'Create a preset animation (idle | walk | wave) retargeted to the current rig. Works out of the box on rigs built by rig_from_parts; for custom rigs pass bone_map (canonical name -> your bone name). Rotations copy as setup-pose offsets; translations scale with bone length.',
    {
      preset: z.enum(['idle', 'walk', 'wave']),
      animation: z.string().optional().describe('Animation name (default = preset name)'),
      bone_map: z.record(z.string()).optional(),
    },
  ),
  def(
    'add_path',
    "Add a path attachment (composite bezier spline) to a slot. Vertices are 6 floats per point: in-handle x,y, anchor x,y, out-handle x,y in the slot bone's space. Target it with add_path_constraint to make bones follow the curve.",
    {
      slot: z.string(),
      name: z.string().optional(),
      closed: z.boolean().optional(),
      vertices: z
        .array(z.number())
        .optional()
        .describe('6 floats per point; default a 2-point 100-unit line.'),
    },
  ),
  def(
    'add_path_constraint',
    'Constrain bones to follow a path attachment. Target is a SLOT with a path attachment. positionMode fixed|percent, spacingMode length|fixed|percent|proportional, rotateMode tangent|chain|chainScale. Evaluated in the viewport (arc-length sampling).',
    {
      name: z.string(),
      bones: z.array(z.string()),
      target: z.string().describe('Slot name carrying the path attachment.'),
      positionMode: z.enum(['fixed', 'percent']).optional(),
      spacingMode: z.enum(['length', 'fixed', 'percent', 'proportional']).optional(),
      rotateMode: z.enum(['tangent', 'chain', 'chainScale']).optional(),
      position: z.number().optional(),
      spacing: z.number().optional(),
      rotation: z.number().optional(),
      mixRotate: z.number().optional(),
      mixX: z.number().optional(),
      mixY: z.number().optional(),
      order: z.number().optional(),
    },
  ),
  def(
    'add_physics_constraint',
    'Add a physics constraint (Spine 4.2): the bone gets spring-damper motion from inertia/wind/gravity. x/y/rotate/scaleX/shearX are per-property influence factors (0-1). Previewed deterministically in the editor timeline; exact runtime parity not guaranteed.',
    {
      name: z.string(),
      bone: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      rotate: z.number().optional(),
      scaleX: z.number().optional(),
      shearX: z.number().optional(),
      inertia: z.number().optional(),
      strength: z.number().optional(),
      damping: z.number().optional(),
      mass: z.number().optional(),
      wind: z.number().optional(),
      gravity: z.number().optional(),
      limit: z.number().optional(),
      mix: z.number().optional(),
    },
  ),
  def(
    'remove_ik_constraint',
    'Remove an IK constraint by name (fails if an animation still keys it). Undoable.',
    { name: z.string().describe('Constraint name') },
  ),
  def(
    'remove_transform_constraint',
    'Remove a transform constraint by name (fails if an animation still keys it). Undoable.',
    { name: z.string().describe('Constraint name') },
  ),
  def(
    'remove_path_constraint',
    'Remove a path constraint by name (fails if an animation still keys it). Undoable.',
    { name: z.string().describe('Constraint name') },
  ),
  def(
    'remove_physics_constraint',
    'Remove a physics constraint by name (fails if an animation still keys it). Undoable.',
    { name: z.string().describe('Constraint name') },
  ),
  def(
    'set_ik_constraint',
    'Patch an existing IK constraint in place (only the fields you pass change; undoable): target, bones, mix, softness, bendPositive, compress, stretch.',
    {
      name: z.string().describe('Constraint name'),
      target: z.string().optional(),
      bones: z.array(z.string()).min(1).max(2).optional(),
      mix: z.number().optional(),
      softness: z.number().optional(),
      bendPositive: z.boolean().optional(),
      compress: z.boolean().optional(),
      stretch: z.boolean().optional(),
      order: z.number().optional(),
    },
  ),
  def(
    'set_transform_constraint',
    'Patch an existing transform constraint in place (only the fields you pass change; undoable): target, bones, offsets, per-channel mixes, local/relative.',
    {
      name: z.string().describe('Constraint name'),
      target: z.string().optional(),
      bones: z.array(z.string()).optional(),
      rotation: z.number().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      mixRotate: z.number().optional(),
      mixX: z.number().optional(),
      mixY: z.number().optional(),
      mixScaleX: z.number().optional(),
      mixScaleY: z.number().optional(),
      local: z.boolean().optional(),
      relative: z.boolean().optional(),
      order: z.number().optional(),
    },
  ),
  def(
    'set_path_constraint',
    'Patch an existing path constraint in place (only the fields you pass change; undoable): target slot, modes, position/spacing/rotation, mixes.',
    {
      name: z.string().describe('Constraint name'),
      target: z.string().optional().describe('Slot name carrying the path attachment.'),
      bones: z.array(z.string()).optional(),
      positionMode: z.enum(['fixed', 'percent']).optional(),
      spacingMode: z.enum(['length', 'fixed', 'percent', 'proportional']).optional(),
      rotateMode: z.enum(['tangent', 'chain', 'chainScale']).optional(),
      position: z.number().optional(),
      spacing: z.number().optional(),
      rotation: z.number().optional(),
      mixRotate: z.number().optional(),
      mixX: z.number().optional(),
      mixY: z.number().optional(),
      order: z.number().optional(),
    },
  ),
  def(
    'set_physics_constraint',
    'Patch an existing physics constraint in place (only the fields you pass change; undoable): influences and spring parameters.',
    {
      name: z.string().describe('Constraint name'),
      bone: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      rotate: z.number().optional(),
      scaleX: z.number().optional(),
      shearX: z.number().optional(),
      inertia: z.number().optional(),
      strength: z.number().optional(),
      damping: z.number().optional(),
      mass: z.number().optional(),
      wind: z.number().optional(),
      gravity: z.number().optional(),
      limit: z.number().optional(),
      mix: z.number().optional(),
    },
  ),
  def(
    'create_skin',
    "Create a skin (optionally deep-copying another skin's attachments) and make it active in the viewport.",
    { name: z.string(), copyFrom: z.string().optional() },
  ),
  def(
    'switch_skin',
    'Set the skin used to resolve attachments in the viewport (the "default" skin always backs it up). Affects previews/screenshots, not the exported data.',
    { name: z.string() },
  ),
  def(
    'import_atlas',
    'Import a packed texture atlas: pass the .atlas text plus each page image as a data URL. Regions are sliced back into separate images (rotation and whitespace-strip offsets honored) so existing attachments referencing them render.',
    {
      atlas: z.string().describe('The .atlas file text (libgdx format).'),
      pages: z.array(z.object({ name: z.string(), dataUrl: z.string() })),
    },
  ),
  def(
    'add_transform_constraint',
    "Constrain bones to copy a target bone's transform, blended by mixRotate/mixX/mixY/mixScaleX/mixScaleY (0-1). rotation/x/y/scaleX/scaleY are offsets added to the target.",
    {
      name: z.string(),
      bones: z.array(z.string()),
      target: z.string(),
      rotation: z.number().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      mixRotate: z.number().optional(),
      mixX: z.number().optional(),
      mixY: z.number().optional(),
      mixScaleX: z.number().optional(),
      mixScaleY: z.number().optional(),
      local: z.boolean().optional(),
      relative: z.boolean().optional(),
      order: z.number().optional(),
    },
  ),
  // ---------------------------------------------------------------- export
  {
    name: 'export_atlas',
    description:
      'Pack all imported images into a texture atlas: returns the libgdx-format .atlas text and the packed skeleton.png. Region names match attachment names, so runtimes can load the export directly.',
    shape: {},
    op: 'export_atlas',
    result: 'atlas',
  },
  def(
    'export_spine_json',
    "Serialize the document to Spine JSON 4.2 (returns the JSON text plus validation issues). Defaults equal to Spine's are omitted, matching official exports.",
    {},
  ),
];

export interface ToolJsonSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** JSON Schemas in the exact shape the anthropic `tools` parameter expects. */
export function toolJsonSchemas(): ToolJsonSchema[] {
  return TOOL_DEFS.map((d) => {
    const schema = zodToJsonSchema(z.object(d.shape), { $refStrategy: 'none' }) as Record<
      string,
      unknown
    >;
    delete schema['$schema'];
    return { name: d.name, description: d.description, input_schema: schema };
  });
}
