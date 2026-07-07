/**
 * WebSocket client that connects the running editor to the MCP server's
 * bridge, so AI agents can drive the editor. Connects on startup and retries
 * quietly forever — the editor works fine without the MCP server running.
 */

import { DEFAULT_BRIDGE_PORT, type BridgeRequest, type BridgeResponse } from '@spine-editor/shared';
import { dispatchOp } from './ops.js';

export function startBridge(url = `ws://localhost:${DEFAULT_BRIDGE_PORT}/editor`): void {
  let socket: WebSocket | null = null;

  const connect = () => {
    try {
      socket = new WebSocket(url);
    } catch {
      setTimeout(connect, 3000);
      return;
    }
    socket.onopen = () => console.info('[bridge] connected to MCP server');
    socket.onclose = () => setTimeout(connect, 3000);
    socket.onmessage = (event) => {
      let request: BridgeRequest;
      try {
        request = JSON.parse(String(event.data)) as BridgeRequest;
      } catch {
        return;
      }
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
