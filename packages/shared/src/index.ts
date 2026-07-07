/**
 * Types and protocol messages shared between the editor UI and the MCP server.
 */

/** The Spine JSON format version this project targets for import/export. */
export const SPINE_JSON_TARGET_VERSION = '4.2';

/** Port the MCP server's WebSocket bridge listens on; the editor connects out. */
export const DEFAULT_BRIDGE_PORT = 8017;

/** Request sent from the MCP server to the editor over the bridge. */
export interface BridgeRequest {
  id: number;
  op: string;
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
