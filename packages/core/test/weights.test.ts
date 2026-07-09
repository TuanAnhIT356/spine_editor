import { describe, expect, it } from 'vitest';
import {
  SetAttachmentVertices,
  SpineDocument,
  adjustVertexWeight,
  autoWeightVertices,
  boneWeightPerVertex,
  buildGridMeshAttachment,
  computeSetupPose,
  computeVertexWorldPositions,
  createBone,
  createEmptySkeleton,
  createSlot,
  isWeightedVertices,
  type SkeletonData,
} from '../src/index.js';

/** Two bones along +X: "left" at origin, "right" at x=100, both length 100. */
function rig(): SkeletonData {
  const data = createEmptySkeleton();
  data.bones.push(createBone('left', 'root', { length: 100 }));
  data.bones.push(createBone('right', 'root', { x: 100, length: 100 }));
  data.slots.push(createSlot('skin-slot', 'root'));
  const mesh = buildGridMeshAttachment(200, 40, 2, 1); // 6 vertices, centered on root
  data.skins[0]!.attachments = { 'skin-slot': { img: mesh } };
  return data;
}

describe('autoWeightVertices', () => {
  it('binds vertices to the nearest bones with normalized weights', () => {
    const data = rig();
    const mesh = data.skins[0]!.attachments!['skin-slot']!['img']! as {
      uvs: number[];
      vertices: number[];
    };
    // Shift the mesh so it spans x∈[0,200] over the two bones.
    const shifted = mesh.vertices.map((v, i) => (i % 2 === 0 ? v + 100 : v));
    const weighted = autoWeightVertices(data, 'skin-slot', shifted, ['left', 'right']);
    const count = mesh.uvs.length / 2;
    expect(isWeightedVertices(weighted, count)).toBe(true);

    const leftIdx = data.bones.findIndex((b) => b.name === 'left');
    const rightIdx = data.bones.findIndex((b) => b.name === 'right');
    const leftW = boneWeightPerVertex(weighted, count, leftIdx);
    const rightW = boneWeightPerVertex(weighted, count, rightIdx);
    for (let v = 0; v < count; v++) {
      expect(leftW[v]! + rightW[v]!).toBeCloseTo(1, 3);
    }
    // Leftmost vertex (x=0) favors "left"; rightmost (x=200) favors "right".
    const xs = Array.from({ length: count }, (_, v) => shifted[v * 2]!);
    const leftmost = xs.indexOf(Math.min(...xs));
    const rightmost = xs.indexOf(Math.max(...xs));
    expect(leftW[leftmost]!).toBeGreaterThan(0.6);
    expect(rightW[rightmost]!).toBeGreaterThan(0.6);
  });

  it('keeps world positions identical after binding', () => {
    const data = rig();
    const mesh = data.skins[0]!.attachments!['skin-slot']!['img']! as {
      uvs: number[];
      vertices: number[];
    };
    const count = mesh.uvs.length / 2;
    const pose = computeSetupPose(data);
    const rootWorld = pose.get('root')!;
    const before = computeVertexWorldPositions(mesh.vertices, count, rootWorld, data.bones, pose);
    const weighted = autoWeightVertices(data, 'skin-slot', mesh.vertices, ['left', 'right']);
    const after = computeVertexWorldPositions(weighted, count, rootWorld, data.bones, pose);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!).toBeCloseTo(before[i]!, 1);
    }
  });
});

describe('adjustVertexWeight', () => {
  it('shifts weight toward a bone and renormalizes the rest', () => {
    const data = rig();
    const mesh = data.skins[0]!.attachments!['skin-slot']!['img']! as {
      uvs: number[];
      vertices: number[];
    };
    const count = mesh.uvs.length / 2;
    const weighted = autoWeightVertices(data, 'skin-slot', mesh.vertices, ['left', 'right']);
    const leftIdx = data.bones.findIndex((b) => b.name === 'left');
    const painted = adjustVertexWeight(weighted, count, 0, leftIdx, 0.5);
    const leftW = boneWeightPerVertex(painted, count, leftIdx);
    const beforeW = boneWeightPerVertex(weighted, count, leftIdx);
    expect(leftW[0]!).toBeGreaterThan(beforeW[0]!);
    // Weights still sum to 1.
    const rightIdx = data.bones.findIndex((b) => b.name === 'right');
    const rightW = boneWeightPerVertex(painted, count, rightIdx);
    expect(leftW[0]! + rightW[0]!).toBeCloseTo(1, 3);
  });

  it('rejects unweighted vertices', () => {
    expect(() => adjustVertexWeight([0, 0, 1, 1], 2, 0, 0, 0.5)).toThrow(/unweighted/);
  });
});

describe('SetAttachmentVertices', () => {
  it('replaces mesh vertices and validates the layout', () => {
    const doc = new SpineDocument(rig());
    const mesh = doc.data.skins[0]!.attachments!['skin-slot']!['img']! as { vertices: number[] };
    const original = [...mesh.vertices];
    const moved = original.map((v) => v + 5);
    doc.execute(new SetAttachmentVertices('default', 'skin-slot', 'img', moved));
    expect(
      (doc.data.skins[0]!.attachments!['skin-slot']!['img']! as { vertices: number[] }).vertices,
    ).toEqual(moved);
    doc.undo();
    expect(
      (doc.data.skins[0]!.attachments!['skin-slot']!['img']! as { vertices: number[] }).vertices,
    ).toEqual(original);
    expect(() =>
      doc.execute(new SetAttachmentVertices('default', 'skin-slot', 'img', [1, 2, 3])),
    ).toThrow(/does not match/);
  });

  it('accepts the weighted layout and works for bounding boxes', () => {
    const data = rig();
    data.skins[0]!.attachments!['skin-slot']!['box'] = {
      type: 'boundingbox',
      vertexCount: 3,
      vertices: [0, 0, 10, 0, 10, 10],
    };
    const doc = new SpineDocument(data);
    doc.execute(new SetAttachmentVertices('default', 'skin-slot', 'box', [-5, -5, 15, -5, 15, 15]));
    const box = doc.data.skins[0]!.attachments!['skin-slot']!['box'] as { vertices: number[] };
    expect(box.vertices).toEqual([-5, -5, 15, -5, 15, 15]);

    const mesh = doc.data.skins[0]!.attachments!['skin-slot']!['img']! as {
      uvs: number[];
      vertices: number[];
    };
    const weighted = autoWeightVertices(doc.data, 'skin-slot', mesh.vertices, ['left']);
    doc.execute(new SetAttachmentVertices('default', 'skin-slot', 'img', weighted));
    expect(
      (doc.data.skins[0]!.attachments!['skin-slot']!['img'] as { vertices: number[] }).vertices,
    ).toEqual(weighted);
  });
});
