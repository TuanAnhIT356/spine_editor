import { describe, expect, it } from 'vitest';
import {
  applyMat,
  computeAnimatedPose,
  computePose,
  createBone,
  createEmptySkeleton,
  type IkConstraintData,
  type SkeletonData,
} from '../src/index.js';

function ik(
  patch: Partial<IkConstraintData> & Pick<IkConstraintData, 'name' | 'bones' | 'target'>,
): IkConstraintData {
  return {
    order: 0,
    skinRequired: false,
    mix: 1,
    softness: 0,
    bendPositive: true,
    compress: false,
    stretch: false,
    uniform: false,
    ...patch,
  };
}

function oneBoneRig(): SkeletonData {
  const data = createEmptySkeleton();
  data.bones.push(createBone('arm', 'root', { length: 50 }));
  data.bones.push(createBone('target', 'root', { x: 30, y: 40 }));
  data.ik.push(ik({ name: 'aim', bones: ['arm'], target: 'target' }));
  return data;
}

function twoBoneRig(bendPositive = true): SkeletonData {
  const data = createEmptySkeleton();
  data.bones.push(createBone('upper', 'root', { length: 50 }));
  data.bones.push(createBone('lower', 'upper', { x: 50, length: 50 }));
  data.bones.push(createBone('target', 'root', { x: 70, y: 0 }));
  data.ik.push(ik({ name: 'leg', bones: ['upper', 'lower'], target: 'target', bendPositive }));
  return data;
}

describe('one-bone IK', () => {
  it('aims the bone at the target', () => {
    const world = computePose(oneBoneRig());
    const tip = applyMat(world.get('arm')!, 50, 0);
    expect(tip.x).toBeCloseTo(30, 4);
    expect(tip.y).toBeCloseTo(40, 4);
  });

  it('mix 0 leaves the pose unchanged; partial mix blends', () => {
    const data = oneBoneRig();
    data.ik[0]!.mix = 0;
    let tip = applyMat(computePose(data).get('arm')!, 50, 0);
    expect(tip.x).toBeCloseTo(50);
    expect(tip.y).toBeCloseTo(0);

    data.ik[0]!.mix = 0.5;
    tip = applyMat(computePose(data).get('arm')!, 50, 0);
    // Halfway between 0° and 53.13°:
    expect(Math.atan2(tip.y, tip.x) * (180 / Math.PI)).toBeCloseTo(53.13 / 2, 1);
  });
});

describe('two-bone IK', () => {
  it('places the lower bone tip on a reachable target', () => {
    const world = computePose(twoBoneRig());
    const tip = applyMat(world.get('lower')!, 50, 0);
    expect(tip.x).toBeCloseTo(70, 3);
    expect(tip.y).toBeCloseTo(0, 3);
  });

  it('bends the elbow to the chosen side', () => {
    const up = computePose(twoBoneRig(true)).get('lower')!;
    const down = computePose(twoBoneRig(false)).get('lower')!;
    expect(up.ty).toBeGreaterThan(1); // elbow (lower origin) above the chain line
    expect(down.ty).toBeLessThan(-1);
    expect(up.ty).toBeCloseTo(-down.ty, 3);
  });

  it('clamps unreachable targets to full extension', () => {
    const data = twoBoneRig();
    const target = data.bones.find((b) => b.name === 'target')!;
    target.x = 500;
    const world = computePose(data);
    const tip = applyMat(world.get('lower')!, 50, 0);
    expect(Math.hypot(tip.x, tip.y)).toBeCloseTo(100, 0); // l1 + l2
  });
});

describe('IK timelines', () => {
  it('animates the mix from constraint pose to setup pose', () => {
    const data = oneBoneRig();
    data.animations['a'] = { ik: { aim: [{ mix: 0 }, { time: 1, mix: 1 }] } };
    const at0 = applyMat(computeAnimatedPose(data, 'a', 0).world.get('arm')!, 50, 0);
    expect(at0.y).toBeCloseTo(0, 3); // mix 0 → setup pose
    const at1 = applyMat(computeAnimatedPose(data, 'a', 1).world.get('arm')!, 50, 0);
    expect(at1.x).toBeCloseTo(30, 3);
    expect(at1.y).toBeCloseTo(40, 3);
  });
});
