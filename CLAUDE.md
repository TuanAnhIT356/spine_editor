# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A web-based 2D skeletal animation editor (Spine-like UI) that exports the Spine JSON format
(target version **4.2**), with an MCP server + skills so AI agents can rig and animate.
The full roadmap, architecture rationale, and phase breakdown live in `PLAN.md` — read it before
starting work on a new phase. Current status: **Phase 0 (scaffolding) done**; next is Phase 1
(core document model + Spine JSON serializer/parser).

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
