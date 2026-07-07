/**
 * @spine-editor/mcp-server — MCP server (stdio) exposing the running editor
 * to AI agents through a WebSocket bridge.
 *
 * Architecture: AI ⇄ MCP (this process, stdio) ⇄ WebSocket ⇄ editor tab.
 * Start with: pnpm --filter @spine-editor/mcp-server start
 * Then open the editor; it auto-connects to the bridge.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_BRIDGE_PORT } from '@spine-editor/shared';
import { BridgeServer } from './bridge-server.js';
import { registerTools } from './tools.js';

const port = Number(process.env['SPINE_BRIDGE_PORT'] ?? DEFAULT_BRIDGE_PORT);
const bridge = new BridgeServer(port);
const server = new McpServer({ name: 'spine-editor', version: '0.1.0' });
registerTools(server, bridge);

await server.connect(new StdioServerTransport());
console.error(`[spine-editor-mcp] ready — waiting for the editor on ws://localhost:${port}/editor`);
