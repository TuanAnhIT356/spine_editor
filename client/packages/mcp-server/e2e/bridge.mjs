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
import { URL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'e2e-out';
const BASE = process.argv[3] ?? 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const serverDir = path.resolve(fileURLToPath(import.meta.url), '../..');

// Random bridge token so ONLY this run's Chromium tab can connect — a stale
// editor tab in someone's browser would otherwise win last-writer-takeover
// and answer with old code.
const BRIDGE_TOKEN = `e2e-${Math.random().toString(36).slice(2)}`;

// 1. Spawn the MCP server over stdio.
console.error('[e2e] spawning MCP server...');
const client = new Client({ name: 'e2e', version: '0.0.1' });
await client.connect(
  new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/index.ts'],
    cwd: serverDir,
    env: { ...process.env, SPINE_BRIDGE_TOKEN: BRIDGE_TOKEN },
  }),
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
await page.addInitScript(
  (token) => window.localStorage.setItem('spine-editor.bridge-token', token),
  BRIDGE_TOKEN,
);
await page.addInitScript(() =>
  window.localStorage.setItem(
    'spine-editor.settings',
    JSON.stringify({ fps: 30, autosave: true, welcome: false }),
  ),
);
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

// Constraint removal round-trip: remove → gone from tree → undo → back.
await call('remove_ik_constraint', { name: 'arm-ik' });
const ikAfterRemove = (await call('get_skeleton_tree')).ik ?? [];
await call('undo');
const ikAfterUndo = (await call('get_skeleton_tree')).ik ?? [];

await call('set_ik_constraint', { name: 'arm-ik', mix: 0.5 });
const ikAfterSet = (await call('get_skeleton_tree')).ik ?? [];

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

// 8. Atlas export: .atlas text + packed PNG.
const atlasRes = await client.callTool({ name: 'export_atlas', arguments: {} });
const atlasText = atlasRes.content?.find((c) => c.type === 'text')?.text ?? '';
const atlasPng = atlasRes.content?.find((c) => c.type === 'image')?.data;
if (atlasPng) fs.writeFileSync(`${OUT}/skeleton-atlas.png`, Buffer.from(atlasPng, 'base64'));
fs.writeFileSync(`${OUT}/skeleton.atlas`, atlasText);

// 9. IK evaluation: a 2-bone chain must bend to reach its target in the view.
await call('new_project');
await call('add_bone', { parent: 'root', name: 'upper', length: 50 });
await call('add_bone', { parent: 'upper', name: 'lower', x: 50, length: 50 });
await call('add_bone', { parent: 'root', name: 'ik-target', x: 70, y: 0 });
await call('add_ik_constraint', { name: 'leg', bones: ['upper', 'lower'], target: 'ik-target' });
const ikShot = await call('screenshot_viewport');
fs.writeFileSync(`${OUT}/ik-bend.png`, Buffer.from(ikShot.image, 'base64'));

// 9b. Mesh + deform + color: convert to grid mesh, key a deform + tint, screenshot.
await call('import_image', { name: 'flag', dataUrl: PNG });
await call('add_bone', { parent: 'root', name: 'mast', x: -60, length: 40 });
const flagSlot = await call('attach_image', { asset: 'flag', bone: 'mast' });
const meshInfo = await call('create_mesh', {
  slot: flagSlot.slot,
  cols: 2,
  rows: 2,
  width: 60,
  height: 40,
});
await call('create_animation', { name: 'flutter' });
await call('set_deform_keyframe', {
  animation: 'flutter',
  slot: flagSlot.slot,
  attachment: 'flag',
  time: 0,
  vertices: [0, 0],
});
await call('set_deform_keyframe', {
  animation: 'flutter',
  slot: flagSlot.slot,
  attachment: 'flag',
  time: 0.5,
  vertices: [15, 10],
  offset: 0,
});
await call('set_slot_color_keyframe', {
  animation: 'flutter',
  slot: flagSlot.slot,
  time: 0.5,
  color: 'ff4444ff',
});
await call('preview_at_time', { animation: 'flutter', time: 0.25 });
const meshShot = await call('screenshot_viewport');
fs.writeFileSync(`${OUT}/mesh-deform.png`, Buffer.from(meshShot.image, 'base64'));
const meshExport = JSON.parse((await call('export_spine_json')).json);

// 9c. Weights + clipping + hit-test metadata (Phase 8 tools).
const bindRes = await call('bind_weights', { slot: flagSlot.slot, bones: ['mast', 'root'] });
const clipRes = await call('add_clipping', { slot: flagSlot.slot });
await call('add_bounding_box', { slot: flagSlot.slot, vertices: [-30, -20, 30, -20, 0, 25] });
await call('add_point', { slot: flagSlot.slot, name: 'flag-tip', x: 30, y: 20, rotation: 45 });
const phase8Export = JSON.parse((await call('export_spine_json')).json);
const flagAtts = phase8Export.skins?.[0]?.attachments?.[flagSlot.slot] ?? {};
const clipAtt = phase8Export.skins?.[0]?.attachments?.[clipRes.slot]?.clip;
const weightedFlag = flagAtts.flag?.vertices?.length !== flagAtts.flag?.uvs?.length;
const clipShot = await call('screenshot_viewport');
fs.writeFileSync(`${OUT}/clipping.png`, Buffer.from(clipShot.image, 'base64'));

// 9c2. Mesh geometry + weight tools (Phase 19).
const meshEditRes = await call('edit_mesh', {
  slot: flagSlot.slot,
  attachment: 'flag',
  action: 'add_vertex',
  x: 7,
  y: 3,
});
const pruneRes = await call('adjust_weights', {
  slot: flagSlot.slot,
  attachment: 'flag',
  action: 'prune',
  threshold: 0.01,
});
const p19Export = JSON.parse((await call('export_spine_json')).json);
const p19Flag = p19Export.skins?.[0]?.attachments?.[flagSlot.slot]?.flag;

// 9d. Path + physics + transform constraints (Phase 9 tools).
await call('add_bone', { parent: 'root', name: 'rider', length: 20 });
const pathAtt = await call('add_path', { slot: flagSlot.slot });
await call('add_path_constraint', {
  name: 'ride',
  bones: ['rider'],
  target: flagSlot.slot,
  positionMode: 'percent',
  position: 0.5,
});
await call('add_physics_constraint', { name: 'sway', bone: 'rider', rotate: 1, gravity: 2 });
await call('add_bone', { parent: 'root', name: 'copy-src', x: 40 });
await call('add_transform_constraint', {
  name: 'copycat',
  bones: ['mast'],
  target: 'copy-src',
  mixRotate: 0.5,
  mixX: 0,
  mixY: 0,
});
const treeWithConstraints = await call('get_skeleton_tree');

// 10. Events through MCP land in the export.
await call('set_event', { name: 'footstep', audio: 'step.wav' });
await call('create_animation', { name: 'walk' });
await call('set_event_keyframe', { animation: 'walk', name: 'footstep', time: 0.5, volume: 0.8 });
const exported2 = await call('export_spine_json');
const exportedEvents = JSON.parse(exported2.json);

// 10b. Audio asset + event audio (Phase 20).
function tinyWavDataUrl() {
  const rate = 8000;
  const samples = Math.floor(rate * 0.2);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 12000), 44 + i * 2);
  }
  return `data:audio/wav;base64,${buf.toString('base64')}`;
}
const audioImport = await call('import_audio', { name: 'clang-sfx', dataUrl: tinyWavDataUrl() });
await call('set_event', { name: 'clang', audio: audioImport.asset, volume: 0.9 });
await call('set_event_keyframe', { animation: 'walk', name: 'clang', time: 0.25, balance: -0.5 });
const audioState = await call('get_project_state');
const audioExport = JSON.parse((await call('export_spine_json')).json);

// 10c. Slot setup color + tint black + two-color keyframe (Phase 21).
const colorRes = await call('set_slot_color', {
  slot: flagSlot.slot,
  color: 'ff8800ff',
  dark: '332211',
});
await call('set_slot_color_keyframe', {
  animation: 'flutter',
  slot: flagSlot.slot,
  time: 0.75,
  color: '00ff00ff',
  dark: 'ffffff',
});
const p21Export = JSON.parse((await call('export_spine_json')).json);
const p21Slot = (p21Export.slots ?? []).find((sl) => sl.name === flagSlot.slot);

// 10d. PSD import (Phase 22a).
const psdB64 = fs.readFileSync(new URL('./fixtures/tiny.psd', import.meta.url)).toString('base64');
const psdRes = await call('import_psd', {
  dataUrl: `data:image/vnd.adobe.photoshop;base64,${psdB64}`,
});
const psdState = await call('get_project_state');
const psdSlotOrder = (psdState.spine.slots ?? [])
  .map((sl) => sl.name)
  .filter((n) => psdRes.slots.includes(n));

// ---- Phase 14: auto-rig from parts + preset walk
console.error('[e2e] auto-rig flow');
const PART_BOXES = [
  ['head', 0, 330, 100, 110],
  ['torso', 0, 112, 150, 240],
  ['upper_arm_l', -100, 224, 80, 40],
  ['lower_arm_l', -180, 224, 80, 40],
  ['upper_arm_r', 100, 224, 80, 40],
  ['lower_arm_r', 180, 224, 80, 40],
  ['upper_leg_l', -32, -80, 50, 160],
  ['lower_leg_l', -32, -240, 45, 160],
  ['upper_leg_r', 32, -80, 50, 160],
  ['lower_leg_r', 32, -240, 45, 160],
];
// Seed the placed-parts fixture through the page (same window.__spineEditor
// hook anim.mjs uses) — load_project is a bridge op, not an MCP tool.
await page.evaluate((boxes) => {
  const s = window.__spineEditor.getState();
  s.replaceProject(
    {
      skeleton: { spine: '4.2.43' },
      bones: [{ name: 'root' }],
      slots: boxes.map(([name]) => ({ name, bone: 'root', attachment: name })),
      skins: [
        {
          name: 'default',
          attachments: Object.fromEntries(
            boxes.map(([name, x, y, width, height]) => [name, { [name]: { x, y, width, height } }]),
          ),
        },
      ],
    },
    [],
  );
}, PART_BOXES);
const rigRes = await call('rig_from_parts', {});
const rigTree = await call('get_skeleton_tree');
const rigBoneNames = rigTree.bones.map((b) => b.name);
const presetRes = await call('apply_preset_animation', { preset: 'walk' });
const walkExport = JSON.parse((await call('export_spine_json')).json);
const walkPreview = await call('preview_at_time', { animation: 'walk', time: 0.25 });

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
      setIkWorks: ikAfterSet.some((c) => c.name === 'arm-ik' && c.mix === 0.5),
      removeConstraintWorks:
        !ikAfterRemove.some((c) => (c.name ?? c) === 'arm-ik') &&
        ikAfterUndo.some((c) => (c.name ?? c) === 'arm-ik'),
      validationIssues: validation.issues,
      badBoneError,
      animationsAfterUndo: treeAfterUndo.animations,
      atlasHasRegion: atlasText.includes('arm-img'),
      meshInfo,
      meshType: meshExport.skins?.[0]?.attachments?.[flagSlot.slot]?.flag?.type,
      deformKeys:
        meshExport.animations?.flutter?.attachments?.default?.[flagSlot.slot]?.flag?.deform?.length,
      colorKeys: meshExport.animations?.flutter?.slots?.[flagSlot.slot]?.rgba?.length,
      bindRes,
      weightedFlag,
      clipSlot: clipRes.slot,
      clipEnd: clipAtt?.end,
      pathAtt,
      pathConstraints: treeWithConstraints.path?.map((p) => p.name),
      physicsConstraints: treeWithConstraints.physics?.map((p) => p.name),
      transformConstraints: treeWithConstraints.transform?.map((t) => t.name),
      bboxVerts: flagAtts[`${flagSlot.slot}-bbox`]?.vertexCount,
      pointAtt: flagAtts['flag-tip'],
      eventDefs: exportedEvents.events,
      eventKeys: exportedEvents.animations?.walk?.events,
      meshEditWorks:
        meshEditRes.vertexCount === (flagAtts.flag?.uvs?.length ?? 0) / 2 + 1 &&
        pruneRes.weighted === true &&
        (p19Flag?.uvs?.length ?? 0) / 2 === meshEditRes.vertexCount &&
        p19Flag?.vertices?.length !== p19Flag?.uvs?.length,
      audioWorks:
        audioImport.asset === 'clang-sfx' &&
        (audioState.audioAssets ?? []).includes('clang-sfx') &&
        audioExport.events?.clang?.audio === 'clang-sfx' &&
        (audioExport.animations?.walk?.events ?? []).some(
          (k) => k.name === 'clang' && k.balance === -0.5,
        ),
      slotColorWorks:
        colorRes.color === 'ff8800ff' &&
        colorRes.dark === '332211' &&
        p21Slot?.color === 'ff8800ff' &&
        p21Slot?.dark === '332211' &&
        (p21Export.animations?.flutter?.slots?.[flagSlot.slot]?.rgba2 ?? []).some(
          (k) => k.light === '00ff00ff' && k.dark === 'ffffff',
        ),
      psdImportWorks:
        psdRes.assets.length === 2 &&
        psdRes.slots.length === 2 &&
        psdRes.width === 32 &&
        psdRes.assets.every((a) => (psdState.assets ?? []).some((x) => x.name === a)) &&
        psdSlotOrder[0]?.startsWith('bg') &&
        psdSlotOrder[1]?.startsWith('fg'),
      rigFromPartsWorks:
        rigRes.bones.includes('spine') &&
        rigBoneNames.includes('upper_leg_l') &&
        (rigTree.ik ?? []).length >= 4,
      presetWalkWorks:
        presetRes.keys > 0 &&
        Boolean(walkExport.animations?.walk?.bones?.upper_leg_l?.rotate) &&
        walkPreview.duration >= 1,
    },
    null,
    2,
  ),
);

await browser.close();
await client.close();
process.exit(0);
