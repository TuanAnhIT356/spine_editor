# Restructure client/ + server/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repo root contains exactly two code folders — `client/` (whole Node/TS workspace) and `server/` (FastAPI, untouched) — with meta (docs, skills, CI, configs) at root, and everything still green end-to-end.

**Architecture:** One pure-move commit (`git mv` the Node workspace down into `client/` — every internal relative path keeps working because everything shifts one level together), then one tooling commit (CI working-directory, `.mcp.json` codegraph bin, prettier globs for root docs), then docs. E2E full chain (bridge + chat) is the acceptance gate.

**Tech Stack:** git mv, pnpm workspace, GitHub Actions, prettier/eslint, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-11-restructure-client-server-design.md`

## Global Constraints

- Branch `claude/restructure-client-server` (spec committed), based on main `e9db408` (PR #16 merged).
- Task 1 is **git mv only — zero content edits** (reviewable as pure renames: `git show --stat -M` shows 100% renames).
- pnpm via shim: `export PATH="/private/tmp/claude-501/-Users-tuananh-Projects-you-spine-editor/6b990f26-97bc-4e20-b105-3db5aab338c5/scratchpad/bin:$PATH"` + `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`; ALL pnpm commands now run from `client/`.
- Do NOT touch anything under `server/`; do NOT rewrite historical docs in `docs/superpowers/`.
- Chromium for e2e: `$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
- Every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Pure move — Node workspace into client/

**Files:** (moves only)

- `packages/` → `client/packages/`, `examples/` → `client/examples/`
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore` → same names under `client/`

- [ ] **Step 1: Move**

```bash
cd /Users/tuananh/Projects/you/spine_editor
mkdir client
git mv packages examples package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.js .prettierrc.json .prettierignore client/
rm -rf node_modules   # untracked; will be reinstalled inside client/
git status --short | head   # expect only R (rename) entries
```

- [ ] **Step 2: Reinstall + prove the invariants**

```bash
cd client && pnpm install
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
git status --short   # pnpm install must not dirty pnpm-lock.yaml
```

Expected: everything green with **no content edit** — tsconfig `extends ../../tsconfig.base.json`, fixtures `../../../examples/fixtures`, and workspace globs all still resolve (each is relative and the whole tree moved together). 127 tests.

- [ ] **Step 3: Commit (pure renames)**

```bash
git add -A && git commit -m "Restructure: move Node workspace into client/ (pure git mv)"
git show --stat -M HEAD | tail -5   # sanity: renames, no +/- content churn
```

---

### Task 2: Tooling — CI, codegraph, prettier scope

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.mcp.json`
- Modify: `client/package.json` (format scripts)
- Modify: `client/.prettierignore`

- [ ] **Step 1: `.github/workflows/ci.yml`** — replace the `ci` job header and setup steps (server job untouched):

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: client
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          package_json_file: client/package.json
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: client/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: `.mcp.json`** — root has no node_modules anymore; point at the workspace bin:

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "client/node_modules/.bin/codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

- [ ] **Step 3: `client/package.json`** — keep root docs under prettier (they were covered when prettier ran at root):

```json
"format": "prettier --write . \"../docs/**/*.md\" \"../*.md\"",
"format:check": "prettier --check . \"../docs/**/*.md\" \"../*.md\""
```

- [ ] **Step 4: `client/.prettierignore`** — drop the now-meaningless `server/` line; keep the rest:

```
pnpm-lock.yaml
e2e-out/
```

- [ ] **Step 5: Verify + commit**

```bash
cd client && pnpm format:check   # now also checks ../docs/**/*.md and ../*.md — expect clean
git add .github/workflows/ci.yml .mcp.json client/package.json client/.prettierignore
git commit -m "Restructure: CI working-directory, codegraph bin path, prettier covers root docs"
```

---

### Task 3: Docs — CLAUDE.md, README.md, verify skill

**Files:**

- Modify: `CLAUDE.md` (Commands, Codegraph, Architecture sections)
- Modify: `README.md` (codegraph note, e2e paths, any `pnpm`-from-root instructions)
- Modify: `.claude/skills/verify/SKILL.md` (recipe block)

- [ ] **Step 1: CLAUDE.md — Commands section**: replace the line `pnpm monorepo (Node >= 22). Run from the repo root:` with `pnpm monorepo (Node >= 22) in `client/`. Run from `client/`:` (command list itself unchanged). CI summary line unchanged.

- [ ] **Step 2: CLAUDE.md — Codegraph section**: replace `One-time setup after \`pnpm install\`: \`pnpm exec codegraph init .\``with`One-time setup after \`cd client && pnpm install\`: from the repo root run \`client/node_modules/.bin/codegraph init .\``and the maintenance sentence's`pnpm exec codegraph ...`forms with`client/node_modules/.bin/codegraph index . --force`/`... unlock`/`... telemetry off`.

- [ ] **Step 3: CLAUDE.md — Architecture tree**: replace the current tree with:

```
client/            # pnpm workspace — all Node/TS code
├── packages/
│   ├── core/        # Framework-agnostic heart: document model, command system (undo/redo),
│   │                # animation evaluator, Spine JSON serializer/parser. NO UI dependencies.
│   ├── editor/      # React + Vite app (viewport, hierarchy, inspector, timeline panels)
│   ├── mcp-server/  # MCP server exposing editor operations to AI over the ws bridge
│   └── shared/      # Constants, TOOL_DEFS and editor↔MCP/chat protocol types
└── examples/        # Hand-written Spine JSON fixtures used by core round-trip tests
skills/            # SKILL.md files teaching AI agents rigging/animating workflows
server/            # Opt-in Python backend (FastAPI): accounts, projects, BYOK key vault,
                   # image gen/segment, AI chat; editor talks REST/ws (src/server/api.ts), :8100
```

Also update the e2e list at the end of the Project section: `client/packages/editor/e2e/smoke.mjs` / `anim.mjs` / `chat.mjs`, `client/packages/mcp-server/e2e/bridge.mjs`.

- [ ] **Step 4: README.md** — update the codegraph paragraph (`pnpm exec codegraph init .` → `cd client && pnpm install`, then `client/node_modules/.bin/codegraph init .` from root) and the verification-scripts line (`packages/editor/e2e/` → `client/packages/editor/e2e/`, same for mcp-server). Then `grep -n "packages/\|pnpm " README.md` and fix any remaining root-relative command or path (e.g. quickstart `pnpm install` → `cd client && pnpm install`).

- [ ] **Step 5: `.claude/skills/verify/SKILL.md`** — replace the recipe block with:

```bash
cd client
pnpm --filter @spine-editor/editor build
(cd packages/editor && npx vite preview --port 4173 &)   # serve the built app
node packages/editor/e2e/smoke.mjs <outDir>              # setup mode: rig + attach + export
node packages/editor/e2e/anim.mjs <outDir>               # animate mode: keys + playback
node packages/mcp-server/e2e/bridge.mjs <outDir>         # full MCP chain (spawns MCP server itself)
node packages/editor/e2e/chat.mjs <outDir>               # chat pipeline (server :8100 with SPINE_SERVER_CHAT_FAKE=1)
```

and change the sentence below it to reference `client/packages/editor/e2e/smoke.mjs`.

- [ ] **Step 6: Verify + commit**

```bash
cd client && pnpm format:check   # covers the edited root markdown
git add CLAUDE.md README.md .claude/skills/verify/SKILL.md
git commit -m "Restructure: docs point at client/ (commands, codegraph, e2e paths)"
```

---

### Task 4: Full verification (no new files)

- [ ] **Step 1: Node + Python suites**

```bash
cd client && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
(cd ../server && uv run pytest -q && uv run ruff check .)
```

Expected: 127 Node tests, 60 pytest (+2 skip), all green.

- [ ] **Step 2: E2E full chain from the new layout**

```bash
# kill stale listeners first: lsof -nP -iTCP:4173 -sTCP:LISTEN -t | xargs kill; same for 8017, 8100
cd client/packages/editor && nohup npx vite preview --port 4173 --strictPort &
cd ../../..   # repo root
(cd client/packages/mcp-server && CHROMIUM_PATH="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" node e2e/bridge.mjs)
# expect toolCount: 55, rigFromPartsWorks/presetWalkWorks true, all flags unchanged
(cd server && SPINE_SERVER_CHAT_FAKE=1 SPINE_SERVER_SEGMENT_FAKE=1 SPINE_SERVER_DATA_DIR=$(mktemp -d) nohup uv run uvicorn app.main:app --port 8100 &)
(cd client && CHROMIUM_PATH="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" node packages/editor/e2e/chat.mjs)
# expect chatRigWorks: true, failedChips: 0
```

- [ ] **Step 3: Codegraph re-index + root hygiene**

```bash
client/node_modules/.bin/codegraph unlock 2>/dev/null; client/node_modules/.bin/codegraph index . --force 2>&1 | tail -2
ls -A | grep -v '^\.'   # expect exactly: CLAUDE.md LICENSE PLAN.md README.md client docs server skills (+ stray e2e-out if present, gitignored)
```

- [ ] **Step 4: Stop background servers; final `git status --short` clean; no extra commit needed unless verification forced a fix.**

---

### Final acceptance (spec §5)

- [ ] client suites green from `client/` (§5.1) and server pytest/ruff green (§5.2)
- [ ] `bridge.mjs` 55 tools + `chat.mjs` chatRigWorks from the new paths (§5.3)
- [ ] codegraph re-indexed via `client/node_modules/.bin/codegraph` (§5.4)
- [ ] CI green on the PR — both jobs (§5.5, checked after push)
