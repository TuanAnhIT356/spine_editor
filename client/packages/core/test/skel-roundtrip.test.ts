import { describe, expect, it } from 'vitest';
import {
  createBone,
  createEmptySkeleton,
  createSlot,
  readSkel,
  serializeSpineJson,
  writeSkel,
  type SkeletonData,
} from '../src/index.js';

/**
 * Normalizes for comparison: float32 rounding (binary precision) and sorted
 * object keys (JSON key order is not semantic; the reader rebuilds objects
 * in wire order which can differ from the fixture's literal order).
 */
function normalize(json: unknown): unknown {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sortKeys((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return typeof v === 'number' ? Math.fround(v) : v;
  };
  return sortKeys(JSON.parse(JSON.stringify(json)));
}

export function expectRoundTrip(data: SkeletonData): SkeletonData {
  const bytes = writeSkel(data);
  const result = readSkel(bytes);
  expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(JSON.stringify(normalize(serializeSpineJson(result.data)), null, 1)).toBe(
    JSON.stringify(normalize(serializeSpineJson(data)), null, 1),
  );
  return result.data;
}

describe('skel round-trip: skeleton structure', () => {
  it('minimal skeleton', () => {
    expectRoundTrip(createEmptySkeleton());
  });

  it('bones with all inherit modes and colors + slots with color/dark/blend', () => {
    const data = createEmptySkeleton();
    const modes = [
      'normal',
      'onlyTranslation',
      'noRotationOrReflection',
      'noScale',
      'noScaleOrReflection',
    ] as const;
    modes.forEach((inherit, i) => {
      const b = createBone(`b${i}`, 'root', { x: i * 10, rotation: i * 5, length: 20 + i });
      b.inherit = inherit;
      if (i === 2) b.color = 'ff00ff88';
      data.bones.push(b);
    });
    const s = createSlot('s1', 'b0', { attachment: 'img' });
    s.color = 'ff8800cc';
    s.dark = '332211';
    s.blend = 'additive';
    data.slots.push(s);
    data.slots.push(createSlot('s2', 'b1'));
    expectRoundTrip(data);
  });

  it('all four constraint types with full fields', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root', { length: 30 }));
    data.bones.push(createBone('t', 'root', { x: 50 }));
    data.slots.push(createSlot('ps', 'a'));
    data.ik.push({
      name: 'ik1',
      order: 1,
      skinRequired: false,
      bones: ['a'],
      target: 't',
      mix: 0.75,
      softness: 5,
      bendPositive: false,
      compress: true,
      stretch: true,
      uniform: false,
    });
    data.transform.push({
      name: 'tc1',
      order: 2,
      skinRequired: false,
      bones: ['a'],
      target: 't',
      rotation: 10,
      x: 1,
      y: 2,
      scaleX: 0.125,
      scaleY: 0.25,
      shearY: 3,
      mixRotate: 0.5,
      mixX: 0.5,
      mixY: 0.75,
      mixScaleX: 0.875,
      mixScaleY: 0.875,
      mixShearY: 0.25,
      relative: true,
      local: true,
    });
    data.path.push({
      name: 'pc1',
      order: 3,
      bones: ['a'],
      target: 'ps',
      positionMode: 'fixed',
      spacingMode: 'proportional',
      rotateMode: 'chainScale',
      rotation: 15,
      position: 0.25,
      spacing: 2,
      mixRotate: 0.125,
      mixX: 0.25,
      mixY: 0.375,
    });
    data.physics.push({
      name: 'ph1',
      order: 4,
      bone: 'a',
      x: 1,
      rotate: 0.5,
      inertia: 0.625,
      strength: 55,
      damping: 0.875,
      mass: 2,
      wind: 1,
      gravity: 30,
      mix: 0.75,
      inertiaGlobal: true,
      limit: 100,
    });
    expectRoundTrip(data);
  });

  it('event definitions with audio payload', () => {
    const data = createEmptySkeleton();
    data.events['step'] = {
      int: 3,
      float: 1.5,
      string: 'chân',
      audio: 'step.wav',
      volume: 0.75,
      balance: -0.5,
    };
    data.events['plain'] = {};
    expectRoundTrip(data);
  });
});

describe('skel errors', () => {
  it('reports truncated data as an error issue (no throw)', () => {
    const bytes = writeSkel(createEmptySkeleton());
    const result = readSkel(bytes.slice(0, 10));
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('rejects non-4.2 versions', async () => {
    const { DataWriter } = await import('../src/spine-binary/binary-io.js');
    const w = new DataWriter();
    w.utf8String(null); // hash
    w.utf8String('3.8.99');
    const result = readSkel(w.bytes());
    expect(result.issues.some((i) => i.severity === 'error' && /version/i.test(i.message))).toBe(
      true,
    );
  });
});

describe('skel round-trip: skins + attachments', () => {
  it('all attachment types incl. weighted mesh and sequence', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('b', 'root', { length: 40 }));
    data.slots.push(createSlot('s', 'b', { attachment: 'img' }));
    data.skins[0]!.attachments = {
      s: {
        img: {
          type: 'region',
          path: 'img/tex',
          rotation: 15,
          x: 1,
          y: 2,
          scaleX: 2,
          scaleY: 0.5,
          width: 64,
          height: 32,
          color: 'ff0000ff',
        },
        seq: {
          type: 'region',
          width: 10,
          height: 10,
          sequence: { count: 4, start: 2, digits: 3, setup: 1 },
        },
        box: {
          type: 'boundingbox',
          vertexCount: 3,
          vertices: [0, 0, 10, 0, 0, 10],
          color: 'aabbccdd',
        },
        m: {
          type: 'mesh',
          uvs: [0, 0, 1, 0, 0, 1],
          triangles: [0, 1, 2],
          vertices: [1, 0, -5, -5, 1, 1, 0, 15, -5, 1, 1, 0, -5, 15, 1],
          hull: 3,
          edges: [0, 2, 2, 4],
          width: 30,
          height: 30,
        },
        pth: {
          type: 'path',
          closed: true,
          constantSpeed: false,
          vertexCount: 6,
          vertices: [0, 0, 5, 0, 10, 0, 10, 5, 10, 10, 5, 10],
          lengths: [12, 24],
        },
        pt: { type: 'point', x: 3, y: 4, rotation: 45 },
        clip: { type: 'clipping', end: 's', vertexCount: 3, vertices: [0, 0, 5, 0, 0, 5] },
      },
    };
    data.skins.push({
      name: 'alt',
      attachments: { s: { img: { type: 'region', width: 8, height: 8 } } },
    });
    expectRoundTrip(data);
  });
});

describe('skel round-trip: animations', () => {
  it('every timeline type with linear/stepped/bezier curves', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('b', 'root', { length: 30 }));
    data.bones.push(createBone('t', 'root', { x: 40 }));
    data.slots.push(createSlot('s', 'b', { attachment: 'img' }));
    data.skins[0]!.attachments = {
      s: {
        img: {
          type: 'mesh',
          uvs: [0, 0, 1, 0, 0, 1],
          triangles: [0, 1, 2],
          vertices: [0, 0, 10, 0, 0, 10],
          hull: 3,
          width: 10,
          height: 10,
        },
      },
    };
    data.events['beep'] = { audio: 'beep.wav' };
    data.ik.push({
      name: 'ik',
      order: 0,
      skinRequired: false,
      bones: ['b'],
      target: 't',
      mix: 1,
      softness: 0,
      bendPositive: true,
      compress: false,
      stretch: false,
      uniform: false,
    });
    data.transform.push({
      name: 'tc',
      order: 1,
      skinRequired: false,
      bones: ['b'],
      target: 't',
      rotation: 0,
      x: 0,
      y: 0,
      scaleX: 0,
      scaleY: 0,
      shearY: 0,
      mixRotate: 1,
      mixX: 1,
      mixY: 1,
      mixScaleX: 1,
      mixScaleY: 1,
      mixShearY: 1,
      relative: false,
      local: false,
    });
    data.path.push({ name: 'pc', bones: ['b'], target: 's' });
    data.physics.push({ name: 'ph', bone: 'b' });
    // Canonical keys: values equal to timeline defaults are omitted (binary
    // cannot distinguish "absent" from "explicit default" — same canonical
    // requirement as the JSON round-trip fixtures).
    data.animations['everything'] = {
      bones: {
        b: {
          rotate: [{}, { time: 0.5, value: 90, curve: 'stepped' }, { time: 1 }],
          translate: [
            { curve: [0.125, 0, 0.375, 5, 0.125, 0, 0.375, 10] },
            { time: 0.5, x: 5, y: 10 },
          ],
          scalex: [{}, { time: 1, value: 2 }],
          sheary: [{}, { time: 1, value: 15 }],
        },
      },
      slots: {
        s: {
          attachment: [{ name: 'img' }, { time: 0.5, name: null }],
          rgba: [
            { color: 'ffffffff', curve: 'stepped' },
            { time: 1, color: 'ff0000cc' },
          ],
          alpha: [{}, { time: 1, value: 0.5 }],
          rgba2: [
            { light: 'ffffffff', dark: '000000' },
            { time: 1, light: 'ff0000ff', dark: '333333' },
          ],
        },
      },
      ik: { ik: [{}, { time: 1, mix: 0.5, bendPositive: false }] },
      transform: { tc: [{}, { time: 1, mixRotate: 0.5, mixX: 0.25, mixY: 0.75 }] },
      path: { pc: { position: [{}, { time: 1, value: 0.5 }], mix: [{}] } },
      physics: { ph: { inertia: [{}, { time: 1, value: 0.5 }], reset: [{ time: 0.25 }] } },
      attachments: {
        default: { s: { img: { deform: [{ offset: 2, vertices: [3, 4] }, { time: 1 }] } } },
      },
      drawOrder: [{ offsets: [{ slot: 's', offset: 0 }] }, { time: 1 }],
      events: [{ name: 'beep', time: 0.5, volume: 0.5, balance: 0.25, int: 7, string: 'hi' }],
    };
    expectRoundTrip(data);
  });

  it('round-trips the example fixtures (idempotent after canonicalization)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { parseSpineJson } = await import('../src/index.js');
    const dir = join(import.meta.dirname, '../../../examples/fixtures');
    for (const f of ['simple-skeleton.json', 'full-featured.json']) {
      const { data } = parseSpineJson(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      // Hand-written fixtures may carry explicit default values the binary
      // form cannot distinguish from absent ones; the first pass canonicalizes,
      // the second must be a perfect identity.
      const pass1 = readSkel(writeSkel(data));
      expect(pass1.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(pass1.data.bones.map((b) => b.name)).toEqual(data.bones.map((b) => b.name));
      expect(pass1.data.slots.map((s) => s.name)).toEqual(data.slots.map((s) => s.name));
      expect(Object.keys(pass1.data.animations)).toEqual(Object.keys(data.animations));
      expectRoundTrip(pass1.data);
    }
  });
});
