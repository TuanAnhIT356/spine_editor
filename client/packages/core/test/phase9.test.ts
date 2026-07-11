import { describe, expect, it } from 'vitest';
import {
  PathSpline,
  PhysicsSimulator,
  computePose,
  computeSetupPose,
  createBone,
  createEmptySkeleton,
  createSlot,
  worldRotationOf,
  type SkeletonData,
} from '../src/index.js';

// ---------------------------------------------------------------- inherit

describe('bone inherit modes', () => {
  // Uniform parent scale: with non-uniform scale the runtime's z-axis
  // construction bends directions, so angle checks would not be exact.
  function rig(inherit: SkeletonData['bones'][number]['inherit']): SkeletonData {
    const data = createEmptySkeleton();
    data.bones.push(
      createBone('parent', 'root', { rotation: 90, scaleX: 2, scaleY: 2, x: 10, y: 20 }),
    );
    data.bones.push(createBone('child', 'parent', { x: 5, y: 0, rotation: 15, inherit }));
    return data;
  }

  it('noScale keeps the parent rotation but drops its scale', () => {
    const pose = computeSetupPose(rig('noScale'));
    const m = pose.get('child')!;
    expect(worldRotationOf(m)).toBeCloseTo(105, 3); // 90 (parent) + 15 (child)
    expect(Math.hypot(m.a, m.c)).toBeCloseTo(1, 4); // unit world scale
    expect(Math.hypot(m.b, m.d)).toBeCloseTo(1, 4);
    // Translation still uses the parent's full (scaled) transform:
    // child at (5,0) in parent space → world (10 + 0, 20 + 2*5).
    expect(m.tx).toBeCloseTo(10, 3);
    expect(m.ty).toBeCloseTo(30, 3);
  });

  it('noScale keeps a parent reflection while noScaleOrReflection drops it', () => {
    const make = (inherit: SkeletonData['bones'][number]['inherit']) => {
      const data = createEmptySkeleton();
      data.bones.push(createBone('parent', 'root', { scaleX: -1 }));
      data.bones.push(createBone('child', 'parent', { inherit }));
      return computeSetupPose(data).get('child')!;
    };
    const det = (m: { a: number; b: number; c: number; d: number }) => m.a * m.d - m.b * m.c;
    expect(det(make('noScale'))).toBeLessThan(0); // reflection preserved
    expect(det(make('noScaleOrReflection'))).toBeGreaterThan(0); // reflection removed
  });

  it('noRotationOrReflection drops the parent rotation but keeps its scale', () => {
    const pose = computeSetupPose(rig('noRotationOrReflection'));
    const m = pose.get('child')!;
    // Orientation comes from the child alone; parent 90° must not show up.
    expect(worldRotationOf(m)).toBeCloseTo(15, 1);
    // Parent scale magnitude survives (area factor 2*2 = 4).
    expect(Math.abs(m.a * m.d - m.b * m.c)).toBeCloseTo(4, 1);
  });
});

// ---------------------------------------------------------------- IK extras

describe('IK compress/stretch/softness', () => {
  it('1-bone stretch/compress scales the bone to reach the target', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('arm', 'root', { length: 100 }));
    data.bones.push(createBone('goal', 'root', { x: 150 }));
    data.ik.push({
      name: 'ik',
      order: 0,
      skinRequired: false,
      bones: ['arm'],
      target: 'goal',
      mix: 1,
      softness: 0,
      bendPositive: true,
      compress: false,
      stretch: true,
      uniform: true,
    });
    let pose = computePose(data);
    let m = pose.get('arm')!;
    expect(Math.hypot(m.a, m.c)).toBeCloseTo(1.5, 3); // stretched to 150/100
    expect(Math.hypot(m.b, m.d)).toBeCloseTo(1.5, 3); // uniform also scales Y

    // Compress: target inside the bone length.
    data.bones[2]!.x = 50;
    data.ik[0]!.stretch = false;
    data.ik[0]!.compress = true;
    data.ik[0]!.uniform = false;
    pose = computePose(data);
    m = pose.get('arm')!;
    expect(Math.hypot(m.a, m.c)).toBeCloseTo(0.5, 3);
    expect(Math.hypot(m.b, m.d)).toBeCloseTo(1, 3); // non-uniform leaves Y alone
  });

  it('2-bone softness eases the chain before full extension', () => {
    const make = (softness: number) => {
      const data = createEmptySkeleton();
      data.bones.push(createBone('upper', 'root', { length: 100 }));
      data.bones.push(createBone('lower', 'upper', { x: 100, length: 100 }));
      data.bones.push(createBone('goal', 'root', { x: 195, y: 0 }));
      data.ik.push({
        name: 'ik',
        order: 0,
        skinRequired: false,
        bones: ['upper', 'lower'],
        target: 'goal',
        mix: 1,
        softness,
        bendPositive: true,
        compress: false,
        stretch: false,
        uniform: false,
      });
      const pose = computePose(data);
      const tip = pose.get('lower')!;
      // Tip position = lower origin + length along lower's X.
      return { x: tip.a * 100 + tip.tx, y: tip.c * 100 + tip.ty };
    };
    const hard = make(0);
    const soft = make(30);
    // Without softness the chain reaches ~195; with softness it stays shorter.
    expect(Math.hypot(hard.x, hard.y)).toBeGreaterThan(194);
    expect(Math.hypot(soft.x, soft.y)).toBeLessThan(Math.hypot(hard.x, hard.y) - 1);
  });

  it('2-bone stretch scales the chain past full extension', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('upper', 'root', { length: 100 }));
    data.bones.push(createBone('lower', 'upper', { x: 100, length: 100 }));
    data.bones.push(createBone('goal', 'root', { x: 300, y: 0 }));
    data.ik.push({
      name: 'ik',
      order: 0,
      skinRequired: false,
      bones: ['upper', 'lower'],
      target: 'goal',
      mix: 1,
      softness: 0,
      bendPositive: true,
      compress: false,
      stretch: true,
      uniform: false,
    });
    const pose = computePose(data);
    const tip = pose.get('lower')!;
    const tipX = tip.a * 100 + tip.tx;
    expect(tipX).toBeGreaterThan(285); // ~300 with the stretch applied
  });
});

// ---------------------------------------------------------------- path

/** Straight horizontal path from (0,0) to (300,0) on the root bone. */
function pathRig(): SkeletonData {
  const data = createEmptySkeleton();
  data.bones.push(createBone('b1', 'root', { length: 10 }));
  data.bones.push(createBone('b2', 'root', { x: 999, length: 10 }));
  data.slots.push(createSlot('track', 'root'));
  data.skins[0]!.attachments = {
    track: {
      spline: {
        type: 'path',
        vertexCount: 6, // 2 points × (in, anchor, out)
        vertices: [-100, 0, 0, 0, 100, 0, 200, 0, 300, 0, 400, 0],
        lengths: [300],
      },
    },
  };
  const slot = data.slots.find((s) => s.name === 'track')!;
  slot.attachment = 'spline';
  return data;
}

describe('PathSpline', () => {
  it('measures a straight line exactly and samples midpoints', () => {
    const spline = new PathSpline([-100, 0, 0, 0, 100, 0, 200, 0, 300, 0, 400, 0], false);
    expect(spline.length).toBeCloseTo(300, 1);
    const mid = spline.at(150, false);
    expect(mid.x).toBeCloseTo(150, 1);
    expect(mid.y).toBeCloseTo(0, 4);
    expect(mid.tangent).toBeCloseTo(0, 3);
  });
});

describe('path constraint evaluation', () => {
  it('pins a bone at position (percent mode) with tangent rotation', () => {
    const data = pathRig();
    data.path.push({
      name: 'pc',
      order: 0,
      bones: ['b1'],
      target: 'track',
      positionMode: 'percent',
      position: 0.5,
      mixRotate: 1,
      mixX: 1,
      mixY: 1,
    });
    const pose = computeSetupPose(data);
    const m = pose.get('b1')!;
    expect(m.tx).toBeCloseTo(150, 1);
    expect(m.ty).toBeCloseTo(0, 3);
    expect(worldRotationOf(m)).toBeCloseTo(0, 2);
  });

  it('spaces chained bones along the path (fixed spacing)', () => {
    const data = pathRig();
    data.path.push({
      name: 'pc',
      order: 0,
      bones: ['b1', 'b2'],
      target: 'track',
      positionMode: 'fixed',
      spacingMode: 'fixed',
      position: 60,
      spacing: 90,
      mixRotate: 1,
      mixX: 1,
      mixY: 1,
    });
    const pose = computeSetupPose(data);
    expect(pose.get('b1')!.tx).toBeCloseTo(60, 1);
    expect(pose.get('b2')!.tx).toBeCloseTo(150, 1);
  });

  it('honors mixX blending halfway', () => {
    const data = pathRig();
    data.path.push({
      name: 'pc',
      order: 0,
      bones: ['b1'],
      target: 'track',
      positionMode: 'fixed',
      position: 100,
      mixRotate: 0,
      mixX: 0.5,
      mixY: 0.5,
    });
    const pose = computeSetupPose(data);
    // Bone starts at (0,0); halfway toward (100,0) is (50,0).
    expect(pose.get('b1')!.tx).toBeCloseTo(50, 1);
  });
});

// ---------------------------------------------------------------- physics

function physicsRig(): SkeletonData {
  const data = createEmptySkeleton();
  data.bones.push(createBone('tail', 'root', { x: 0, y: 100, length: 50 }));
  data.physics.push({
    name: 'phys',
    bone: 'tail',
    x: 1,
    y: 1,
    inertia: 0.5,
    strength: 50,
    damping: 0.8,
    gravity: 2,
    mix: 1,
  });
  return data;
}

describe('PhysicsSimulator', () => {
  it('sags under gravity over time', () => {
    const sim = new PhysicsSimulator(physicsRig());
    const at0 = sim.localsAt(null, 0).find((b) => b.name === 'tail')!;
    const at1 = sim.localsAt(null, 1).find((b) => b.name === 'tail')!;
    expect(at0.y).toBeCloseTo(100, 3); // no time elapsed, no offset yet
    expect(at1.y).toBeLessThan(100 - 0.5); // gravity pulled the bone down
  });

  it('is deterministic and re-simulates when scrubbing backward', () => {
    const rig = physicsRig();
    const a = new PhysicsSimulator(rig);
    const b = new PhysicsSimulator(rig);
    const forward = a.localsAt(null, 0.75).find((x) => x.name === 'tail')!;
    // b jumps past, then scrubs back — must match a fresh simulation.
    b.localsAt(null, 1.5);
    const scrubbed = b.localsAt(null, 0.75).find((x) => x.name === 'tail')!;
    expect(scrubbed.y).toBeCloseTo(forward.y, 6);
    expect(scrubbed.x).toBeCloseTo(forward.x, 6);
    // And calling the same time twice returns the same pose.
    const again = a.localsAt(null, 0.75).find((x) => x.name === 'tail')!;
    expect(again.y).toBeCloseTo(forward.y, 6);
  });

  it('damping keeps offsets bounded', () => {
    const sim = new PhysicsSimulator(physicsRig());
    const late = sim.localsAt(null, 10).find((b) => b.name === 'tail')!;
    expect(Math.abs(late.y - 100)).toBeLessThan(60); // settled, not exploding
    expect(Number.isFinite(late.y)).toBe(true);
  });
});
