/**
 * MCP tool registration. The tool definitions live in @spine-editor/shared
 * (TOOL_DEFS — also used by the editor's chat client); every tool forwards
 * to the running editor over the WebSocket bridge, so AI edits go through
 * the same undoable command API as user edits.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_DEFS } from '@spine-editor/shared';
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

function stripPng(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

export function registerTools(server: McpServer, bridge: BridgeServer): void {
  for (const def of TOOL_DEFS) {
    server.tool(def.name, def.description, def.shape, async (params: Record<string, unknown>) => {
      try {
        const result = await bridge.request(def.op, params);
        if (def.result === 'image') {
          const { dataUrl } = result as { dataUrl: string };
          return {
            content: [{ type: 'image', data: stripPng(dataUrl), mimeType: 'image/png' }],
          } satisfies ToolResult;
        }
        if (def.result === 'atlas') {
          const { atlasText, pngDataUrl } = result as { atlasText: string; pngDataUrl: string };
          return {
            content: [
              { type: 'text', text: atlasText },
              { type: 'image', data: stripPng(pngDataUrl), mimeType: 'image/png' },
            ],
          } satisfies ToolResult;
        }
        return text(result);
      } catch (err) {
        return errorResult(err);
      }
    });
  }
}
