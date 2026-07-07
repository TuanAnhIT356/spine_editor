/**
 * @spine-editor/mcp-server — MCP server exposing the editor to AI agents.
 *
 * Placeholder for Phase 5. Will expose observation, rigging, animating and
 * export tools over MCP, bridged to a running editor via WebSocket, plus a
 * headless mode that operates on project files directly through
 * @spine-editor/core.
 */

import { SPINE_JSON_TARGET_VERSION } from '@spine-editor/core';

export function serverInfo(): { name: string; targetFormat: string } {
  return { name: 'spine-editor-mcp', targetFormat: SPINE_JSON_TARGET_VERSION };
}
