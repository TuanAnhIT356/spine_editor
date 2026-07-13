import { describe, expect, it } from 'vitest';
import { createBone, createEmptySkeleton, createSlot, computePose } from '@spine-editor/core';
import { computeSkeletonBounds } from '../src/viewport/bounds.js';

describe('computeSkeletonBounds', () => {
  it('returns null when every bone is hidden (createEmptySkeleton always has a root bone)', () => {
    const data = createEmptySkeleton();
    const pose = computePose(data);
    expect(computeSkeletonBounds(data, pose, new Set(['root']))).toBeNull();
  });

  it('bounds a single bone by its origin and tip', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root', { x: 10, y: 0, length: 40 }));
    const pose = computePose(data);
    const b = computeSkeletonBounds(data, pose)!;
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxX).toBeCloseTo(50);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(0);
  });

  it('bounds a region attachment by its rotated corners', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root', { length: 0 }));
    data.slots.push(createSlot('s', 'a', { attachment: 'img' }));
    data.skins[0]!.attachments = {
      s: { img: { type: 'region', x: 0, y: 0, width: 20, height: 10 } },
    };
    const pose = computePose(data);
    const b = computeSkeletonBounds(data, pose)!;
    expect(b.minX).toBeCloseTo(-10);
    expect(b.maxX).toBeCloseTo(10);
    expect(b.minY).toBeCloseTo(-5);
    expect(b.maxY).toBeCloseTo(5);
  });

  it('excludes hidden bones', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root', { x: 500, length: 10 }));
    const pose = computePose(data);
    expect(computeSkeletonBounds(data, pose, new Set(['a', 'root']))).toBeNull();
  });
});
