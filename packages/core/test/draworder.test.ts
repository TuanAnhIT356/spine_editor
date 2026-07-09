import { describe, expect, it } from 'vitest';
import {
  DeleteDrawOrderKeyframe,
  DeleteEventKeyframe,
  SetEventDef,
  SpineDocument,
  TransformBoneKeys,
  UpsertBoneKeyframe,
  UpsertDrawOrderKeyframe,
  UpsertEventKeyframe,
  computeAnimatedDrawOrder,
  computeDrawOrderOffsets,
  createBone,
  createEmptySkeleton,
  createSlot,
  type SkeletonData,
} from '../src/index.js';

function rig(): SkeletonData {
  const data = createEmptySkeleton();
  for (const name of ['a', 'b', 'c', 'd']) data.slots.push(createSlot(name, 'root'));
  data.animations['anim'] = {};
  return data;
}

describe('computeAnimatedDrawOrder', () => {
  it('returns undefined without a timeline or before the first key', () => {
    const data = rig();
    expect(computeAnimatedDrawOrder(data, 'anim', 0)).toBeUndefined();
    data.animations['anim']!.drawOrder = [{ time: 1, offsets: [{ slot: 'a', offset: 1 }] }];
    expect(computeAnimatedDrawOrder(data, 'anim', 0.5)).toBeUndefined();
  });

  it('applies offsets of the active key (stepped)', () => {
    const data = rig();
    // swap a and b: a moves +1, b moves -1
    data.animations['anim']!.drawOrder = [
      {
        offsets: [
          { slot: 'a', offset: 1 },
          { slot: 'b', offset: -1 },
        ],
      },
      { time: 1 }, // reset to setup order
    ];
    expect(computeAnimatedDrawOrder(data, 'anim', 0.5)).toEqual(['b', 'a', 'c', 'd']);
    expect(computeAnimatedDrawOrder(data, 'anim', 1)).toBeUndefined();
  });

  it('moves a slot to the front, shifting the rest back', () => {
    const data = rig();
    data.animations['anim']!.drawOrder = [{ offsets: [{ slot: 'd', offset: -3 }] }];
    expect(computeAnimatedDrawOrder(data, 'anim', 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('round-trips through computeDrawOrderOffsets for arbitrary reorders', () => {
    const data = rig();
    const setup = data.slots.map((s) => s.name);
    for (const target of [
      ['b', 'a', 'c', 'd'],
      ['d', 'a', 'b', 'c'],
      ['a', 'c', 'd', 'b'],
      ['d', 'c', 'b', 'a'],
    ]) {
      const offsets = computeDrawOrderOffsets(setup, target);
      data.animations['anim']!.drawOrder = [{ offsets }];
      expect(computeAnimatedDrawOrder(data, 'anim', 0)).toEqual(target);
    }
  });

  it('returns no offsets for an unchanged order', () => {
    expect(computeDrawOrderOffsets(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});

describe('draw order / event keyframe commands', () => {
  it('upserts sorted draw order keys and undoes', () => {
    const doc = new SpineDocument(rig());
    doc.execute(
      new UpsertDrawOrderKeyframe('anim', { time: 1, offsets: [{ slot: 'a', offset: 1 }] }),
    );
    doc.execute(
      new UpsertDrawOrderKeyframe('anim', {
        offsets: [
          { slot: 'b', offset: -1 },
          { slot: 'a', offset: 1 },
        ],
      }),
    );
    const keys = doc.data.animations['anim']!.drawOrder!;
    expect(keys.map((k) => k.time ?? 0)).toEqual([0, 1]);
    // offsets stored sorted by setup index
    expect(keys[0]!.offsets!.map((o) => o.slot)).toEqual(['a', 'b']);
    doc.undo();
    expect(doc.data.animations['anim']!.drawOrder!.length).toBe(1);
  });

  it('rejects unknown slots and deletes keys', () => {
    const doc = new SpineDocument(rig());
    expect(() =>
      doc.execute(new UpsertDrawOrderKeyframe('anim', { offsets: [{ slot: 'nope', offset: 1 }] })),
    ).toThrow(/does not exist/);
    doc.execute(new UpsertDrawOrderKeyframe('anim', { offsets: [{ slot: 'a', offset: 1 }] }));
    doc.execute(new DeleteDrawOrderKeyframe('anim', 0));
    expect(doc.data.animations['anim']!.drawOrder).toBeUndefined();
  });

  it('retimes groups of bone keys with offset and scale, shifting bezier handles', () => {
    const data = rig();
    data.bones.push(createBone('hip', 'root'));
    const doc = new SpineDocument(data);
    doc.execute(
      new UpsertBoneKeyframe('anim', 'hip', 'rotate', { value: 0, curve: [0.2, 0, 0.4, 30] }),
    );
    doc.execute(new UpsertBoneKeyframe('anim', 'hip', 'rotate', { time: 0.5, value: 30 }));
    doc.execute(new UpsertBoneKeyframe('anim', 'hip', 'rotate', { time: 1, value: 0 }));

    // Shift all three keys +0.5s.
    const refs = [0, 0.5, 1].map((time) => ({ bone: 'hip', timeline: 'rotate' as const, time }));
    doc.execute(new TransformBoneKeys('anim', refs, { offset: 0.5 }));
    let keys = doc.data.animations['anim']!.bones!['hip']!.rotate!;
    expect(keys.map((k) => k.time ?? 0)).toEqual([0.5, 1, 1.5]);
    expect(keys[0]!.curve).toEqual([0.7, 0, 0.9, 30]);

    // Scale ×2 around the first key.
    doc.execute(
      new TransformBoneKeys(
        'anim',
        [0.5, 1, 1.5].map((time) => ({ bone: 'hip', timeline: 'rotate' as const, time })),
        { scale: 2, pivot: 0.5 },
      ),
    );
    keys = doc.data.animations['anim']!.bones!['hip']!.rotate!;
    expect(keys.map((k) => k.time ?? 0)).toEqual([0.5, 1.5, 2.5]);

    // Collision with an unmoved key must throw and leave data untouched.
    expect(() =>
      doc.execute(
        new TransformBoneKeys('anim', [{ bone: 'hip', timeline: 'rotate', time: 0.5 }], {
          offset: 1,
        }),
      ),
    ).toThrow(/same time/);
    expect(doc.data.animations['anim']!.bones!['hip']!.rotate!.map((k) => k.time ?? 0)).toEqual([
      0.5, 1.5, 2.5,
    ]);

    // Undo restores the previous retime in one step.
    doc.undo();
    expect(doc.data.animations['anim']!.bones!['hip']!.rotate!.map((k) => k.time ?? 0)).toEqual([
      0.5, 1, 1.5,
    ]);
  });

  it('deletes event keys by name and time', () => {
    const doc = new SpineDocument(rig());
    doc.execute(new SetEventDef('step', {}));
    doc.execute(new UpsertEventKeyframe('anim', { name: 'step', time: 0.5 }));
    expect(() => doc.execute(new DeleteEventKeyframe('anim', 'step', 0.25))).toThrow(
      /No event key/,
    );
    doc.execute(new DeleteEventKeyframe('anim', 'step', 0.5));
    expect(doc.data.animations['anim']!.events).toBeUndefined();
    doc.undo();
    expect(doc.data.animations['anim']!.events!.length).toBe(1);
  });
});
