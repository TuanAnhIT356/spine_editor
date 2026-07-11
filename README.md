# spine_editor

A web-based 2D skeletal animation editor with a Spine-like UI that exports the
[Spine JSON format](http://esotericsoftware.com/spine-json-format) (target
version **4.2**) — plus an MCP server and skills so AI agents can rig and
animate characters. Built from scratch (no Spine Runtimes dependency); Apache-2.0.

## Quick start

```bash
cd client
pnpm install
pnpm --filter @spine-editor/editor dev   # editor at http://localhost:5173
```

- **Setup mode**: create bones with the Create tool (drag on canvas), import
  images and attach them to bones, reparent via drag-drop in the hierarchy,
  adjust draw order, save/open project files (autosaves to IndexedDB).
- **Animate mode**: create animations, pose bones with Translate/Rotate
  (auto-keys at the playhead), scrub/drag keys in the dopesheet, play back,
  then **Export JSON**.

## AI integration (MCP)

The repo ships an MCP server that drives the running editor over a WebSocket
bridge — every AI edit goes through the same undoable command API as UI edits.
Register it in your MCP client (e.g. a `.mcp.json` for Claude Code):

```jsonc
{
  "mcpServers": {
    "spine-editor": {
      "command": "pnpm",
      "args": ["--dir", "client", "--filter", "@spine-editor/mcp-server", "start"],
    },
  },
}
```

Start the MCP server, open the editor tab (it auto-connects to
`ws://localhost:8017/editor`), and the agent gets 55 tools: rig building,
keyframing, `preview_at_time` + `screenshot_viewport` for visual feedback, and
validated JSON export. Workflow guides for agents live in `skills/`.

## Development

```bash
cd client
pnpm build       # typecheck + vite build
pnpm test        # vitest (core: model, commands, serializer, evaluator)
pnpm lint && pnpm format:check
```

Optional: `uv sync --extra sam-local` (in `server/`) enables the free offline
SAM 2 segmentation backend (`local`) — torch download on install, checkpoint on
first use.

AI agents get a local code knowledge graph via
[codegraph](https://github.com/colbymchenry/codegraph), registered in
`.mcp.json`. One-time setup: `cd client && pnpm install`, then from the repo
root `client/node_modules/.bin/codegraph init .` — the index (`.codegraph/`,
gitignored) auto-syncs as you code. If the pnpm-installed binary doesn't run
on your platform, install it globally (`npm i -g @colbymchenry/codegraph`) and
change `.mcp.json`'s command to `codegraph` with args `["serve", "--mcp"]`.

Architecture and roadmap: see `PLAN.md` and `CLAUDE.md`. End-to-end browser
verification scripts: `client/packages/editor/e2e/` and
`client/packages/mcp-server/e2e/`.

## License

Apache-2.0. Do not commit Esoteric Software example assets; using exported
files with the official Spine Runtimes requires a Spine license.
