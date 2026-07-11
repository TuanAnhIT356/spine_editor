/**
 * Types and protocol messages shared between the editor UI and the MCP server.
 */

/** The Spine JSON format version this project targets for import/export. */
export const SPINE_JSON_TARGET_VERSION = '4.2';

/** Port the MCP server's WebSocket bridge listens on; the editor connects out. */
export const DEFAULT_BRIDGE_PORT = 8017;

/**
 * Every operation the editor's bridge dispatcher understands. Single source
 * of truth: `tools.ts` may only forward these (compile-time), and the
 * `ops.ts` switch must handle every one (exhaustiveness check in its default).
 */
export const BRIDGE_OPS = [
  'ping',
  'get_project_state',
  'get_skeleton_tree',
  'new_project',
  'load_project',
  'set_mode',
  'select',
  'add_bone',
  'set_bone_transform',
  'rename_bone',
  'remove_bone',
  'reparent_bone',
  'import_image',
  'import_psd',
  'generate_image',
  'segment_image',
  'attach_image',
  'add_slot',
  'set_slot_properties',
  'set_draw_order',
  'set_slot_color',
  'add_ik_constraint',
  'add_transform_constraint',
  'add_path',
  'add_path_constraint',
  'add_physics_constraint',
  'remove_ik_constraint',
  'remove_transform_constraint',
  'remove_path_constraint',
  'remove_physics_constraint',
  'set_ik_constraint',
  'set_transform_constraint',
  'set_path_constraint',
  'set_physics_constraint',
  'create_animation',
  'remove_animation',
  'set_bone_keyframe',
  'delete_bone_keyframe',
  'set_slot_attachment_keyframe',
  'preview',
  'play',
  'stop',
  'undo',
  'redo',
  'screenshot',
  'export_spine_json',
  'export_skel',
  'export_atlas',
  'set_event',
  'create_mesh',
  'set_deform_keyframe',
  'set_slot_color_keyframe',
  'set_event_keyframe',
  'set_mesh_vertices',
  'bind_weights',
  'edit_mesh',
  'adjust_weights',
  'import_audio',
  'add_clipping',
  'add_bounding_box',
  'add_point',
  'rig_from_parts',
  'apply_preset_animation',
  'create_skin',
  'switch_skin',
  'import_atlas',
  'set_playback_speed',
  'set_draw_order_keyframe',
  'delete_draw_order_keyframe',
  'delete_event_keyframe',
  'shift_keys',
  'validate',
] as const;

export type BridgeOp = (typeof BRIDGE_OPS)[number];

/** Request sent from the MCP server to the editor over the bridge. */
export interface BridgeRequest {
  id: number;
  op: BridgeOp;
  params?: Record<string, unknown>;
}

export interface BridgeResponseOk {
  id: number;
  ok: true;
  result: unknown;
}

export interface BridgeResponseErr {
  id: number;
  ok: false;
  error: string;
}

export type BridgeResponse = BridgeResponseOk | BridgeResponseErr;

/** Server→editor notification (no id, not a request). */
export interface BridgeNotice {
  notice: 'replaced';
}

export * from './tools.js';
export * from './chat.js';
