# Bridge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the MCP⇄editor WebSocket bridge (typed op protocol, fast failure, per-op timeouts, takeover notice, opt-in token auth) and close the core command/test gaps before Phase 14 builds on it.

**Architecture:** A `BridgeOp` string-literal union in `packages/shared` becomes the single source of truth consumed at compile time by both `tools.ts` (forward) and `ops.ts` (exhaustive switch). `BridgeServer` gains pending-drain on disconnect, an `OP_TIMEOUTS` table, a `{notice:'replaced'}` takeover message, and an optional token gate. The editor bridge client learns to stop reconnecting after takeover and to send the token. Core gains three Remove*Constraint commands mirroring `RemoveIkConstraint`, plus the missing physics/atlas tests and evaluator doc/wiring hygiene.

**Tech Stack:** TypeScript strict, zod (tool schemas), `ws` (server + test client), vitest, Playwright e2e (`bridge.mjs`).

**Spec:** `docs/superpowers/specs/2026-07-10-bridge-hardening-design.md`

## Global Constraints

- Branch: `claude/bridge-hardening` (spec already committed on it).
- pnpm is NOT on PATH in automation shells. Run repo scripts via the shim used in this session: `export PATH="/private/tmp/claude-501/-Users-tuananh-Projects-you-spine-editor/6b990f26-97bc-4e20-b105-3db5aab338c5/scratchpad/bin:$PATH"` (a `pnpm` → `corepack pnpm` shim) or prefix every command with `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm …`.
- Markdown/TS must pass `pnpm lint && pnpm format:check` after every task; run `pnpm exec prettier --write <files>` when needed.
- The 55 existing ops enumerated in Task 2 were extracted from the `ops.ts` switch on 2026-07-10; do not add/remove/rename any beyond the 4 new `remove_*_constraint` ops.
- Do not touch `server/` (Python).
- Every commit message ends with the Claude Code co-author trailer used in this repo.

---

### Task 1: Core Remove{Transform,Path,Physics}Constraint commands

**Files:**

- Modify: `packages/core/src/commands/constraints.ts` (append after `RemoveIkConstraint`, line 149)
- Modify: `packages/core/src/index.ts` (commands re-export block)
- Test: `packages/core/test/constraints-remove.test.ts` (new)

**Interfaces:**

- Consumes: `RemoveIkConstraint` pattern at `constraints.ts:122` (findIndex → animation-blocker scan → splice with remembered index; undo splices back).
- Produces: classes `RemoveTransformConstraint`, `RemovePathConstraint`, `RemovePhysicsConstraint`, each `new X(name: string)` implementing `Command` — Task 2's `ops.ts` cases call them.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/constraints-remove.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AddPathConstraint,
  AddPhysicsConstraint,
  AddTransformConstraint,
  RemovePathConstraint,
  RemovePhysicsConstraint,
  RemoveTransformConstraint,
  SpineDocument,
  createBone,
  createEmptySkeleton,
} from '../src/index.js';

function docWithBones(): SpineDocument {
  const doc = new SpineDocument(createEmptySkeleton());
  doc.data.bones.push(createBone('a', 'root'), createBone('b', 'root'));
  return doc;
}

describe('RemoveTransformConstraint', () => {
  it('removes and restores at the original index', () => {
    const doc = docWithBones();
    doc.execute(new AddTransformConstraint({ name: 'tc1', bones: ['a'], target: 'b' }));
    doc.execute(new AddTransformConstraint({ name: 'tc2', bones: ['a'], target: 'b' }));
    doc.execute(new AddTransformConstraint({ name: 'tc3', bones: ['a'], target: 'b' }));
    doc.execute(new RemoveTransformConstraint('tc2'));
    expect(doc.data.transform.map((c) => c.name)).toEqual(['tc1', 'tc3']);
    doc.undo();
    expect(doc.data.transform.map((c) => c.name)).toEqual(['tc1', 'tc2', 'tc3']);
  });

  it('refuses when an animation timeline references it', () => {
    const doc = docWithBones();
    doc.execute(new AddTransformConstraint({ name: 'tc', bones: ['a'], target: 'b' }));
    doc.data.animations['idle'] = { transform: { tc: [] } };
    expect(() => doc.execute(new RemoveTransformConstraint('tc'))).toThrow(/idle/);
    expect(doc.data.transform).toHaveLength(1);
  });

  it('throws for a missing constraint', () => {
    const doc = docWithBones();
    expect(() => doc.execute(new RemoveTransformConstraint('nope'))).toThrow(/does not exist/);
  });
});

describe('RemovePathConstraint', () => {
  it('removes, blocks on animation reference, undoes', () => {
    const doc = docWithBones();
    doc.execute(new AddPathConstraint({ name: 'pc', bones: ['a'], target: 'slot-x' }));
    doc.data.animations['walk'] = { path: { pc: {} } };
    expect(() => doc.execute(new RemovePathConstraint('pc'))).toThrow(/walk/);
    delete doc.data.animations['walk'];
    doc.execute(new RemovePathConstraint('pc'));
    expect(doc.data.path).toHaveLength(0);
    doc.undo();
    expect(doc.data.path.map((c) => c.name)).toEqual(['pc']);
  });
});

describe('RemovePhysicsConstraint', () => {
  it('removes, blocks on animation reference, undoes', () => {
    const doc = docWithBones();
    doc.execute(new AddPhysicsConstraint({ name: 'ph', bone: 'a' }));
    doc.data.animations['sway'] = { physics: { ph: {} } };
    expect(() => doc.execute(new RemovePhysicsConstraint('ph'))).toThrow(/sway/);
    delete doc.data.animations['sway'];
    doc.execute(new RemovePhysicsConstraint('ph'));
    expect(doc.data.physics).toHaveLength(0);
    doc.undo();
    expect(doc.data.physics.map((c) => c.name)).toEqual(['ph']);
  });
});
```

Note: `AddPathConstraint`/`AddPhysicsConstraint` exist already (constraints.ts); check their constructor param shape before running — if `AddPathConstraint` validates that the target slot exists, add `doc.data.slots.push({ name: 'slot-x', bone: 'a', ... })` via the same shape other core tests use (see `packages/core/test/phase9.test.ts` for a working fixture) instead of guessing. Same for `createBone(name, parent)` — confirm the exact factory signature in `packages/core/src/model/factories.ts:1-41` and mirror how existing tests build bones.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spine-editor/core test -- test/constraints-remove.test.ts`
Expected: FAIL — `RemoveTransformConstraint` is not exported.

- [ ] **Step 3: Implement the three commands**

Append to `packages/core/src/commands/constraints.ts` (mirroring lines 122–149):

```ts
export class RemoveTransformConstraint implements Command {
  readonly label: string;
  private removed: TransformConstraintData | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove transform constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = data.transform.findIndex((x) => x.name === this.name);
    if (idx < 0) throw new Error(`Transform constraint "${this.name}" does not exist.`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if (anim.transform && this.name in anim.transform) {
        throw new Error(
          `Cannot remove transform constraint "${this.name}"; referenced by animation "${animName}".`,
        );
      }
    }
    this.removed = data.transform[idx];
    this.removedIndex = idx;
    data.transform.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.transform.splice(this.removedIndex, 0, this.removed);
  }
}

export class RemovePathConstraint implements Command {
  readonly label: string;
  private removed: SpinePathConstraint | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove path constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = data.path.findIndex((x) => x.name === this.name);
    if (idx < 0) throw new Error(`Path constraint "${this.name}" does not exist.`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if (anim.path && this.name in anim.path) {
        throw new Error(
          `Cannot remove path constraint "${this.name}"; referenced by animation "${animName}".`,
        );
      }
    }
    this.removed = data.path[idx];
    this.removedIndex = idx;
    data.path.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.path.splice(this.removedIndex, 0, this.removed);
  }
}

export class RemovePhysicsConstraint implements Command {
  readonly label: string;
  private removed: SpinePhysicsConstraint | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove physics constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = data.physics.findIndex((x) => x.name === this.name);
    if (idx < 0) throw new Error(`Physics constraint "${this.name}" does not exist.`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if (anim.physics && this.name in anim.physics) {
        throw new Error(
          `Cannot remove physics constraint "${this.name}"; referenced by animation "${animName}".`,
        );
      }
    }
    this.removed = data.physics[idx];
    this.removedIndex = idx;
    data.physics.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.physics.splice(this.removedIndex, 0, this.removed);
  }
}
```

The imports at the top of `constraints.ts` already include every type used
(`TransformConstraintData`, `SpinePathConstraint`, `SpinePhysicsConstraint`) — verify, add if missing.

In `packages/core/src/index.ts`, extend the constraints re-export with the three new class names (match the existing export style of that file).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spine-editor/core test -- test/constraints-remove.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Full core suite + typecheck, then commit**

Run: `pnpm --filter @spine-editor/core test && pnpm --filter @spine-editor/core typecheck`
Expected: 94 + new tests pass, tsc clean.

```bash
git add packages/core/src/commands/constraints.ts packages/core/src/index.ts packages/core/test/constraints-remove.test.ts
git commit -m "Add Remove{Transform,Path,Physics}Constraint core commands"
```

---

### Task 2: Shared BridgeOp union + exhaustive dispatch + 4 remove tools

**Files:**

- Modify: `packages/shared/src/index.ts` (31 lines — full new content below)
- Modify: `packages/editor/src/bridge/ops.ts` (`dispatchOp` line 109, switch default line 892, 4 new cases)
- Modify: `packages/mcp-server/src/tools.ts` (`forward` line 35, 4 new tools after `add_physics_constraint`)
- Modify: `skills/spine-rigging/SKILL.md` (one line about constraint removal)

**Interfaces:**

- Consumes: Task 1 command classes.
- Produces: `BRIDGE_OPS` const array (59 entries), `type BridgeOp`, `interface BridgeNotice { notice: 'replaced' }` from `@spine-editor/shared` — Tasks 3–4 import these.

- [ ] **Step 1: Replace `packages/shared/src/index.ts` with**

```ts
/**
 * Types and protocol messages shared between the editor UI and the MCP server.
 */

/** The Spine JSON format version this project targets for import/export. */
export const SPINE_JSON_TARGET_VERSION = '4.2';

/** Port the MCP server's WebSocket bridge listens on; the editor connects out. */
export const DEFAULT_BRIDGE_PORT = 8017;

/**
 * Every operation the editor's bridge dispatcher understands. Single source
 * of truth: `tools.ts` may only forward these (compile-time), and the
 * `ops.ts` switch must handle every one (exhaustiveness check in its default).
 */
export const BRIDGE_OPS = [
  'ping',
  'get_project_state',
  'get_skeleton_tree',
  'new_project',
  'load_project',
  'set_mode',
  'select',
  'add_bone',
  'set_bone_transform',
  'rename_bone',
  'remove_bone',
  'reparent_bone',
  'import_image',
  'generate_image',
  'attach_image',
  'add_slot',
  'set_slot_properties',
  'set_draw_order',
  'add_ik_constraint',
  'add_transform_constraint',
  'add_path',
  'add_path_constraint',
  'add_physics_constraint',
  'remove_ik_constraint',
  'remove_transform_constraint',
  'remove_path_constraint',
  'remove_physics_constraint',
  'create_animation',
  'remove_animation',
  'set_bone_keyframe',
  'delete_bone_keyframe',
  'set_slot_attachment_keyframe',
  'preview',
  'play',
  'stop',
  'undo',
  'redo',
  'screenshot',
  'export_spine_json',
  'export_atlas',
  'set_event',
  'create_mesh',
  'set_deform_keyframe',
  'set_slot_color_keyframe',
  'set_event_keyframe',
  'set_mesh_vertices',
  'bind_weights',
  'add_clipping',
  'add_bounding_box',
  'add_point',
  'create_skin',
  'switch_skin',
  'import_atlas',
  'set_playback_speed',
  'set_draw_order_keyframe',
  'delete_draw_order_keyframe',
  'delete_event_keyframe',
  'shift_keys',
  'validate',
] as const;

export type BridgeOp = (typeof BRIDGE_OPS)[number];

/** Request sent from the MCP server to the editor over the bridge. */
export interface BridgeRequest {
  id: number;
  op: BridgeOp;
  params?: Record<string, unknown>;
}

export interface BridgeResponseOk {
  id: number;
  ok: true;
  result: unknown;
}

export interface BridgeResponseErr {
  id: number;
  ok: false;
  error: string;
}

export type BridgeResponse = BridgeResponseOk | BridgeResponseErr;

/** Server→editor notification (no id, not a request). */
export interface BridgeNotice {
  notice: 'replaced';
}
```

(59 array entries: the 55 extracted from the current `ops.ts` switch, plus the 4 `remove_*_constraint`.)

- [ ] **Step 2: Make the `ops.ts` switch exhaustive and add 4 cases**

In `packages/editor/src/bridge/ops.ts`:

a. Add to imports: `import type { BridgeOp } from '@spine-editor/shared';` and extend the core imports with `RemoveIkConstraint, RemoveTransformConstraint, RemovePathConstraint, RemovePhysicsConstraint`.

b. Change the dispatch head (line 109) from `switch (op) {` to:

```ts
export async function dispatchOp(op: string, params: Params): Promise<unknown> {
  const state = () => useEditor.getState();
  const knownOp = op as BridgeOp;
  switch (knownOp) {
```

c. Add the new cases right after `case 'add_physics_constraint': …` (search for it):

```ts
    case 'remove_ik_constraint':
      executeOrThrow(new RemoveIkConstraint(str(params, 'name')));
      return { removed: str(params, 'name') };

    case 'remove_transform_constraint':
      executeOrThrow(new RemoveTransformConstraint(str(params, 'name')));
      return { removed: str(params, 'name') };

    case 'remove_path_constraint':
      executeOrThrow(new RemovePathConstraint(str(params, 'name')));
      return { removed: str(params, 'name') };

    case 'remove_physics_constraint':
      executeOrThrow(new RemovePhysicsConstraint(str(params, 'name')));
      return { removed: str(params, 'name') };
```

d. Replace the default clause (line 892) with:

```ts
    default: {
      const unhandled: never = knownOp;
      throw new Error(`Unknown op "${String(unhandled)}".`);
    }
```

The `never` assignment makes a missing case a compile error while unknown
runtime strings still throw exactly as before.

- [ ] **Step 3: Type `forward` and add the 4 tools in `tools.ts`**

a. Import: `import type { BridgeOp } from '@spine-editor/shared';`

b. Change line 35-36 `const forward = (op: string) =>` to `const forward = (op: BridgeOp) =>`.

c. Find the `add_physics_constraint` tool registration and add after it:

```ts
server.tool(
  'remove_ik_constraint',
  'Remove an IK constraint by name (fails if an animation still keys it). Undoable.',
  { name: z.string().describe('Constraint name') },
  forward('remove_ik_constraint'),
);

server.tool(
  'remove_transform_constraint',
  'Remove a transform constraint by name (fails if an animation still keys it). Undoable.',
  { name: z.string().describe('Constraint name') },
  forward('remove_transform_constraint'),
);

server.tool(
  'remove_path_constraint',
  'Remove a path constraint by name (fails if an animation still keys it). Undoable.',
  { name: z.string().describe('Constraint name') },
  forward('remove_path_constraint'),
);

server.tool(
  'remove_physics_constraint',
  'Remove a physics constraint by name (fails if an animation still keys it). Undoable.',
  { name: z.string().describe('Constraint name') },
  forward('remove_physics_constraint'),
);
```

d. The two image tools that bypass `forward` (`screenshot_viewport`, `export_atlas`) call `bridge.request('screenshot')`/`bridge.request('export_atlas')` with plain strings — leave them; `request` keeps accepting `string` (Task 3).

- [ ] **Step 4: Prove exhaustiveness works, then verify**

Temporarily comment out `case 'ping':` + its body → run `pnpm --filter @spine-editor/editor typecheck` → MUST fail with a `never` assignment error. Restore the case.

Run: `pnpm typecheck && pnpm --filter @spine-editor/core test`
Expected: clean.

- [ ] **Step 5: Add the skill line**

In `skills/spine-rigging/SKILL.md`, find the constraints section (search "constraint") and add one bullet: `- Remove a constraint with remove_ik_constraint / remove_transform_constraint / remove_path_constraint / remove_physics_constraint (blocked while an animation keys it — delete those keys first).`

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/editor/src/bridge/ops.ts packages/mcp-server/src/tools.ts skills/spine-rigging/SKILL.md
git commit -m "Type bridge ops end-to-end and expose constraint removal tools"
```

---

### Task 3: BridgeServer hardening + first mcp-server tests

**Files:**

- Modify: `packages/mcp-server/src/bridge-server.ts` (full new content below)
- Test: `packages/mcp-server/test/bridge-server.test.ts` (new)

**Interfaces:**

- Consumes: `BridgeOp`, `BridgeNotice` from Task 2.
- Produces: `new BridgeServer(port, opts?: { token?: string })`, `bridgeServer.ready: Promise<void>`, `bridgeServer.boundPort: number` — used by tests; `request()` signature unchanged for `tools.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/mcp-server/test/bridge-server.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { BridgeServer } from '../src/bridge-server.js';

const servers: BridgeServer[] = [];
const sockets: WebSocket[] = [];

function makeServer(opts?: { token?: string }): Promise<BridgeServer> {
  const s = new BridgeServer(0, opts);
  servers.push(s);
  return s.ready.then(() => s);
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

  it('applies per-op timeouts (generate_image gets 120s, ping keeps 20s default)', async () => {
    const s = await makeServer();
    // Access the private table via a tiny public helper instead of testing
    // wall-clock: timeoutFor is exported for exactly this reason.
    expect(s.timeoutFor('generate_image')).toBe(120_000);
    expect(s.timeoutFor('import_atlas')).toBe(60_000);
    expect(s.timeoutFor('ping')).toBe(20_000);
  });

  it('rejects wrong/missing token when SPINE_BRIDGE_TOKEN is set', async () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spine-editor/mcp-server test`
Expected: FAIL — `ready`/`boundPort`/`dispose`/`timeoutFor` don't exist, disconnect leaves the request hanging (vitest timeout).

- [ ] **Step 3: Replace `packages/mcp-server/src/bridge-server.ts` with**

```ts
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
```

Behavior notes: `request()` keeps its `(op: string, …)` signature so the two
image tools that pass plain strings still compile; token defaults to the env
var so `index.ts` needs no change; `dispose()` exists for tests and hurts
nothing in production.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spine-editor/mcp-server test && pnpm --filter @spine-editor/mcp-server typecheck`
Expected: 4 tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/bridge-server.ts packages/mcp-server/test/bridge-server.test.ts
git commit -m "Harden BridgeServer: drain pending, per-op timeouts, takeover notice, opt-in token"
```

---

### Task 4: Editor bridge client — notice handling, token, backoff

**Files:**

- Modify: `packages/editor/src/bridge/bridge.ts` (full new content below)
- Modify: `packages/editor/src/components/ServerModal.tsx` (add "MCP bridge" section after the API-keys section, see anchor `className="server-keys"` at line 153)

**Interfaces:**

- Consumes: `BridgeNotice` shape from Task 2; `useEditor.getState().setError(msg)` (store.ts:250).
- Produces: localStorage key `'spine-editor.bridge-token'` — documented string, also read by nothing else.

- [ ] **Step 1: Replace `packages/editor/src/bridge/bridge.ts` with**

```ts
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
```

- [ ] **Step 2: Add the ServerModal section**

In `packages/editor/src/components/ServerModal.tsx`, inside the component that
renders the `server-keys` block (line ~153), add state near the other
`useState` hooks:

```tsx
const [bridgeToken, setBridgeToken] = useState(
  () => localStorage.getItem('spine-editor.bridge-token') ?? '',
);
```

and render after the closing tag of the `server-keys` div:

```tsx
<div className="server-keys">
  <div className="panel-title">MCP bridge</div>
  <div className="server-url-row">
    <input
      type="password"
      placeholder="Bridge token (only if the MCP server sets SPINE_BRIDGE_TOKEN)"
      title="Stored locally in this browser. Reload the tab after changing it."
      value={bridgeToken}
      onChange={(e) => setBridgeToken(e.target.value)}
    />
    <button
      type="button"
      onClick={() => {
        if (bridgeToken) localStorage.setItem('spine-editor.bridge-token', bridgeToken);
        else localStorage.removeItem('spine-editor.bridge-token');
      }}
    >
      Save
    </button>
  </div>
</div>
```

Match the file's actual JSX structure when inserting (the `server-keys`/`server-url-row`/`panel-title` classes already exist in `styles.css`); if the keys section lives in a sub-component, put this block in the same parent that renders that sub-component.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @spine-editor/editor typecheck && pnpm lint && pnpm format:check`
Expected: clean (run `pnpm exec prettier --write` on touched files if format:check complains).

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/bridge/bridge.ts packages/editor/src/components/ServerModal.tsx
git commit -m "Editor bridge: takeover notice handling, opt-in token, auth backoff"
```

---

### Task 5: Core hygiene — physics tests, atlas round-trip, evaluator docs/wiring

**Files:**

- Test: `packages/core/test/physics.test.ts` (new)
- Test: `packages/core/test/atlas-roundtrip.test.ts` (new)
- Modify: `packages/core/src/evaluate.ts` (header lines 1–12 + one import)
- Modify: `packages/core/src/pose.ts` (comment at `registerPathConstraintApplier`)

**Interfaces:**

- Consumes: `PhysicsSimulator` public API — `constructor(data: SkeletonData)`, `.localsAt(animation: string | null, time: number): BoneData[]`, `.reset()`, `.hasConstraints`; `packAtlas(inputs, options): AtlasLayout`, `atlasToText(pngName, layout): string`, `parseAtlas(text): AtlasPage[]`.

- [ ] **Step 1: Write `packages/core/test/physics.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { PhysicsSimulator, createBone, createEmptySkeleton } from '../src/index.js';
import type { SkeletonData } from '../src/index.js';

function rig(gravity: number, opts: Partial<{ limit: number; wind: number }> = {}): SkeletonData {
  const data = createEmptySkeleton();
  data.bones.push(createBone('swing', 'root'));
  data.physics.push({
    name: 'ph',
    bone: 'swing',
    x: 1,
    y: 1,
    inertia: 0.5,
    strength: 50,
    damping: 0.8,
    gravity,
    wind: opts.wind ?? 0,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
  return data;
}

const boneY = (locals: ReturnType<PhysicsSimulator['localsAt']>) =>
  locals.find((b) => b.name === 'swing')!.y;
const boneX = (locals: ReturnType<PhysicsSimulator['localsAt']>) =>
  locals.find((b) => b.name === 'swing')!.x;

describe('PhysicsSimulator', () => {
  it('is deterministic: same time twice gives identical locals', () => {
    const sim = new PhysicsSimulator(rig(-50));
    const a = structuredClone(sim.localsAt(null, 1.0));
    const b = structuredClone(sim.localsAt(null, 1.0));
    expect(b).toEqual(a);
  });

  it('re-simulates from zero on backward scrub, matching a fresh simulator', () => {
    const sim = new PhysicsSimulator(rig(-50));
    sim.localsAt(null, 2.0);
    const rewound = structuredClone(sim.localsAt(null, 1.0));
    const fresh = new PhysicsSimulator(rig(-50));
    expect(rewound).toEqual(structuredClone(fresh.localsAt(null, 1.0)));
  });

  it('gravity displaces the bone and flipping the sign mirrors the offset', () => {
    const down = new PhysicsSimulator(rig(-80)).localsAt(null, 1.5);
    const up = new PhysicsSimulator(rig(80)).localsAt(null, 1.5);
    const rest = 0; // createBone default y
    expect(boneY(down)).not.toBeCloseTo(rest, 5);
    expect(boneY(down) - rest).toBeCloseTo(-(boneY(up) - rest), 3);
  });

  it('wind displaces along x', () => {
    const sim = new PhysicsSimulator(rig(0, { wind: 100 }));
    expect(boneX(sim.localsAt(null, 1.5))).not.toBeCloseTo(0, 5);
  });

  it('limit clamps the offset magnitude', () => {
    const clamped = new PhysicsSimulator(rig(-500, { limit: 1 }));
    const y = boneY(clamped.localsAt(null, 2.0));
    expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('keeps state per constraint (two bones do not interfere)', () => {
    const data = rig(-50);
    data.bones.push(createBone('still', 'root'));
    data.physics.push({
      name: 'ph2',
      bone: 'still',
      x: 1,
      y: 1,
      inertia: 0.5,
      strength: 50,
      damping: 0.8,
      gravity: 0,
      wind: 0,
    });
    const locals = new PhysicsSimulator(data).localsAt(null, 1.5);
    expect(boneY(locals)).not.toBeCloseTo(0, 5); // gravity-driven bone moved
    expect(locals.find((b) => b.name === 'still')!.y).toBeCloseTo(0, 5); // becalmed bone did not
  });

  it('reset clears accumulated state', () => {
    const sim = new PhysicsSimulator(rig(-50));
    sim.localsAt(null, 2.0);
    sim.reset();
    const fresh = new PhysicsSimulator(rig(-50));
    expect(structuredClone(sim.localsAt(null, 0.5))).toEqual(
      structuredClone(fresh.localsAt(null, 0.5)),
    );
  });
});
```

If a numeric expectation fails (sign conventions), investigate the simulator
(`packages/core/src/physics.ts`) and fix the TEST to assert the documented
behavior — do not change the simulator in this task.

- [ ] **Step 2: Write `packages/core/test/atlas-roundtrip.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { atlasToText, packAtlas, parseAtlas } from '../src/index.js';

describe('atlas pack → text → parse round-trip', () => {
  it('preserves every region name, size and position', () => {
    const layout = packAtlas(
      [
        { name: 'head', width: 64, height: 80 },
        { name: 'torso', width: 100, height: 120 },
        { name: 'hand', width: 30, height: 30 },
      ],
      { maxWidth: 256, padding: 2 },
    );
    const text = atlasToText('page.png', layout);
    const pages = parseAtlas(text);
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.regions).toHaveLength(3);
    for (const placed of layout.regions) {
      const parsed = page.regions.find((r) => r.name === placed.name)!;
      expect(parsed, placed.name).toBeDefined();
      expect(parsed.x).toBe(placed.x);
      expect(parsed.y).toBe(placed.y);
      expect(parsed.width).toBe(placed.width);
      expect(parsed.height).toBe(placed.height);
      expect(parsed.rotate ?? false).toBe(false);
    }
  });

  // The shelf packer never rotates regions (atlasToText always writes
  // "rotate: false"), so rotation is exercised only by the import fixtures
  // in phase10.test.ts — this suite intentionally covers the writer's output.
});
```

Check `AtlasRegion`'s exact field names in `packages/core/src/atlas-import.ts:8`
before running; adjust property access (`x/y/width/height/rotate`) to match.

- [ ] **Step 3: Run both new suites — expect PASS (they test existing behavior)**

Run: `pnpm --filter @spine-editor/core test -- test/physics.test.ts test/atlas-roundtrip.test.ts`
Expected: PASS. Any failure = the test's assumption is wrong; align the test with actual documented behavior (see notes in each step).

- [ ] **Step 4: Fix the evaluator header and wire the path applier**

In `packages/core/src/evaluate.ts`, replace lines 1–12 (the header comment) with:

```ts
/**
 * Animation evaluator: samples an animation at time t and produces the
 * animated pose (bone locals, world matrices, slot attachments, colors,
 * deforms and draw order).
 *
 * Evaluated: all bone timelines (rotate/translate/scale/shear + single-axis
 * variants) with linear/stepped/bezier curves; slot attachment, rgba and
 * alpha timelines; IK (mix + bendPositive), transform constraints (static
 * mix values) and path constraint position/spacing/mix timelines; mesh
 * deform; draw order. Physics constraints preview via PhysicsSimulator.
 * Not evaluated (data round-trips untouched): events, animated
 * transform-constraint mix timelines, animated physics-property timelines,
 * bone inherit timelines, two-color (rgba2/rgb2) and sequence timelines.
 *
 * Spine timeline semantics: rotate/translate/shear values are OFFSETS added
 * to the setup pose; scale values are FACTORS multiplied with the setup pose.
 */
```

Then add below the existing imports:

```ts
// Registers the path-constraint applier with pose.ts (import side effect) so
// evaluator users get path constraints even without importing the barrel.
import './path.js';
```

In `packages/core/src/pose.ts`, find `registerPathConstraintApplier` and add
above it:

```ts
// Registered by path.ts as an import side effect (see the import in
// evaluate.ts and index.ts). Import path.js before calling computePose
// directly, or path constraints are silently skipped.
```

- [ ] **Step 5: Full core suite + typecheck + commit**

Run: `pnpm --filter @spine-editor/core test && pnpm --filter @spine-editor/core typecheck`
Expected: all pass.

```bash
git add packages/core/test/physics.test.ts packages/core/test/atlas-roundtrip.test.ts packages/core/src/evaluate.ts packages/core/src/pose.ts
git commit -m "Add physics and atlas round-trip tests; fix evaluator header and path wiring"
```

---

### Task 6: E2E probe, doc counts, full verification

**Files:**

- Modify: `packages/mcp-server/e2e/bridge.mjs` (after the `add_ik_constraint` call at line 68)
- Modify: `CLAUDE.md` (tool-count mentions: "48 MCP tools total" → 52, "MCP tool `generate_image` (48 tools total)" → "(52 tools total)")

**Interfaces:**

- Consumes: tools from Task 2 running against the editor via the full stdio→WS chain.

- [ ] **Step 1: Add the remove/undo probe to `bridge.mjs`**

After line 68 (`await call('add_ik_constraint', …)`), insert:

```js
// Constraint removal round-trip: remove → gone from tree → undo → back.
await call('remove_ik_constraint', { name: 'arm-ik' });
const treeNoIk = await call('get_skeleton_tree');
const ikNamesAfterRemove = (treeNoIk.ik ?? []).map((c) => c.name);
await call('undo');
const treeIkBack = await call('get_skeleton_tree');
const ikNamesAfterUndo = (treeIkBack.ik ?? []).map((c) => c.name);
```

and add to the final JSON summary object (find where other booleans are
collected near the end of the file):

```js
removeConstraintWorks:
  !ikNamesAfterRemove.includes('arm-ik') && ikNamesAfterUndo.includes('arm-ik'),
```

Before wiring the assert, check how `get_skeleton_tree` names its IK list in
the existing Phase-9 asserts in this same file (search `tree` usages); use the
same property path.

- [ ] **Step 2: Update CLAUDE.md tool counts**

Search CLAUDE.md for `48` (two mentions of the MCP tool total) and update to
`52 MCP tools total` / `(52 tools total)` accordingly. Do not touch other numbers.

- [ ] **Step 3: Run the full e2e chain (requires Chromium)**

Build + preview the editor and run the bridge e2e per `.claude/skills/verify/SKILL.md`:

```bash
pnpm --filter @spine-editor/editor build
(cd packages/editor && npx vite preview --port 4173 &) && sleep 2
(cd packages/mcp-server && node e2e/bridge.mjs)
```

Expected: JSON summary with `removeConstraintWorks: true` and every existing
probe still true; tool count printed as 52. Kill the preview server after
(`fuser -k 4173/tcp` or kill the background job; also `fuser -k 8017/tcp` if a
stale tsx process holds the bridge port — documented gotcha).

- [ ] **Step 4: Full repo verification**

Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/e2e/bridge.mjs CLAUDE.md
git commit -m "E2E constraint-removal probe; bump documented tool count to 52"
```

---

### Final acceptance (maps to spec §4)

- [ ] Deleting any switch case in `ops.ts` breaks `pnpm typecheck` (spot-checked in Task 2, not committed) — §4.1
- [ ] `pnpm test` green including 4 new test files — §4.2
- [ ] `bridge.mjs` passes with the removal probe, 52 tools — §4.3
- [ ] Manual two-tab smoke: second tab connects, first shows the replaced notice and stays quiet — §4.4 (run once, note result)
- [ ] Manual token smoke: `SPINE_BRIDGE_TOKEN=abc pnpm --filter @spine-editor/mcp-server start` + editor without token → auth error + 15s backoff; with token saved + reload → connects — §4.5 (run once, note result)
- [ ] `pnpm lint && pnpm format:check` green — §4.6
