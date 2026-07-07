/**
 * Full-chain smoke test: MCP client (this script) ⇄ MCP server (spawned,
 * stdio) ⇄ WebSocket bridge ⇄ editor (real Chromium on vite preview).
 *
 * Prereqs: editor built and served (vite preview --port 4173).
 * Usage: node packages/mcp-server/e2e/bridge.mjs [outDir] [baseUrl]
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'e2e-out';
const BASE = process.argv[3] ?? 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const serverDir = path.resolve(fileURLToPath(import.meta.url), '../..');

// 1. Spawn the MCP server over stdio.
console.error('[e2e] spawning MCP server...');
const client = new Client({ name: 'e2e', version: '0.0.1' });
await client.connect(
  new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/index.ts'], cwd: serverDir }),
);
console.error('[e2e] connected, listing tools');
const toolNames = (await client.listTools()).tools.map((t) => t.name);

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const first = res.content?.[0];
  if (res.isError) throw new Error(`${name}: ${first?.text ?? 'unknown error'}`);
  if (first?.type === 'image') return { image: first.data };
  return first?.type === 'text' ? JSON.parse(first.text) : null;
}

// 2. Tool call without an editor must fail with a helpful message.
let noEditorError = null;
try {
  await call('get_skeleton_tree');
} catch (err) {
  noEditorError = String(err.message).slice(0, 80);
}

// 3. Open the editor; it auto-connects to the bridge.
console.error('[e2e] launching chromium');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
await page.goto(BASE);
await page.waitForTimeout(2500);

// 4. Drive a full rig + animation through MCP tools only.
console.error('[e2e] driving tools');
await call('new_project');
await call('add_bone', { parent: 'root', name: 'hip', y: 60 });
await call('add_bone', { parent: 'hip', name: 'torso', rotation: 90, length: 80 });
await call('add_bone', { parent: 'torso', name: 'arm', x: 80, rotation: -70, length: 60 });

// tiny orange PNG as the image asset
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNsaGj4DwAFhAJ/2yqf1AAAAABJRU5ErkJggg==';
await call('import_image', { name: 'arm-img', dataUrl: PNG });
const attached = await call('attach_image', { asset: 'arm-img', bone: 'arm' });

await call('add_ik_constraint', { name: 'arm-ik', bones: ['arm'], target: 'hip' });

await call('create_animation', { name: 'wave' });
await call('set_bone_keyframe', {
  animation: 'wave',
  bone: 'arm',
  timeline: 'rotate',
  time: 0,
  value: 0,
});
await call('set_bone_keyframe', {
  animation: 'wave',
  bone: 'arm',
  timeline: 'rotate',
  time: 0.5,
  value: 60,
  curve: [0.125, 0, 0.375, 60],
});
await call('set_bone_keyframe', {
  animation: 'wave',
  bone: 'arm',
  timeline: 'rotate',
  time: 1,
  value: 0,
});
await call('set_bone_keyframe', {
  animation: 'wave',
  bone: 'hip',
  timeline: 'translate',
  time: 0.5,
  x: 0,
  y: 12,
});

// 5. Visual feedback loop: pose at t=0 and t=0.5, screenshot both.
await call('preview_at_time', { animation: 'wave', time: 0 });
const shot0 = await call('screenshot_viewport');
fs.writeFileSync(`${OUT}/pose-t0.png`, Buffer.from(shot0.image, 'base64'));
const preview = await call('preview_at_time', { animation: 'wave', time: 0.5 });
const shot5 = await call('screenshot_viewport');
fs.writeFileSync(`${OUT}/pose-t05.png`, Buffer.from(shot5.image, 'base64'));

// 6. Validate + export.
const tree = await call('get_skeleton_tree');
const validation = await call('validate_project');
const exported = await call('export_spine_json');
fs.writeFileSync(`${OUT}/exported.json`, exported.json);

// 7. Probes: bad input must fail cleanly, undo must work over the bridge.
let badBoneError = null;
try {
  await call('add_bone', { parent: 'does-not-exist' });
} catch (err) {
  badBoneError = String(err.message).slice(0, 60);
}
await call('undo'); // undoes the last keyframe
const treeAfterUndo = await call('get_skeleton_tree');

console.log(
  JSON.stringify(
    {
      toolCount: toolNames.length,
      toolNames,
      noEditorError,
      attached,
      previewDuration: preview.duration,
      bones: tree.bones.map((b) => b.name),
      ik: tree.ik,
      validationIssues: validation.issues,
      badBoneError,
      animationsAfterUndo: treeAfterUndo.animations,
    },
    null,
    2,
  ),
);

await browser.close();
await client.close();
process.exit(0);
