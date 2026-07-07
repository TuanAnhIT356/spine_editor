import { describe, expect, it } from 'vitest';
import {
  computeAnimatedLocals,
  computeAnimatedPose,
  createBone,
  createEmptySkeleton,
  createSlot,
  getAnimationDuration,
  sampleAttachment,
  sampleBoneTimeline,
  type SkeletonData,
} from '../src/index.js';

function rig(): SkeletonData {
  const data = createEmptySkeleton();
  data.bones.push(createBone('hip', 'root', { rotation: 10, x: 5, scaleX: 2 }));
  return data;
}

describe('sampleBoneTimeline', () => {
  const keys = [{ value: 0 }, { time: 1, value: 90 }];

  it('interpolates linearly between keys', () => {
    expect(sampleBoneTimeline(keys, 0.5, 'value', 0, 0)).toBeCloseTo(45);
  });

  it('clamps before the first and after the last key', () => {
    expect(sampleBoneTimeline(keys, -1, 'value', 0, 0)).toBe(0);
    expect(sampleBoneTimeline(keys, 5, 'value', 0, 0)).toBe(90);
  });

  it('holds the previous value on stepped curves', () => {
    const stepped = [
      { value: 0, curve: 'stepped' as const },
      { time: 1, value: 90 },
    ];
    expect(sampleBoneTimeline(stepped, 0.99, 'value', 0, 0)).toBe(0);
    expect(sampleBoneTimeline(stepped, 1, 'value', 0, 0)).toBe(90);
  });

  it('eases with bezier curves (ease-in stays below linear)', () => {
    const bezier = [
      { value: 0, curve: [0.8, 0, 0.95, 2] },
      { time: 1, value: 10 },
    ];
    const v = sampleBoneTimeline(bezier, 0.5, 'value', 0, 0);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(5);
  });

  it('reads the y channel from the second bezier block', () => {
    const keys2 = [
      { x: 0, y: 0, curve: [0.25, 0, 0.75, 10, 0.8, 0, 0.95, 2] },
      { time: 1, x: 10, y: 10 },
    ];
    const x = sampleBoneTimeline(keys2, 0.5, 'x', 0, 0);
    const y = sampleBoneTimeline(keys2, 0.5, 'y', 1, 0);
    expect(x).toBeCloseTo(5, 0);
    expect(y).toBeLessThan(x);
  });
});

describe('computeAnimatedLocals', () => {
  it('adds rotate/translate offsets to the setup pose', () => {
    const data = rig();
    data.animations['a'] = {
      bones: {
        hip: {
          rotate: [{ value: 0 }, { time: 1, value: 90 }],
          translate: [{ x: 0 }, { time: 1, x: 20, y: 10 }],
        },
      },
    };
    const locals = computeAnimatedLocals(data, 'a', 0.5);
    const hip = locals.find((b) => b.name === 'hip');
    expect(hip?.rotation).toBeCloseTo(10 + 45);
    expect(hip?.x).toBeCloseTo(5 + 10);
    expect(hip?.y).toBeCloseTo(5);
  });

  it('multiplies scale factors with the setup pose', () => {
    const data = rig();
    data.animations['a'] = { bones: { hip: { scale: [{ x: 0.5, y: 2 }] } } };
    const hip = computeAnimatedLocals(data, 'a', 0).find((b) => b.name === 'hip');
    expect(hip?.scaleX).toBeCloseTo(2 * 0.5);
    expect(hip?.scaleY).toBeCloseTo(1 * 2);
  });

  it('supports single-axis timelines', () => {
    const data = rig();
    data.animations['a'] = {
      bones: { hip: { translatex: [{ value: 0 }, { time: 1, value: 8 }] } },
    };
    const hip = computeAnimatedLocals(data, 'a', 0.5).find((b) => b.name === 'hip');
    expect(hip?.x).toBeCloseTo(5 + 4);
    expect(hip?.y).toBeCloseTo(0);
  });
});

describe('attachments + duration + pose', () => {
  it('switches attachments at key times, holding setup before the first key', () => {
    const keys = [
      { time: 0.25, name: 'a' },
      { time: 0.5, name: null },
    ];
    expect(sampleAttachment(keys, 0, 'setup')).toBe('setup');
    expect(sampleAttachment(keys, 0.3, 'setup')).toBe('a');
    expect(sampleAttachment(keys, 0.9, 'setup')).toBeNull();
  });

  it('computes duration from the deepest timelines', () => {
    expect(
      getAnimationDuration({
        bones: { hip: { rotate: [{ value: 1 }, { time: 1.25, value: 0 }] } },
        events: [{ time: 2.5, name: 'x' }],
      }),
    ).toBe(2.5);
    expect(getAnimationDuration({})).toBe(0);
  });

  it('produces world matrices and attachment overrides together', () => {
    const data = rig();
    data.slots.push(createSlot('body', 'hip', { attachment: 'img' }));
    data.animations['a'] = {
      bones: { hip: { rotate: [{ value: 0 }, { time: 1, value: 90 }] } },
      slots: { body: { attachment: [{ name: 'img' }, { time: 0.5, name: null }] } },
    };
    const pose = computeAnimatedPose(data, 'a', 0.75);
    expect(pose.world.get('hip')).toBeDefined();
    expect(pose.attachments.get('body')).toBeNull();
    const hip = pose.locals.find((b) => b.name === 'hip');
    expect(hip?.rotation).toBeCloseTo(10 + 67.5);
  });
});
