import { describe, expect, it } from 'vitest';
import {
  AddBone,
  AddSlot,
  CreateAnimation,
  DeleteBoneKeyframe,
  RemoveBone,
  RenameBone,
  SetBoneTransform,
  SpineDocument,
  UpsertBoneKeyframe,
  createBone,
  createSlot,
} from '../src/index.js';

function docWithHip(): SpineDocument {
  const doc = new SpineDocument();
  doc.execute(new AddBone(createBone('hip', 'root', { y: 100 })));
  return doc;
}

describe('bone commands', () => {
  it('adds a bone with undo/redo', () => {
    const doc = docWithHip();
    expect(doc.findBone('hip')?.y).toBe(100);
    expect(doc.undo()).toBe(true);
    expect(doc.findBone('hip')).toBeUndefined();
    expect(doc.redo()).toBe(true);
    expect(doc.findBone('hip')?.y).toBe(100);
  });

  it('rejects duplicate names and missing parents', () => {
    const doc = docWithHip();
    expect(() => doc.execute(new AddBone(createBone('hip', 'root')))).toThrow(/already exists/);
    expect(() => doc.execute(new AddBone(createBone('x', 'nope')))).toThrow(/does not exist/);
    expect(() => doc.execute(new AddBone(createBone('x', null)))).toThrow(/first bone/);
  });

  it('refuses to remove a referenced bone', () => {
    const doc = docWithHip();
    doc.execute(new AddSlot(createSlot('body', 'hip')));
    expect(() => doc.execute(new RemoveBone('hip'))).toThrow(/referenced by slot "body"/);
    expect(() => doc.execute(new RemoveBone('root'))).toThrow(/child bone "hip"/);
  });

  it('renames a bone and cascades to slots and animations, undoably', () => {
    const doc = docWithHip();
    doc.execute(new AddSlot(createSlot('body', 'hip')));
    doc.execute(new CreateAnimation('walk'));
    doc.execute(new UpsertBoneKeyframe('walk', 'hip', 'rotate', { value: 10 }));

    doc.execute(new RenameBone('hip', 'pelvis'));
    expect(doc.findBone('pelvis')).toBeDefined();
    expect(doc.findSlot('body')?.bone).toBe('pelvis');
    expect(doc.getAnimation('walk')?.bones).toHaveProperty('pelvis');
    expect(doc.getAnimation('walk')?.bones).not.toHaveProperty('hip');
    expect(doc.validate()).toEqual([]);

    doc.undo();
    expect(doc.findBone('hip')).toBeDefined();
    expect(doc.findSlot('body')?.bone).toBe('hip');
    expect(doc.getAnimation('walk')?.bones).toHaveProperty('hip');
  });

  it('patches bone transforms with undo restoring previous values', () => {
    const doc = docWithHip();
    doc.execute(new SetBoneTransform('hip', { x: 5, rotation: 45 }));
    expect(doc.findBone('hip')).toMatchObject({ x: 5, y: 100, rotation: 45 });
    doc.undo();
    expect(doc.findBone('hip')).toMatchObject({ x: 0, y: 100, rotation: 0 });
  });
});

describe('animation keyframe commands', () => {
  it('inserts keyframes sorted by time and replaces same-time keys', () => {
    const doc = docWithHip();
    doc.execute(new CreateAnimation('walk'));
    doc.execute(new UpsertBoneKeyframe('walk', 'hip', 'rotate', { time: 1, value: 10 }));
    doc.execute(new UpsertBoneKeyframe('walk', 'hip', 'rotate', { time: 0.5, value: 5 }));
    doc.execute(new UpsertBoneKeyframe('walk', 'hip', 'rotate', { value: 0 }));
    expect(doc.getAnimation('walk')?.bones?.['hip']?.rotate).toEqual([
      { value: 0 },
      { time: 0.5, value: 5 },
      { time: 1, value: 10 },
    ]);

    doc.execute(new UpsertBoneKeyframe('walk', 'hip', 'rotate', { time: 0.5, value: 7 }));
    expect(doc.getAnimation('walk')?.bones?.['hip']?.rotate).toHaveLength(3);
    expect(doc.getAnimation('walk')?.bones?.['hip']?.rotate?.[1]).toEqual({ time: 0.5, value: 7 });

    doc.undo();
    expect(doc.getAnimation('walk')?.bones?.['hip']?.rotate?.[1]).toEqual({ time: 0.5, value: 5 });
  });

  it('deletes keyframes and cleans up empty timelines', () => {
    const doc = docWithHip();
    doc.execute(new CreateAnimation('walk'));
    doc.execute(new UpsertBoneKeyframe('walk', 'hip', 'rotate', { time: 0.5, value: 5 }));
    doc.execute(new DeleteBoneKeyframe('walk', 'hip', 'rotate', 0.5));
    expect(doc.getAnimation('walk')?.bones).toBeUndefined();
    doc.undo();
    expect(doc.getAnimation('walk')?.bones?.['hip']?.rotate).toHaveLength(1);
    expect(() => doc.execute(new DeleteBoneKeyframe('walk', 'hip', 'rotate', 2))).toThrow(
      /No rotate key/,
    );
  });

  it('clears the redo stack on new edits', () => {
    const doc = docWithHip();
    doc.undo();
    expect(doc.history.canRedo).toBe(true);
    doc.execute(new AddBone(createBone('torso', 'root')));
    expect(doc.history.canRedo).toBe(false);
  });
});
