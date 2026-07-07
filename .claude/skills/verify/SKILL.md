---
name: verify
description: Build, launch and drive the Spine editor in a real browser to verify changes end-to-end.
---

# Verifying the Spine editor

The editor's surface is a GUI (React + PixiJS canvas). Verify by driving a real
Chromium, not by unit tests.

## Recipe

```bash
pnpm --filter @spine-editor/editor build
(cd packages/editor && npx vite preview --port 4173 &)   # serve the built app
node packages/editor/e2e/smoke.mjs <outDir>              # setup mode: rig + attach + export
node packages/editor/e2e/anim.mjs <outDir>               # animate mode: keys + playback
node packages/mcp-server/e2e/bridge.mjs <outDir>         # full MCP chain (spawns MCP server itself)
```

`packages/editor/e2e/smoke.mjs` uses playwright-core with the pre-installed
Chromium (`CHROMIUM_PATH`, default `/opt/pw-browsers/chromium`). It creates
bones by mouse-dragging on the canvas, imports a generated PNG, attaches it to
a bone, translates, undoes, probes deleting the root bone (must error), dumps
exported Spine JSON + validation issues, and reloads to check IndexedDB
autosave. Screenshots + `exported.json` land in `<outDir>` — read the PNGs to
confirm rendering (grid, Spine-style bone triangles, attached sprites).

## Gotchas

- The store is exposed as `window.__spineEditor` (zustand) — use
  `page.evaluate` to read document state, validation, or exported JSON.
- Canvas interactions need real `page.mouse` events; the viewport listens for
  pointer events on the `.viewport` div.
- The viewport origin (root bone) sits at ~(width/2, height*0.75) of the
  `.viewport` element on first load.
- Autosave debounce is 800 ms — wait ≥1.2 s before reloading to test it.
- A single favicon 404 in console errors is benign.
- The MCP chain test binds port 8017. If it dies mid-run, an orphaned tsx
  process keeps the port and the next run gets EADDRINUSE + "No editor
  connected" — free it with `fuser -k 8017/tcp` first. Redirect the script's
  output to a file instead of piping to `tail` (child processes hold the pipe
  open after a timeout kill).
