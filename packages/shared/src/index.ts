/**
 * Types and protocol messages shared between the editor UI and the MCP server.
 *
 * The editor↔MCP WebSocket protocol will be defined here in Phase 5. For now
 * this only carries project-wide constants so every package agrees on them.
 */

/** The Spine JSON format version this project targets for import/export. */
export const SPINE_JSON_TARGET_VERSION = '4.2';
