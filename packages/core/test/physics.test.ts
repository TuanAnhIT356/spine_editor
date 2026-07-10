import { describe, expect, it } from 'vitest';
import { PhysicsSimulator, createBone, createEmptySkeleton } from '../src/index.js';
import type { BoneData, SkeletonData } from '../src/index.js';

function rig(gravity: number, opts: Partial<{ limit: number; wind: number }> = {}): SkeletonData {
  const data = createEmptySkeleton();
  data.bones.push(createBone('swing', 'root'));
  data.physics.push({
    name: 'ph',
    bone: 'swing',
    x: 1,
    y: 1,
    inertia: 0.5,
    strength: 50,
    damping: 0.8,
    gravity,
    wind: opts.wind ?? 0,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
  return data;
}

const boneY = (locals: BoneData[]) => locals.find((b) => b.name === 'swing')!.y;
const boneX = (locals: BoneData[]) => locals.find((b) => b.name === 'swing')!.x;

describe('PhysicsSimulator', () => {
  it('is deterministic: same time twice gives identical locals', () => {
    const sim = new PhysicsSimulator(rig(-50));
    const a = structuredClone(sim.localsAt(null, 1.0));
    const b = structuredClone(sim.localsAt(null, 1.0));
    expect(b).toEqual(a);
  });

  it('re-simulates from zero on backward scrub, matching a fresh simulator', () => {
    const sim = new PhysicsSimulator(rig(-50));
    sim.localsAt(null, 2.0);
    const rewound = structuredClone(sim.localsAt(null, 1.0));
    const fresh = new PhysicsSimulator(rig(-50));
    expect(rewound).toEqual(structuredClone(fresh.localsAt(null, 1.0)));
  });

  it('gravity displaces the bone and flipping the sign mirrors the offset', () => {
    const down = new PhysicsSimulator(rig(-80)).localsAt(null, 1.5);
    const up = new PhysicsSimulator(rig(80)).localsAt(null, 1.5);
    expect(boneY(down)).not.toBeCloseTo(0, 5);
    expect(boneY(down)).toBeCloseTo(-boneY(up), 3);
  });

  it('wind displaces along x', () => {
    const sim = new PhysicsSimulator(rig(0, { wind: 100 }));
    expect(boneX(sim.localsAt(null, 1.5))).not.toBeCloseTo(0, 5);
  });

  it('limit clamps the offset magnitude', () => {
    const clamped = new PhysicsSimulator(rig(-500, { limit: 1 }));
    const y = boneY(clamped.localsAt(null, 2.0));
    expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('keeps state per constraint (two bones do not interfere)', () => {
    const data = rig(-50);
    data.bones.push(createBone('still', 'root'));
    data.physics.push({
      name: 'ph2',
      bone: 'still',
      x: 1,
      y: 1,
      inertia: 0.5,
      strength: 50,
      damping: 0.8,
      gravity: 0,
      wind: 0,
    });
    const locals = new PhysicsSimulator(data).localsAt(null, 1.5);
    expect(boneY(locals)).not.toBeCloseTo(0, 5); // gravity-driven bone moved
    expect(locals.find((b) => b.name === 'still')!.y).toBeCloseTo(0, 5); // becalmed bone did not
  });

  it('reset clears accumulated state', () => {
    const sim = new PhysicsSimulator(rig(-50));
    sim.localsAt(null, 2.0);
    sim.reset();
    const fresh = new PhysicsSimulator(rig(-50));
    expect(structuredClone(sim.localsAt(null, 0.5))).toEqual(
      structuredClone(fresh.localsAt(null, 0.5)),
    );
  });
});
