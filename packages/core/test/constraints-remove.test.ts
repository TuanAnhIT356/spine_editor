import { describe, expect, it } from 'vitest';
import {
  AddPhysicsConstraint,
  AddTransformConstraint,
  RemovePathConstraint,
  RemovePhysicsConstraint,
  RemoveTransformConstraint,
  SpineDocument,
  createBone,
  createEmptySkeleton,
  type TransformConstraintData,
} from '../src/index.js';

function tc(
  patch: Partial<TransformConstraintData> &
    Pick<TransformConstraintData, 'name' | 'bones' | 'target'>,
): TransformConstraintData {
  return {
    order: 0,
    skinRequired: false,
    rotation: 0,
    x: 0,
    y: 0,
    scaleX: 0,
    scaleY: 0,
    shearY: 0,
    mixRotate: 0,
    mixX: 0,
    mixY: 0,
    mixScaleX: 0,
    mixScaleY: 0,
    mixShearY: 0,
    relative: false,
    local: false,
    ...patch,
  };
}

function docWithBones(): SpineDocument {
  const doc = new SpineDocument(createEmptySkeleton());
  doc.data.bones.push(createBone('a', 'root'), createBone('b', 'root'));
  return doc;
}

describe('RemoveTransformConstraint', () => {
  it('removes and restores at the original index', () => {
    const doc = docWithBones();
    doc.execute(new AddTransformConstraint(tc({ name: 'tc1', bones: ['a'], target: 'b' })));
    doc.execute(new AddTransformConstraint(tc({ name: 'tc2', bones: ['a'], target: 'b' })));
    doc.execute(new AddTransformConstraint(tc({ name: 'tc3', bones: ['a'], target: 'b' })));
    doc.execute(new RemoveTransformConstraint('tc2'));
    expect(doc.data.transform.map((c) => c.name)).toEqual(['tc1', 'tc3']);
    doc.undo();
    expect(doc.data.transform.map((c) => c.name)).toEqual(['tc1', 'tc2', 'tc3']);
  });

  it('refuses when an animation timeline references it', () => {
    const doc = docWithBones();
    doc.execute(new AddTransformConstraint(tc({ name: 'tc', bones: ['a'], target: 'b' })));
    doc.data.animations['idle'] = { transform: { tc: [] } };
    expect(() => doc.execute(new RemoveTransformConstraint('tc'))).toThrow(/idle/);
    expect(doc.data.transform).toHaveLength(1);
  });

  it('throws for a missing constraint', () => {
    const doc = docWithBones();
    expect(() => doc.execute(new RemoveTransformConstraint('nope'))).toThrow(/does not exist/);
  });
});

describe('RemovePathConstraint', () => {
  it('removes, blocks on animation reference, undoes', () => {
    const doc = docWithBones();
    // AddPathConstraint requires a slot with a path attachment; the removal
    // command only needs the constraint to exist, so seed the data directly.
    doc.data.path.push({ name: 'pc', bones: ['a'], target: 'slot-x' });
    doc.data.animations['walk'] = { path: { pc: {} } };
    expect(() => doc.execute(new RemovePathConstraint('pc'))).toThrow(/walk/);
    delete doc.data.animations['walk'];
    doc.execute(new RemovePathConstraint('pc'));
    expect(doc.data.path).toHaveLength(0);
    doc.undo();
    expect(doc.data.path.map((c) => c.name)).toEqual(['pc']);
  });
});

describe('RemovePhysicsConstraint', () => {
  it('removes, blocks on animation reference, undoes', () => {
    const doc = docWithBones();
    doc.execute(new AddPhysicsConstraint({ name: 'ph', bone: 'a' }));
    doc.data.animations['sway'] = { physics: { ph: {} } };
    expect(() => doc.execute(new RemovePhysicsConstraint('ph'))).toThrow(/sway/);
    delete doc.data.animations['sway'];
    doc.execute(new RemovePhysicsConstraint('ph'));
    expect(doc.data.physics).toHaveLength(0);
    doc.undo();
    expect(doc.data.physics.map((c) => c.name)).toEqual(['ph']);
  });
});
