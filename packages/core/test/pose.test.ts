import { describe, expect, it } from 'vitest';
import {
  applyMat,
  boneLocalMatrix,
  computeSetupPose,
  createBone,
  createEmptySkeleton,
  invertMat,
  mulMat,
} from '../src/index.js';

function near(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

describe('computeSetupPose', () => {
  it('places a child at its parent-rotated position', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('parent', 'root', { rotation: 90 }));
    data.bones.push(createBone('child', 'parent', { x: 10 }));
    const pose = computeSetupPose(data);
    const child = pose.get('child')!;
    near({ x: child.tx, y: child.ty }, { x: 0, y: 10 });
  });

  it('accumulates translation and scale down the chain', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root', { x: 5, y: 5, scaleX: 2 }));
    data.bones.push(createBone('b', 'a', { x: 10 }));
    const pose = computeSetupPose(data);
    const b = pose.get('b')!;
    near({ x: b.tx, y: b.ty }, { x: 25, y: 5 });
  });

  it('onlyTranslation ignores parent rotation for the child axes', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('parent', 'root', { rotation: 90 }));
    data.bones.push(createBone('child', 'parent', { x: 10, inherit: 'onlyTranslation' }));
    const pose = computeSetupPose(data);
    const child = pose.get('child')!;
    near({ x: child.tx, y: child.ty }, { x: 0, y: 10 });
    // Child x-axis stays unrotated:
    near(applyMat({ ...child, tx: 0, ty: 0 }, 1, 0), { x: 1, y: 0 });
  });
});

describe('matrix helpers', () => {
  it('invertMat inverts mulMat', () => {
    const m = boneLocalMatrix({
      x: 3,
      y: -2,
      rotation: 37,
      scaleX: 1.5,
      scaleY: 0.5,
      shearX: 5,
      shearY: 0,
    });
    const inv = invertMat(m);
    const p = applyMat(mulMat(m, inv), 7, 11);
    near(p, { x: 7, y: 11 });
  });
});
