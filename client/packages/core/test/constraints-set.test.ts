import { describe, expect, it } from 'vitest';
import {
  AddIkConstraint,
  SetBoneColor,
  SetIkConstraintProperties,
  SetPathConstraintProperties,
  SetPhysicsConstraintProperties,
  SetTransformConstraintProperties,
  SpineDocument,
  createBone,
  createEmptySkeleton,
  createSlot,
} from '../src/index.js';

function docWithBones(): SpineDocument {
  const doc = new SpineDocument(createEmptySkeleton());
  doc.data.bones.push(createBone('a', 'root'), createBone('b', 'root'), createBone('t', 'root'));
  doc.data.slots.push(createSlot('s', 'a'));
  return doc;
}

describe('constraint property patches', () => {
  it('patches IK fields, undoes, and validates targets', () => {
    const doc = docWithBones();
    doc.execute(
      new AddIkConstraint({
        name: 'ik1',
        order: 0,
        skinRequired: false,
        bones: ['a'],
        target: 't',
        mix: 1,
        softness: 0,
        bendPositive: true,
        compress: false,
        stretch: false,
        uniform: false,
      }),
    );
    doc.execute(new SetIkConstraintProperties('ik1', { mix: 0.5, stretch: true }));
    expect(doc.data.ik[0]!.mix).toBe(0.5);
    expect(doc.data.ik[0]!.stretch).toBe(true);
    doc.undo();
    expect(doc.data.ik[0]!.mix).toBe(1);
    expect(doc.data.ik[0]!.stretch).toBe(false);
    expect(() => doc.execute(new SetIkConstraintProperties('ik1', { target: 'nope' }))).toThrow(
      /does not exist/,
    );
    expect(() => doc.execute(new SetIkConstraintProperties('missing', { mix: 0 }))).toThrow(
      /does not exist/,
    );
  });

  it('patches transform mixes with bone validation', () => {
    const doc = docWithBones();
    doc.data.transform.push({
      name: 'tc',
      order: 0,
      skinRequired: false,
      bones: ['a'],
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
      local: false,
      relative: false,
    });
    doc.execute(new SetTransformConstraintProperties('tc', { mixRotate: 0.25, x: 10 }));
    expect(doc.data.transform[0]!.mixRotate).toBe(0.25);
    expect(doc.data.transform[0]!.x).toBe(10);
    doc.undo();
    expect(doc.data.transform[0]!.mixRotate).toBe(1);
    expect(() =>
      doc.execute(new SetTransformConstraintProperties('tc', { target: 'nope' })),
    ).toThrow(/does not exist/);
  });

  it('patches path constraint (verbatim shape) and validates slot target', () => {
    const doc = docWithBones();
    doc.data.path.push({ name: 'pc', bones: ['a'], target: 's' });
    doc.execute(new SetPathConstraintProperties('pc', { position: 0.5, rotateMode: 'chain' }));
    expect(doc.data.path[0]!.position).toBe(0.5);
    expect(doc.data.path[0]!.rotateMode).toBe('chain');
    doc.undo();
    expect(doc.data.path[0]!.position).toBeUndefined();
    expect(() => doc.execute(new SetPathConstraintProperties('pc', { target: 'no-slot' }))).toThrow(
      /does not exist/,
    );
  });

  it('patches physics constraint fields', () => {
    const doc = docWithBones();
    doc.data.physics.push({ name: 'ph', bone: 'a', rotate: 1 });
    doc.execute(new SetPhysicsConstraintProperties('ph', { gravity: 5, damping: 0.8 }));
    expect(doc.data.physics[0]!.gravity).toBe(5);
    doc.undo();
    expect(doc.data.physics[0]!.gravity).toBeUndefined();
    expect(() => doc.execute(new SetPhysicsConstraintProperties('ph', { bone: 'nope' }))).toThrow(
      /does not exist/,
    );
  });

  it('sets and clears bone color with validation', () => {
    const doc = docWithBones();
    doc.execute(new SetBoneColor('a', 'ff8800ff'));
    expect(doc.data.bones.find((b) => b.name === 'a')!.color).toBe('ff8800ff');
    doc.undo();
    expect(doc.data.bones.find((b) => b.name === 'a')!.color).toBeUndefined();
    expect(() => doc.execute(new SetBoneColor('a', 'xyz'))).toThrow(/RGBA/);
  });
});
