/**
 * MCP tool definitions. Every tool forwards to the running editor over the
 * WebSocket bridge, so AI edits go through the same undoable command API as
 * user edits.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeServer } from './bridge-server.js';

type ToolResult = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
};

function text(result: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function errorResult(err: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

const curveSchema = z
  .union([z.literal('stepped'), z.array(z.number())])
  .optional()
  .describe(
    'Omit for linear; "stepped" to hold; or bezier control values (4 numbers per channel: cx1, cy1, cx2, cy2 in time/value space).',
  );

export function registerTools(server: McpServer, bridge: BridgeServer): void {
  const forward =
    (op: string) =>
    async (params: Record<string, unknown>): Promise<ToolResult> => {
      try {
        return text(await bridge.request(op, params));
      } catch (err) {
        return errorResult(err);
      }
    };

  // ---------------------------------------------------------------- observe
  server.tool(
    'get_project_state',
    'Full editor state: mode, selection, current animation/time, imported images, the whole Spine JSON document and validation issues. Call this first to orient yourself.',
    {},
    forward('get_project_state'),
  );

  server.tool(
    'get_skeleton_tree',
    'Compact rig overview: bones (name/parent/transform), slots with draw order, IK constraints, and animation names.',
    {},
    forward('get_skeleton_tree'),
  );

  server.tool(
    'screenshot_viewport',
    'PNG screenshot of the editor viewport showing the current pose. Use after edits and after preview_at_time to SEE the result — this is your visual feedback loop.',
    {},
    async (): Promise<ToolResult> => {
      try {
        const result = (await bridge.request('screenshot')) as { dataUrl: string };
        const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '');
        return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'validate_project',
    'Referential-integrity check. Returns issues (empty array = clean). Run before exporting.',
    {},
    forward('validate'),
  );

  // ------------------------------------------------------------------- rig
  server.tool(
    'new_project',
    'Replace the current document with an empty skeleton (root bone + default skin). Destructive — asks for no confirmation.',
    {},
    forward('new_project'),
  );

  server.tool(
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
    forward('add_bone'),
  );

  server.tool(
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
    forward('set_bone_transform'),
  );

  server.tool(
    'rename_bone',
    'Rename a bone; all references (slots, constraints, timelines) follow.',
    { from: z.string(), to: z.string() },
    forward('rename_bone'),
  );

  server.tool(
    'remove_bone',
    'Remove a bone (fails while children/slots/constraints still reference it).',
    { name: z.string() },
    forward('remove_bone'),
  );

  server.tool(
    'reparent_bone',
    'Move a bone under a new parent (local transform values are kept).',
    { bone: z.string(), parent: z.string() },
    forward('reparent_bone'),
  );

  server.tool(
    'import_image',
    'Import an image (data URL) into the project so it can be attached to bones.',
    {
      name: z.string().describe('Asset name without extension, e.g. "arm-upper".'),
      dataUrl: z.string().describe('data:image/png;base64,... payload.'),
    },
    forward('import_image'),
  );

  server.tool(
    'attach_image',
    'Create a slot on a bone showing an imported image as a region attachment (slot + attachment named after the image). Returns the slot name.',
    { asset: z.string(), bone: z.string() },
    forward('attach_image'),
  );

  server.tool(
    'set_draw_order',
    'Move a slot to a draw-order index (0 = drawn first / furthest behind).',
    { slot: z.string(), index: z.number().int().min(0) },
    forward('set_draw_order'),
  );

  server.tool(
    'add_ik_constraint',
    'Add an IK constraint: 1-2 chained bones reach toward a target bone.',
    {
      name: z.string(),
      bones: z.array(z.string()).min(1).max(2),
      target: z.string(),
      mix: z.number().optional(),
      bendPositive: z.boolean().optional(),
      order: z.number().optional(),
    },
    forward('add_ik_constraint'),
  );

  // --------------------------------------------------------------- animate
  server.tool(
    'create_animation',
    'Create an animation and switch the editor to animate mode with it active.',
    { name: z.string() },
    forward('create_animation'),
  );

  server.tool(
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
    forward('set_bone_keyframe'),
  );

  server.tool(
    'delete_bone_keyframe',
    'Delete the keyframe at an exact time on a bone timeline.',
    {
      animation: z.string(),
      bone: z.string(),
      timeline: z.enum(['rotate', 'translate', 'scale', 'shear']),
      time: z.number().min(0),
    },
    forward('delete_bone_keyframe'),
  );

  server.tool(
    'set_slot_attachment_keyframe',
    'Key which attachment a slot shows at a time (frame-by-frame switching). attachment: null hides the slot.',
    {
      animation: z.string(),
      slot: z.string(),
      time: z.number().min(0),
      attachment: z.string().nullable(),
    },
    forward('set_slot_attachment_keyframe'),
  );

  server.tool(
    'preview_at_time',
    'Pose the viewport at a time in an animation (pauses playback). Follow with screenshot_viewport to see it. Returns the animation duration.',
    { animation: z.string().optional(), time: z.number().min(0) },
    forward('preview'),
  );

  server.tool(
    'play_animation',
    'Start looping playback in the editor (visual check for a human watching; use preview_at_time + screenshots for your own checks).',
    { animation: z.string().optional(), loop: z.boolean().optional() },
    forward('play'),
  );

  server.tool('stop_playback', 'Pause playback; returns the current time.', {}, forward('stop'));

  server.tool(
    'undo',
    'Undo the last edit (AI and user edits share one history).',
    {},
    forward('undo'),
  );
  server.tool('redo', 'Redo the last undone edit.', {}, forward('redo'));

  server.tool(
    'create_mesh',
    "Convert a slot's region attachment into a deformable grid mesh (cols x rows cells). Vertices run row by row from the image's top-left; each vertex is an x,y pair. Use set_deform_keyframe afterwards to animate them.",
    {
      slot: z.string(),
      cols: z.number().int().min(1).optional(),
      rows: z.number().int().min(1).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    },
    forward('create_mesh'),
  );

  server.tool(
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
    forward('set_deform_keyframe'),
  );

  server.tool(
    'set_slot_color_keyframe',
    'Key a slot\'s tint color (8-digit rgba hex like "ff8800ff"). Evaluated in previews; curve blocks are per r/g/b/a channel.',
    {
      animation: z.string(),
      slot: z.string(),
      time: z.number().min(0),
      color: z.string().regex(/^[0-9a-fA-F]{8}$/),
      curve: curveSchema,
    },
    forward('set_slot_color_keyframe'),
  );

  server.tool(
    'set_event',
    'Define (or redefine) a named event with default payload values.',
    {
      name: z.string(),
      int: z.number().int().optional(),
      float: z.number().optional(),
      string: z.string().optional(),
      audio: z.string().optional(),
      volume: z.number().optional(),
      balance: z.number().optional(),
    },
    forward('set_event'),
  );

  server.tool(
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
    forward('set_event_keyframe'),
  );

  // ---------------------------------------------------------------- export
  server.tool(
    'export_atlas',
    'Pack all imported images into a texture atlas: returns the libgdx-format .atlas text and the packed skeleton.png. Region names match attachment names, so runtimes can load the export directly.',
    {},
    async (): Promise<ToolResult> => {
      try {
        const result = (await bridge.request('export_atlas')) as {
          atlasText: string;
          pngDataUrl: string;
        };
        const base64 = result.pngDataUrl.replace(/^data:image\/png;base64,/, '');
        return {
          content: [
            { type: 'text', text: result.atlasText },
            { type: 'image', data: base64, mimeType: 'image/png' },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'export_spine_json',
    "Serialize the document to Spine JSON 4.2 (returns the JSON text plus validation issues). Defaults equal to Spine's are omitted, matching official exports.",
    {},
    forward('export_spine_json'),
  );
}
