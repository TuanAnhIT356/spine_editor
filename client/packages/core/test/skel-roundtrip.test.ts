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
