/**
 * WebSocket server the running editor connects to. The MCP tools forward
 * operations to the connected editor and await its responses.
 */

import type { BridgeNotice, BridgeOp, BridgeRequest, BridgeResponse } from '@spine-editor/shared';
import { WebSocket, WebSocketServer } from 'ws';

interface Pending {
  op: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

/** Ops that legitimately take longer than the 20s default. */
const OP_TIMEOUTS: Partial<Record<BridgeOp, number>> = {
  generate_image: 120_000,
  import_atlas: 60_000,
};

const DEFAULT_TIMEOUT_MS = 20_000;

export class BridgeServer {
  private editor: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly wss: WebSocketServer;
  private readonly token: string | undefined;
  readonly ready: Promise<void>;

  constructor(
    readonly port: number,
    opts: { token?: string } = {},
  ) {
    this.token = opts.token ?? process.env['SPINE_BRIDGE_TOKEN'] ?? undefined;
    this.wss = new WebSocketServer({ port });
    this.ready = new Promise((resolve) => this.wss.once('listening', resolve));
    this.wss.on('error', (err) => {
      console.error(`[spine-editor-mcp] bridge server error: ${err.message}`);
    });
    this.wss.on('connection', (ws, req) => {
      if (this.token) {
        const url = new URL(req.url ?? '/', 'ws://localhost');
        if (url.searchParams.get('token') !== this.token) {
          ws.close(4001, 'invalid bridge token');
          return;
        }
      }
      // Latest editor wins; tell the stale tab so it stops reconnecting.
      if (this.editor && this.editor.readyState === WebSocket.OPEN) {
        this.editor.send(JSON.stringify({ notice: 'replaced' } satisfies BridgeNotice));
        this.editor.close(4000, 'replaced by new editor tab');
      }
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
        if (this.editor !== ws) return;
        this.editor = null;
        console.error('[spine-editor-mcp] editor disconnected');
        for (const [id, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error(`Editor tab disconnected while handling "${entry.op}".`));
          this.pending.delete(id);
        }
      });
    });
  }

  /** Actual listening port (differs from `port` when constructed with 0). */
  get boundPort(): number {
    const addr = this.wss.address();
    return typeof addr === 'object' && addr ? addr.port : this.port;
  }

  get connected(): boolean {
    return this.editor?.readyState === WebSocket.OPEN;
  }

  timeoutFor(op: string): number {
    return OP_TIMEOUTS[op as BridgeOp] ?? DEFAULT_TIMEOUT_MS;
  }

  /** Close the server and reject anything in flight (tests + shutdown). */
  dispose(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`Bridge server disposed while handling "${entry.op}".`));
      this.pending.delete(id);
    }
    this.editor?.close();
    this.wss.close();
  }

  request(op: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    if (!this.connected || !this.editor) {
      return Promise.reject(
        new Error(
          `No editor connected. Start the editor (pnpm --filter @spine-editor/editor dev, ` +
            `or serve the built app) and keep the tab open — it auto-connects to ` +
            `ws://localhost:${this.port}/editor.`,
        ),
      );
    }
    const effectiveTimeout = timeoutMs ?? this.timeoutFor(op);
    const id = this.nextId++;
    const message: BridgeRequest = { id, op: op as BridgeOp, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Editor did not answer "${op}" within ${effectiveTimeout / 1000}s.`));
      }, effectiveTimeout);
      this.pending.set(id, { op, resolve, reject, timer });
      this.editor?.send(JSON.stringify(message));
    });
  }
}
