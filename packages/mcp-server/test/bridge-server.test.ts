import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { BridgeServer } from '../src/bridge-server.js';

const servers: BridgeServer[] = [];
const sockets: WebSocket[] = [];

async function makeServer(opts?: { token?: string }): Promise<BridgeServer> {
  const s = new BridgeServer(0, opts);
  servers.push(s);
  await s.ready;
  return s;
}

function connect(s: BridgeServer, query = ''): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${s.boundPort}/editor${query}`);
  sockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => ws.once('message', (raw) => resolve(JSON.parse(String(raw)))));
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

afterEach(() => {
  for (const ws of sockets) ws.close();
  sockets.length = 0;
  for (const s of servers) s.dispose();
  servers.length = 0;
});

describe('BridgeServer', () => {
  it('rejects in-flight requests when the editor disconnects', async () => {
    const s = await makeServer();
    const ws = await connect(s);
    const pending = s.request('get_skeleton_tree');
    await nextMessage(ws); // the request arrived; close without answering
    ws.close();
    await expect(pending).rejects.toThrow(/disconnected while handling "get_skeleton_tree"/);
  });

  it('applies per-op timeouts (generate_image 120s, import_atlas 60s, default 20s)', async () => {
    const s = await makeServer();
    expect(s.timeoutFor('generate_image')).toBe(120_000);
    expect(s.timeoutFor('import_atlas')).toBe(60_000);
    expect(s.timeoutFor('ping')).toBe(20_000);
  });

  it('rejects wrong/missing token when a token is configured', async () => {
    const s = await makeServer({ token: 'sesame' });
    const wrong = new WebSocket(`ws://127.0.0.1:${s.boundPort}/editor?token=nope`);
    sockets.push(wrong);
    expect(await closed(wrong)).toBe(4001);
    const missing = new WebSocket(`ws://127.0.0.1:${s.boundPort}/editor`);
    sockets.push(missing);
    expect(await closed(missing)).toBe(4001);
    const right = await connect(s, '?token=sesame');
    expect(right.readyState).toBe(WebSocket.OPEN);
    expect(s.connected).toBe(true);
  });

  it('notifies the replaced tab and closes it with 4000', async () => {
    const s = await makeServer();
    const first = await connect(s);
    const noticePromise = nextMessage(first);
    const closePromise = closed(first);
    await connect(s); // second tab takes over
    expect(await noticePromise).toEqual({ notice: 'replaced' });
    expect(await closePromise).toBe(4000);
  });
});
