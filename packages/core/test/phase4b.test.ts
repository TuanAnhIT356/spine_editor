import { describe, expect, it } from 'vitest';
import {
  buildGridMeshAttachment,
  computeAnimatedColors,
  computeAnimatedDeforms,
  computePose,
  createBone,
  createEmptySkeleton,
  createSlot,
  sampleColorTimeline,
  sampleDeform,
  worldRotationOf,
  type SkeletonData,
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

describe('transform constraints', () => {
  it('pulls rotation and translation toward the target by mix', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('target', 'root', { x: 100, y: 50, rotation: 90 }));
    data.bones.push(createBone('b', 'root'));
    data.transform.push(
      tc({ name: 'follow', bones: ['b'], target: 'target', mixRotate: 1, mixX: 1, mixY: 1 }),
    );
    const world = computePose(data);
    const b = world.get('b')!;
    expect(b.tx).toBeCloseTo(100, 4);
    expect(b.ty).toBeCloseTo(50, 4);
    expect(worldRotationOf(b)).toBeCloseTo(90, 4);
  });

  it('half mix lands halfway', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('target', 'root', { x: 100 }));
    data.bones.push(createBone('b', 'root'));
    data.transform.push(tc({ name: 'follow', bones: ['b'], target: 'target', mixX: 0.5 }));
    expect(computePose(data).get('b')!.tx).toBeCloseTo(50, 4);
  });
});

describe('slot colors', () => {
  it('interpolates rgba hex and applies alpha timelines', () => {
    const keys = [{ color: '00000000' }, { time: 1, color: 'ffffffff' }];
    expect(sampleColorTimeline(keys, 0.5, 'ffffffff')).toBe('80808080');

    const data = createEmptySkeleton();
    data.slots.push(createSlot('s', 'root'));
    data.animations['a'] = {
      slots: { s: { alpha: [{ value: 1 }, { time: 1, value: 0 }] } },
    };
    expect(computeAnimatedColors(data, 'a', 0.5).get('s')).toBe('ffffff80');
  });
});

describe('deform', () => {
  it('samples sparse deform keys with interpolation', () => {
    const keys = [
      { vertices: [10, 0], offset: 2 },
      { time: 1, vertices: [20, 0], offset: 2 },
    ];
    const out = sampleDeform(keys, 0.5, 6)!;
    expect(Array.from(out)).toEqual([0, 0, 15, 0, 0, 0]);
  });

  it('resolves mesh lengths for animated deforms', () => {
    const data = createEmptySkeleton();
    data.slots.push(createSlot('s', 'root', { attachment: 'm' }));
    const mesh = buildGridMeshAttachment(10, 10, 1, 1);
    data.skins[0]!.attachments = { s: { m: mesh } };
    data.animations['a'] = {
      attachments: { default: { s: { m: { deform: [{ vertices: [5], offset: 0 }] } } } },
    };
    const deforms = computeAnimatedDeforms(data, 'a', 0);
    expect(deforms.get('s')?.get('m')?.length).toBe(mesh.vertices.length);
    expect(deforms.get('s')?.get('m')?.[0]).toBe(5);
  });
});

describe('buildGridMeshAttachment', () => {
  it('builds a consistent grid', () => {
    const mesh = buildGridMeshAttachment(60, 40, 2, 2);
    expect(mesh.vertices).toHaveLength(9 * 2);
    expect(mesh.uvs).toHaveLength(9 * 2);
    expect(mesh.triangles).toHaveLength(2 * 2 * 6);
    expect(Math.min(...mesh.uvs)).toBe(0);
    expect(Math.max(...mesh.uvs)).toBe(1);
    // top-left vertex is at (-w/2, +h/2) with uv (0,0)
    expect(mesh.vertices[0]).toBe(-30);
    expect(mesh.vertices[1]).toBe(20);
    const data: SkeletonData = createEmptySkeleton();
    void data;
  });
});
