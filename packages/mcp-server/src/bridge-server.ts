/**
 * WebSocket server the running editor connects to. The MCP tools forward
 * operations to the connected editor and await its responses.
 */

import type { BridgeRequest, BridgeResponse } from '@spine-editor/shared';
import { WebSocket, WebSocketServer } from 'ws';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class BridgeServer {
  private editor: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(readonly port: number) {
    const wss = new WebSocketServer({ port });
    wss.on('error', (err) => {
      console.error(`[spine-editor-mcp] bridge server error: ${err.message}`);
    });
    wss.on('connection', (ws) => {
      // Latest editor wins; a stale tab must not shadow the active one.
      this.editor?.close();
      this.editor = ws;
      console.error('[spine-editor-mcp] editor connected');
      ws.on('message', (raw) => {
        let response: BridgeResponse;
        try {
          response = JSON.parse(String(raw)) as BridgeResponse;
        } catch {
          return;
        }
        const entry = this.pending.get(response.id);
        if (!entry) return;
        this.pending.delete(response.id);
        clearTimeout(entry.timer);
        if (response.ok) entry.resolve(response.result);
        else entry.reject(new Error(response.error));
      });
      ws.on('close', () => {
        if (this.editor === ws) this.editor = null;
        console.error('[spine-editor-mcp] editor disconnected');
      });
    });
  }

  get connected(): boolean {
    return this.editor?.readyState === WebSocket.OPEN;
  }

  request(op: string, params: Record<string, unknown> = {}, timeoutMs = 20000): Promise<unknown> {
    if (!this.connected || !this.editor) {
      return Promise.reject(
        new Error(
          `No editor connected. Start the editor (pnpm --filter @spine-editor/editor dev, ` +
            `or serve the built app) and keep the tab open — it auto-connects to ` +
            `ws://localhost:${this.port}/editor.`,
        ),
      );
    }
    const id = this.nextId++;
    const message: BridgeRequest = { id, op, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Editor did not answer "${op}" within ${timeoutMs / 1000}s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.editor?.send(JSON.stringify(message));
    });
  }
}
