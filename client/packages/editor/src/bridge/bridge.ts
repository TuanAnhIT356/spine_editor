/**
 * WebSocket client that connects the running editor to the MCP server's
 * bridge, so AI agents can drive the editor. Connects on startup and retries
 * quietly — the editor works fine without the MCP server running. Stops
 * retrying when another tab took the bridge over (notice: 'replaced').
 */

import { DEFAULT_BRIDGE_PORT, type BridgeRequest, type BridgeResponse } from '@spine-editor/shared';
import { useEditor } from '../state/store.js';
import { dispatchOp } from './ops.js';

const TOKEN_STORAGE_KEY = 'spine-editor.bridge-token';
const RETRY_MS = 3000;
const AUTH_RETRY_MS = 15_000;

export function startBridge(baseUrl = `ws://localhost:${DEFAULT_BRIDGE_PORT}/editor`): void {
  let socket: WebSocket | null = null;
  let replaced = false;
  let authErrorShown = false;

  const urlWithToken = () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  };

  const connect = () => {
    if (replaced) return;
    try {
      socket = new WebSocket(urlWithToken());
    } catch {
      setTimeout(connect, RETRY_MS);
      return;
    }
    socket.onopen = () => console.info('[bridge] connected to MCP server');
    socket.onclose = (event) => {
      if (replaced) return;
      if (event.code === 4001) {
        if (!authErrorShown) {
          authErrorShown = true;
          useEditor
            .getState()
            .setError(
              'Bridge token missing or wrong — set it under Server ▸ MCP bridge, then reload.',
            );
        }
        setTimeout(connect, AUTH_RETRY_MS);
        return;
      }
      setTimeout(connect, RETRY_MS);
    };
    socket.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof message === 'object' && message !== null && 'notice' in message) {
        if ((message as { notice: string }).notice === 'replaced') {
          replaced = true;
          useEditor
            .getState()
            .setError('MCP bridge moved to another editor tab — reload this tab to reclaim it.');
        }
        return;
      }
      const request = message as BridgeRequest;
      void (async () => {
        let response: BridgeResponse;
        try {
          const result = await dispatchOp(request.op, request.params ?? {});
          response = { id: request.id, ok: true, result };
        } catch (err) {
          response = {
            id: request.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        socket?.send(JSON.stringify(response));
      })();
    };
  };

  connect();
}
