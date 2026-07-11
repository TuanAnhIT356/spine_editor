/**
 * Chat WebSocket client: connects to the server chat loop, announces the 55
 * tool schemas, executes dispatched tools through the same bridge op layer
 * the MCP server uses, and streams model output to the UI via events.
 */

import {
  TOOL_DEFS,
  toolJsonSchemas,
  type ChatClientMsg,
  type ChatServerMsg,
} from '@spine-editor/shared';
import { dispatchOp } from '../bridge/ops.js';
import { getAccessToken, serverUrl } from '../server/api.js';

export type ChatEvent =
  | { kind: 'ready'; conversation: number; title: string }
  | { kind: 'delta'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: number; name: string; params: Record<string, unknown> }
  | { kind: 'tool-result'; id: number; name: string; ok: boolean; error?: string }
  | { kind: 'turn-done'; stopReason: string }
  | { kind: 'title'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'closed' };

const DEFS_BY_NAME = new Map(TOOL_DEFS.map((d) => [d.name, d]));

function stripPng(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

/** anthropic-ready content blocks for one tool result. */
function contentFor(name: string, result: unknown): unknown[] {
  const def = DEFS_BY_NAME.get(name);
  if (def?.result === 'image') {
    const { dataUrl } = result as { dataUrl: string };
    return [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: stripPng(dataUrl) },
      },
    ];
  }
  if (def?.result === 'atlas') {
    const { atlasText, pngDataUrl } = result as { atlasText: string; pngDataUrl: string };
    return [
      { type: 'text', text: atlasText },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: stripPng(pngDataUrl) },
      },
    ];
  }
  return [{ type: 'text', text: JSON.stringify(result) }];
}

export class ChatClient {
  private socket: WebSocket | null = null;
  private busy = false;

  constructor(private onEvent: (e: ChatEvent) => void) {}

  get running(): boolean {
    return this.busy;
  }

  connect(conversationId?: number): void {
    const token = getAccessToken();
    if (!token) {
      this.onEvent({ kind: 'error', message: 'Not signed in.' });
      return;
    }
    const base = serverUrl().replace(/^http/, 'ws');
    const conv = conversationId != null ? `&conversation=${conversationId}` : '';
    const socket = new WebSocket(`${base}/api/chat/ws?token=${encodeURIComponent(token)}${conv}`);
    this.socket = socket;
    socket.onopen = () => this.send({ type: 'hello', tools: toolJsonSchemas() });
    socket.onclose = () => {
      this.busy = false;
      this.onEvent({ kind: 'closed' });
    };
    socket.onmessage = (raw) => {
      void this.handle(JSON.parse(String(raw.data)) as ChatServerMsg);
    };
  }

  sendUser(text: string): void {
    this.busy = true;
    this.send({ type: 'user', text });
  }

  stop(): void {
    this.send({ type: 'stop' });
  }

  dispose(): void {
    this.socket?.close();
    this.socket = null;
  }

  private send(msg: ChatClientMsg): void {
    this.socket?.send(JSON.stringify(msg));
  }

  private async handle(msg: ChatServerMsg): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.onEvent({ kind: 'ready', conversation: msg.conversation, title: msg.title });
        return;
      case 'delta':
        this.onEvent({ kind: 'delta', text: msg.text });
        return;
      case 'thinking':
        this.onEvent({ kind: 'thinking', text: msg.text });
        return;
      case 'turn_done':
        this.busy = false;
        this.onEvent({ kind: 'turn-done', stopReason: msg.stopReason });
        return;
      case 'title':
        this.onEvent({ kind: 'title', text: msg.text });
        return;
      case 'error':
        this.busy = false;
        this.onEvent({ kind: 'error', message: msg.message });
        return;
      case 'op': {
        this.onEvent({ kind: 'tool', id: msg.id, name: msg.tool, params: msg.params });
        const def = DEFS_BY_NAME.get(msg.tool);
        if (!def) {
          this.send({
            type: 'op_result',
            id: msg.id,
            ok: false,
            error: `Unknown tool "${msg.tool}"`,
          });
          this.onEvent({
            kind: 'tool-result',
            id: msg.id,
            name: msg.tool,
            ok: false,
            error: 'unknown tool',
          });
          return;
        }
        try {
          const result = await dispatchOp(def.op, msg.params);
          this.send({
            type: 'op_result',
            id: msg.id,
            ok: true,
            content: contentFor(msg.tool, result),
          });
          this.onEvent({ kind: 'tool-result', id: msg.id, name: msg.tool, ok: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.send({ type: 'op_result', id: msg.id, ok: false, error: message });
          this.onEvent({
            kind: 'tool-result',
            id: msg.id,
            name: msg.tool,
            ok: false,
            error: message,
          });
        }
        return;
      }
    }
  }
}
