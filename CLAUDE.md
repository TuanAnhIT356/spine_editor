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
PLAN.md §7 plans Phases 11–14 (not started): an opt-in Python backend in `server/`
(FastAPI; repo splits into frontend `packages/` + `server/`) — accounts (login/logout/
password reset), per-user project list, chat history, settings, BYOK AI key vault,
image-gen provider adapters, segmentation (rembg/SAM/MediaPipe) into parts, and an AI
chat that auto-rigs/animates by driving the existing bridge ops over WebSocket.
Architecture: AI ⇄ MCP (stdio, `packages/mcp-server`) ⇄ ws://localhost:8017 ⇄ editor tab
(`src/bridge/` dispatches ops through the same command API as the UI).
Verify changes end-to-end with the project verify skill (`.claude/skills/verify/SKILL.md`) —
real-Chromium scripts: `packages/editor/e2e/smoke.mjs` (setup mode), `packages/editor/e2e/anim.mjs`
(animate mode), `packages/mcp-server/e2e/bridge.mjs` (full MCP chain).

## Commands

pnpm monorepo (Node >= 22). Run from the repo root:

- `pnpm install` — install all workspace dependencies
- `pnpm build` — build all packages (editor runs `tsc --noEmit && vite build`; others typecheck)
- `pnpm test` — run Vitest across all packages
- `pnpm typecheck` — `tsc --noEmit` in every package
- `pnpm lint` / `pnpm format` / `pnpm format:check` — ESLint (flat config) / Prettier
- `pnpm --filter @spine-editor/editor dev` — start the editor dev server (Vite)
- Single test file: `pnpm --filter @spine-editor/core test -- test/fixtures.test.ts`

CI (`.github/workflows/ci.yml`) runs lint, format:check, typecheck, test, build — all must pass.

## Architecture

```
packages/
├── core/        # Framework-agnostic heart: document model, command system (undo/redo),
│                # animation evaluator, Spine JSON serializer/parser. NO UI dependencies.
├── editor/      # React + Vite app (viewport, hierarchy, inspector, timeline panels)
├── mcp-server/  # MCP server exposing editor operations to AI (Phase 5 placeholder)
└── shared/      # Constants and editor↔MCP protocol types shared by all packages
skills/          # SKILL.md files teaching AI agents rigging/animating workflows (Phase 5)
examples/        # Hand-written Spine JSON fixtures used by core round-trip tests
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
