# Codegraph Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) into the repo as a project-scoped MCP server so AI agents answer code-structure questions in one `codegraph_explore` call.

**Architecture:** Dev-tooling only — a pinned root devDependency provides the `codegraph` CLI; a committed `.mcp.json` spawns `codegraph serve --mcp` (stdio, 100% local) for any MCP client opened at the repo root; the SQLite index lives in gitignored `.codegraph/` and auto-syncs via OS file watchers. No product code changes.

**Tech Stack:** `@colbymchenry/codegraph` ^1.4.0 (MIT, bundles own runtime), pnpm 10 workspace, MCP stdio protocol (JSON-RPC 2.0).

**Spec:** `docs/superpowers/specs/2026-07-10-codegraph-design.md`

## Global Constraints

- Run all pnpm commands as `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm …` — pnpm is not on PATH in automation shells; the repo pins `pnpm@10.33.0` via `packageManager`.
- Work happens on branch `claude/codegraph-integration` (already exists, spec + bug fixes committed).
- Never commit `.codegraph/` (index) or anything under the scratchpad.
- Dependency pin is exactly `"@colbymchenry/codegraph": "^1.4.0"` in ROOT `package.json` devDependencies (alphabetical position: first, before `@eslint/js`).
- Turn codegraph telemetry off before indexing.
- Repo is Apache-2.0; the tool is MIT and only a devDependency — no license file changes.

---

### Task 1: devDependency + working CLI

**Files:**

- Modify: `package.json` (repo root, devDependencies block)

**Interfaces:**

- Produces: `corepack pnpm exec codegraph …` working from repo root — every later task calls this.

- [ ] **Step 1: Add the dependency**

In root `package.json`, change:

```json
  "devDependencies": {
    "@eslint/js": "^9.39.2",
```

to:

```json
  "devDependencies": {
    "@colbymchenry/codegraph": "^1.4.0",
    "@eslint/js": "^9.39.2",
```

- [ ] **Step 2: Install**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install`
Expected: lockfile updated, `+ @colbymchenry/codegraph 1.4.x` in output, exit 0.

- [ ] **Step 3: Verify the CLI runs**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph version`
Expected: prints `1.4.x`.

If it fails with a missing-binary error (pnpm 10 blocks dependency build scripts):
run `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm approve-builds`, approve the
codegraph package(s), which writes `pnpm.onlyBuiltDependencies` into root
`package.json`; re-run Step 2 and Step 3.

- [ ] **Step 4: Full-repo sanity check**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm lint && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm format:check`
Expected: both exit 0 (package.json edit is format-clean).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Add @colbymchenry/codegraph as root devDependency"
```

---

### Task 2: Project MCP registration + gitignore

**Files:**

- Create: `.mcp.json` (repo root)
- Modify: `.gitignore`
- Test (scratch, NOT committed): `mcp-smoke.mjs` in a temp dir OUTSIDE the repo (session scratchpad or `$TMPDIR`)

**Interfaces:**

- Consumes: working `codegraph` CLI from Task 1.
- Produces: `.mcp.json` entry named `codegraph` that MCP clients (Claude Code) auto-detect at the repo root.

- [ ] **Step 1: Create `.mcp.json`**

Exact content:

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "npx",
      "args": ["codegraph", "serve", "--mcp"]
    }
  }
}
```

- [ ] **Step 2: Gitignore the index**

Append to `.gitignore`:

```
# codegraph index (rebuild per-machine: pnpm exec codegraph init .)
.codegraph/
```

- [ ] **Step 3: Write the MCP stdio smoke test (scratchpad)**

Create `mcp-smoke.mjs` in a temp dir outside the repo:

```js
import { spawn } from 'node:child_process';

const proc = spawn('npx', ['codegraph', 'serve', '--mcp'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'inherit'],
});
const send = (o) => proc.stdin.write(JSON.stringify(o) + '\n');
const timer = setTimeout(() => {
  console.error('TIMEOUT waiting for MCP handshake');
  proc.kill();
  process.exit(1);
}, 30000);

let buf = '';
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    } else if (msg.id === 2) {
      const names = (msg.result?.tools ?? []).map((t) => t.name);
      console.log('tools:', JSON.stringify(names));
      clearTimeout(timer);
      proc.kill();
      process.exit(names.includes('codegraph_explore') ? 0 : 1);
    }
  }
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.0.0' },
  },
});
```

- [ ] **Step 4: Run the smoke test from the repo root**

Run: `node /path/to/temp/mcp-smoke.mjs` with cwd = repo root (the script relies on cwd to resolve `pnpm exec` against this workspace)
Expected: prints `tools: […]` including `"codegraph_explore"`, exit 0.
This also proves the exact `.mcp.json` command+args work as a stdio MCP server.

- [ ] **Step 5: Commit**

```bash
git add .mcp.json .gitignore
git commit -m "Register codegraph as project-scoped MCP server"
```

---

### Task 3: Index the repo + verify coverage and auto-sync

**Files:** none committed (index is gitignored) — this task's deliverable is a verified working index on this machine.

**Interfaces:**

- Consumes: CLI (Task 1). Independent of Task 2.
- Produces: `.codegraph/codegraph.db` covering `packages/` (TS/TSX) and `server/` (Python); verified query commands quoted in Task 4 docs.

- [ ] **Step 1: Telemetry off**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph telemetry off`
Expected: confirmation message, exit 0.

- [ ] **Step 2: Init + full index**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph init .`
Expected: completes without error; `.codegraph/` created at repo root.

- [ ] **Step 3: Verify both languages are indexed**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph status`
Expected: file/symbol counts > 0. Then confirm per-language reach:

- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph query computePose` → hits in `packages/core/src/pose.ts`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph query get_current_user` → hits in `server/app/deps.py`

- [ ] **Step 4: Smoke the graph queries**

- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph callers computePose`
  Expected: caller list includes editor viewport/renderer code.
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph explore "how does the editor dispatch commands to core"`
  Expected: returns symbol sources/call paths mentioning the zustand store `execute` and core `Command`/`History`.
- Also verify the NUL-byte fix paid off:
  `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph query TransformBoneKeys`
  Expected: hit in `packages/core/src/commands/animations.ts`.

- [ ] **Step 5: Verify auto-sync**

1. Append to `packages/core/src/mesh.ts` a throwaway export:
   `export function codegraphSyncProbe(): number { return 42; }`
2. Wait ~10 s (watcher debounce), then run
   `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph query codegraphSyncProbe`
   Expected: 1 hit. If the watcher daemon isn't running in a headless shell,
   `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec codegraph sync` then re-query — must hit.
3. Revert: `git checkout -- packages/core/src/mesh.ts`, run `… codegraph sync` again.

Nothing to commit in this task.

---

### Task 4: Docs (CLAUDE.md + README)

**Files:**

- Modify: `CLAUDE.md` (insert new section between `## Commands` and `## Architecture`)
- Modify: `README.md` (extend `## Development` section)

**Interfaces:**

- Consumes: command spellings verified in Task 3.

- [ ] **Step 1: Add CLAUDE.md section**

Insert after the Commands section (before `## Architecture`):

```markdown
## Codegraph (code intelligence for AI agents)

The repo registers [codegraph](https://github.com/colbymchenry/codegraph) as a
project-scoped MCP server (`.mcp.json`). Prefer its `codegraph_explore` tool for
structure/flow questions ("how does X reach Y", "what calls Z") before manual
grep/read — one call returns the relevant symbols' source plus the call paths
between them. One-time setup after `pnpm install`: `pnpm exec codegraph init .`
(index in `.codegraph/`, gitignored, auto-syncs on file changes). Maintenance:
`pnpm exec codegraph index . --force` rebuilds, `pnpm exec codegraph unlock`
clears a stale lock, `pnpm exec codegraph telemetry off` disables telemetry.
```

- [ ] **Step 2: Add README paragraph**

In `README.md`, at the end of the `## Development` section (after the
`pnpm lint && pnpm format:check` code block's paragraph, before
`Architecture and roadmap…` — keep that final paragraph last), insert:

```markdown
AI agents get a local code knowledge graph via
[codegraph](https://github.com/colbymchenry/codegraph), registered in
`.mcp.json`. One-time setup: `pnpm exec codegraph init .` — the index
(`.codegraph/`, gitignored) auto-syncs as you code. If the pnpm-installed
binary doesn't run on your platform, install it globally
(`npm i -g @colbymchenry/codegraph`) and change `.mcp.json`'s command from
`pnpm` to `codegraph` with args `["serve", "--mcp"]`.
```

- [ ] **Step 3: Format check**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm format:check`
Expected: exit 0 (if Prettier complains about the md edits, run
`COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm format` and re-check).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Document codegraph workflow for agents and devs"
```

---

### Final acceptance (maps to spec §6)

- [ ] `corepack pnpm exec codegraph version` → 1.4.x (§6.1)
- [ ] `codegraph status` shows TS + Python coverage (§6.2, Task 3)
- [ ] CLI `explore`/`callers` return real symbols (§6.3, Task 3)
- [ ] MCP handshake lists `codegraph_explore` (§6.4, Task 2)
- [ ] Auto-sync verified (§6.5, Task 3)
- [ ] `pnpm lint && pnpm format:check` green (§6.6, Tasks 1 & 4)
