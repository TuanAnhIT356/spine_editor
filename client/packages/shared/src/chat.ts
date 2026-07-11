/**
 * Editor ⇄ server chat WebSocket protocol (Phase 14 slice 2). The server
 * only ever speaks in TOOL NAMES (it learns them from `hello`); the editor
 * resolves a name to its bridge op + result kind via TOOL_DEFS.
 */

import type { ToolJsonSchema } from './tools.js';

export type ChatClientMsg =
  | { type: 'hello'; tools: ToolJsonSchema[] }
  | { type: 'user'; text: string }
  | { type: 'op_result'; id: number; ok: true; content: unknown[] }
  | { type: 'op_result'; id: number; ok: false; error: string }
  | { type: 'stop' };

export type ChatServerMsg =
  | { type: 'ready'; conversation: number; title: string }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'op'; id: number; tool: string; params: Record<string, unknown> }
  | { type: 'turn_done'; stopReason: string }
  | { type: 'title'; text: string }
  | { type: 'error'; message: string };
