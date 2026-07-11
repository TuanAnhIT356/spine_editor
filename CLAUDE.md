# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A web-based 2D skeletal animation editor (Spine-like UI) that exports the Spine JSON format
(target version **4.2**), with an MCP server + skills so AI agents can rig and animate.
The full roadmap, architecture rationale, and phase breakdown live in `PLAN.md` — read it before
starting work on a new phase. Current status: **Phases 0-10 done** (evaluator covers bone/IK/
transform/path-constraint/slot-color/attachment/deform/draw-order timelines with all five
bone inherit modes and full IK softness/stretch/compress; PhysicsSimulator previews physics
constraints deterministically at fixed 1/60s steps; resizable panels, multi-select, timeline
zoom, keyboard shortcuts; Phase 7 pro animation tools: graph editor, dopesheet box-select/
group-drag/time-scaling, playback speed + frame stepping, ghosting, draw-order + event
tracks; Phase 8 mesh & weights UI: viewport vertex editing with deform auto-key, auto
weights + heatmap + brush painting, real clipping masks, bounding-box/point attachments;
Phase 9 path attachments/constraints with arc-length spline sampling; Phase 10 skins UI +
active-skin rendering, atlas import (both libgdx layouts, rotated regions), GIF export via
gifenc, hierarchy search — 47 MCP tools total). Remaining gaps, tracked in PLAN.md §6:
binary .skel, PSD import, video/PNG-sequence export, add/remove mesh vertices, dockable
panels; physics preview is an approximation (exports run the real runtime simulation).
PLAN.md §7 covers the opt-in Python backend in `server/` (FastAPI; repo splits into
frontend `client/` + `server/`). **Phase 11 done**: accounts (register/login/logout/
forgot+reset password, argon2id + rotating httpOnly refresh cookie), per-user project
list with viewport thumbnails + 3s-debounced server autosave, BYOK key vault
(AES-256-GCM, masked), per-user settings endpoint; editor gets Server/Projects toolbar
modals (`src/server/api.ts`, e2e: `client/packages/editor/e2e/server.mjs`, needs the server on
:8100). **Phase 12 done**: BYOK image-gen — `server/app/providers/` adapters (openai
gpt-image-1.5 transparent, stability, runware LayerDiffuse, fal, mock for free local
tests), `/api/generate` + per-user gallery stored in the DB, editor Generate dialog with
game-asset prompt template + cost estimate, MCP tool `generate_image`. Bridge hardening
(07/2026): typed op protocol (`BRIDGE_OPS` in shared, compile-time exhaustive), pending
requests reject on tab disconnect, per-op timeouts, takeover notice, opt-in
`SPINE_BRIDGE_TOKEN` auth, and remove_{ik,transform,path,physics}_constraint —
**Phase 13 done** (both slices): segmentation strategy B —
`server/app/segment/` (rembg + MediaPipe pose in-process, SAM 2 via fal BYOK, free mock,
or local SAM 2 via `uv sync --extra sam-local`, all behind a `SegmentBackend` protocol),
`/api/segment` (remove-bg/pose/parts/backends) with optional occlusion inpainting
(providers gained optional `inpaint`/`edit` methods: Stability + OpenAI + mock), editor
Segment dialog (mask review with point prompts, per-part re-run, inpaint toggle)
importing parts as assets with source `origin` + optional place-on-canvas; strategy A
via `POST /api/generate/part-set` + "Generate part set" in the Generate dialog; MCP tool
`segment_image` shares `src/segment/import-parts.ts` with the dialog —
**59 MCP tools total**. `SPINE_SERVER_SEGMENT_FAKE=1` gives deterministic engines for
tests/e2e/CI.
**Phase 14 done**: slice 1 — `rig_from_parts` (auto-skeleton from placed parts —
joints from box geometry via `core/src/autorig.ts`, 2-bone IK, one undo step) and
`apply_preset_animation` (idle/walk/wave from `core/src/presets.ts`, retargeted with
length-scaled translates); slice 2 — AI chat: tool defs live in shared (`TOOL_DEFS`,
59 tools, mcp-server registers from it), the editor's floating ChatWindow connects to
`ws /api/chat/ws`, sends the 59 JSON Schemas in `hello`, and executes dispatched ops
via the bridge op layer; FastAPI runs the anthropic streaming loop (claude-opus-4-8,
adaptive thinking, BYOK vault key) with history in `conversations`/`messages`
(content blocks verbatim — resume replays exact context).
`SPINE_SERVER_CHAT_FAKE=1` scripts the model for tests/e2e (the pipeline itself runs
real). **Phase 15 (Spine-parity U1) done**: Spine-style shell — theme tokens, titlebar
file menu + icon actions + dirty star + Views dropdown, in-viewport SETUP/ANIMATE
banner, bottom tool cluster (live numeric transforms with `+`/`*`/`/` entry, new
scale/shear tools, Local/Parent/World axes with Shift-constrain, selection/visibility/
label filters, Auto Key toggle), bone breadcrumb, zoom slider. **Phase 16 done** (both slices): unified right-side TreePanel (bones▸slots▸attachments nesting, Constraints/Skins/
Events/Animations/Images sections, per-item visibility dots wired into the renderer,
colored type icons, search) with the bone/slot properties dock at its bottom —
HierarchyPanel/PropertiesPanel removed; 16b — dock editors for all constraint types
(new Set\*ConstraintProperties + SetBoneColor core commands), event/animation docks,
set_*_constraint MCP tools (59 total), tree context menus + inline rename.
**Phase 17 done**: Spine-style animate dock — Graph/Dopesheet tabs with Sync,
toolbar (Filter by timeline type, Lock rows, Shift selected keys, Offset all keys),
Current/Loop Start/End fields with loop-range playback, full transport, colored key
ticks + per-bone summary rows (white on multi-type frames) + red summary diamonds +
interpolation connectors, and transient posing when Auto Key is off (key buttons
commit the pose). **Phase 18 done**: `core/src/mixer.ts` TrackMixer (4 tracks,
crossfade/speed/loop/alpha/hold-previous/additive on bone locals), floating Preview
window (own SceneRenderer + RAF, animation list click-assign, per-track Speed/Mix/
Repeat + Alpha/Hold/Additive), configurable onion-skin ghosting (store `ghostConfig`
before/after/spacing/opacity + Ghosting window; Playback view folded into the P17
transport + Preview). **Phase 19 done**: mesh vertex add/remove/weld/reset with
Delaunay retriangulation (`core/src/mesh-edit.ts`, delaunator; `SetMeshGeometry`
clears deform keys in the same undo step; grid builder now emits the Spine-convention
hull ring), weight ops smooth/prune/swap/remove-bone (`weights.ts`), floating Weights
window (bone palette + %, Bind/Remove/Swap, Auto/Smooth/Prune, brush Amount +
Add/Replace with Shift-subtract, multi-color vertex overlay + bone tint), mesh tool
row Modify/Create/Delete/Weights/Weld/Reset (geometry edits setup-mode only), MCP
`edit_mesh` + `adjust_weights` — **61 MCP tools total**. **Phase 20 done**: audio —
`AudioAsset` trong store + project payload (field optional `audioAssets`), Web Audio
engine (`src/audio/engine.ts`: decode cache, peaks, play qua gain+panner, mute),
section AUDIO trong tree (import/preview/xóa), EventDock audio thành select,
waveform theo zoom trên track events (`EventWave`), phát tiếng event khi play
(loop-wrap aware, volume/balance = key ?? def, rate = speed) và khi scrub 2 chiều,
nút 🔊/🔇 transport; MCP `import_audio` — **62 MCP tools total**. Next: PLAN.md §8
phases 21–22.
Architecture: AI ⇄ MCP (stdio, `client/packages/mcp-server`) ⇄ ws://localhost:8017 ⇄ editor tab
(`src/bridge/` dispatches ops through the same command API as the UI).
Verify changes end-to-end with the project verify skill (`.claude/skills/verify/SKILL.md`) —
real-Chromium scripts: `client/packages/editor/e2e/smoke.mjs` (setup mode), `client/packages/editor/e2e/anim.mjs`
(animate mode), `client/packages/mcp-server/e2e/bridge.mjs` (full MCP chain),
`client/packages/editor/e2e/chat.mjs` (chat pipeline; server with SPINE_SERVER_CHAT_FAKE=1).

## Commands

pnpm monorepo (Node >= 22) living in `client/`. Run from `client/`:

- `pnpm install` — install all workspace dependencies
- `pnpm build` — build all packages (editor runs `tsc --noEmit && vite build`; others typecheck)
- `pnpm test` — run Vitest across all packages
- `pnpm typecheck` — `tsc --noEmit` in every package
- `pnpm lint` / `pnpm format` / `pnpm format:check` — ESLint (flat config) / Prettier
- `pnpm --filter @spine-editor/editor dev` — start the editor dev server (Vite)
- Single test file: `pnpm --filter @spine-editor/core test -- test/fixtures.test.ts`

Python backend (`server/`, requires [uv](https://docs.astral.sh/uv/)) — run from `server/`:

- `uv sync` — install deps into `.venv`
- `uv run uvicorn app.main:app --port 8100` — start the API (SQLite + secrets in `server/data/`)
- `uv run pytest` / `uv run ruff check .` / `uv run ruff format .` — tests & lint

CI (`.github/workflows/ci.yml`): Node job (lint, format:check, typecheck, test, build) +
`server` job (ruff check/format, pytest) — all must pass.

## Codegraph (code intelligence for AI agents)

The repo registers [codegraph](https://github.com/colbymchenry/codegraph) as a
project-scoped MCP server (`.mcp.json`). Prefer its `codegraph_explore` tool for
structure/flow questions ("how does X reach Y", "what calls Z") before manual
grep/read — one call returns the relevant symbols' source plus the call paths
between them. One-time setup after `cd client && pnpm install`: from the repo
root run `client/node_modules/.bin/codegraph init .` (index in `.codegraph/`,
gitignored, auto-syncs on file changes). Maintenance (same bin, from the root):
`... index . --force` rebuilds, `... unlock` clears a stale lock,
`... telemetry off` disables telemetry.

## Architecture

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

Key invariants:

- **`core` stays UI-free.** The editor UI and the MCP server are both thin clients over the same
  command API in `core`; every edit operation must be a Command so it is undoable and drivable by AI.
- **Model split in `core`:** the rig graph (bones/slots/IK/transform) is normalized with Spine
  defaults applied (`src/model/`); path/physics constraints, skins, events and animations are
  stored verbatim in typed JSON-format shapes (`src/spine-json/types.ts`) for lossless round-trips.
  The serializer omits values equal to Spine defaults — round-trip tests require canonical fixtures.
- Workspace packages are consumed as TypeScript source (`exports` point at `src/index.ts`);
  Vite/Vitest compile them on the fly — there is no per-package `dist` wiring yet.
- Target Spine JSON format is **4.2** (`SPINE_JSON_TARGET_VERSION` in `@spine-editor/shared`);
  format types live in `packages/core/src/spine-json/`.

## Conventions & constraints

- TypeScript strict mode everywhere (see `tsconfig.base.json`); ESM only (`"type": "module"`).
- **Licensing:** do NOT add official Spine Runtimes (spine-ts, pixi-spine) as dependencies — they
  require a Spine license. Preview/playback uses our own evaluator in `core`. Do NOT commit
  Esoteric Software example assets (spineboy etc.) to `examples/` — fixtures must be hand-written.
- The repo license is Apache 2.0; keep new files consistent with that.
