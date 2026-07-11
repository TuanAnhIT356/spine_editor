import { describe, expect, it } from 'vitest';
import {
  SetMeshGeometry,
  SpineDocument,
  addMeshVertex,
  autoWeightVertices,
  boundBoneIndices,
  buildGridMeshAttachment,
  computeSetupPose,
  computeVertexWorldPositions,
  createBone,
  createEmptySkeleton,
  createSlot,
  isWeightedVertices,
  meshVertexCount,
  removeMeshVertex,
  weldMeshVertices,
  type SkeletonData,
  type SpineMeshAttachment,
} from '../src/index.js';

/** root + 2 bones dọc +X, slot trên root, mesh lưới 100×100. */
function rig(cols = 1, rows = 1): { data: SkeletonData; mesh: SpineMeshAttachment } {
  const data = createEmptySkeleton();
  data.bones.push(createBone('left', 'root', { length: 50 }));
  data.bones.push(createBone('right', 'root', { x: 50, length: 50 }));
  data.slots.push(createSlot('s', 'root'));
  const mesh = buildGridMeshAttachment(100, 100, cols, rows);
  data.skins[0]!.attachments = { s: { m: mesh } };
  return { data, mesh };
}

/** Các chỉ số tam giác hợp lệ (≥1 tam giác, index trong [0,count)). */
function expectValidTriangles(mesh: SpineMeshAttachment): void {
  const count = meshVertexCount(mesh);
  expect(mesh.triangles.length).toBeGreaterThan(0);
  expect(mesh.triangles.length % 3).toBe(0);
  for (const t of mesh.triangles) {
    expect(Number.isInteger(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(count);
  }
}

describe('buildGridMeshAttachment hull ring', () => {
  it('puts the outline first, in ring order', () => {
    const mesh = buildGridMeshAttachment(60, 40, 3, 3); // 16 verts, hull 12
    expect(mesh.hull).toBe(12);
    // Các cặp hull kề nhau (kể cả cuối→đầu) cách nhau đúng 1 bước lưới.
    for (let i = 0; i < 12; i++) {
      const j = (i + 1) % 12;
      const dx = Math.abs(mesh.vertices[i * 2]! - mesh.vertices[j * 2]!);
      const dy = Math.abs(mesh.vertices[i * 2 + 1]! - mesh.vertices[j * 2 + 1]!);
      expect(dx + dy).toBeGreaterThan(0);
      expect(dx + dy).toBeLessThan(21); // 1 bước, không nhảy chéo qua lưới
    }
    // Vertex 0 vẫn là góc trên-trái với uv (0,0) như trước.
    expect(mesh.vertices[0]).toBe(-30);
    expect(mesh.vertices[1]).toBe(20);
    expect(mesh.uvs[0]).toBe(0);
    expect(mesh.uvs[1]).toBe(0);
    expect(meshVertexCount(mesh)).toBe(16);
  });
});

describe('addMeshVertex', () => {
  it('adds an interior vertex and retriangulates', () => {
    const { data, mesh } = rig();
    const next = addMeshVertex(data, 's', mesh, 10, 5);
    expect(meshVertexCount(next)).toBe(5);
    expect(next.hull).toBe(4);
    expect(next.vertices).toContain(10);
    expect(next.uvs.length).toBe(10);
    // UV nội suy từ khung 100×100: u=(10+50)/100=0.6, v=(50-5)/100=0.45
    const vi = 4; // interior append cuối
    expect(next.uvs[vi * 2]).toBeCloseTo(0.6, 3);
    expect(next.uvs[vi * 2 + 1]).toBeCloseTo(0.45, 3);
    expectValidTriangles(next);
  });

  it('snaps to a hull edge and grows the outline', () => {
    const { data, mesh } = rig();
    // Cạnh trên của lưới 1×1 nối (-50,50)→(50,50); điểm (0,52) cách cạnh 2 (<6).
    const next = addMeshVertex(data, 's', mesh, 0, 52);
    expect(meshVertexCount(next)).toBe(5);
    expect(next.hull).toBe(5);
    expectValidTriangles(next);
  });

  it('auto-weights the new vertex on a weighted mesh', () => {
    const { data, mesh } = rig();
    mesh.vertices = autoWeightVertices(data, 's', mesh.vertices, ['left', 'right']);
    const next = addMeshVertex(data, 's', mesh, 10, 5);
    const count = meshVertexCount(next);
    expect(count).toBe(5);
    expect(isWeightedVertices(next.vertices, count)).toBe(true);
    // Vertex mới render đúng chỗ (10,5) qua setup pose.
    const pose = computeSetupPose(data);
    const world = computeVertexWorldPositions(
      next.vertices,
      count,
      pose.get('root')!,
      data.bones,
      pose,
    );
    expect(world[4 * 2]!).toBeCloseTo(10, 0);
    expect(world[4 * 2 + 1]!).toBeCloseTo(5, 0);
  });
});

describe('removeMeshVertex', () => {
  it('removes an interior vertex', () => {
    const { data, mesh } = rig();
    const withV = addMeshVertex(data, 's', mesh, 10, 5);
    const next = removeMeshVertex(data, 's', withV, 4);
    expect(meshVertexCount(next)).toBe(4);
    expect(next.hull).toBe(4);
    expectValidTriangles(next);
  });

  it('removes a hull vertex on a 3x3 grid and shrinks the hull', () => {
    const { data } = rig();
    const mesh = buildGridMeshAttachment(100, 100, 3, 3);
    const next = removeMeshVertex(data, 's', mesh, 1); // hull vertex giữa cạnh trên
    expect(meshVertexCount(next)).toBe(15);
    expect(next.hull).toBe(11);
    expectValidTriangles(next);
  });

  it('refuses to go below 3 vertices', () => {
    const { data } = rig();
    const tri: SpineMeshAttachment = {
      type: 'mesh',
      vertices: [0, 0, 50, 0, 0, 50],
      uvs: [0, 1, 1, 1, 0, 0],
      triangles: [0, 1, 2],
      hull: 3,
      width: 50,
      height: 50,
    };
    expect(() => removeMeshVertex(data, 's', tri, 0)).toThrow(/at least 3/);
  });
});

describe('weldMeshVertices', () => {
  it('merges vertices within the threshold', () => {
    const { data, mesh } = rig();
    const a = addMeshVertex(data, 's', mesh, 10, 5);
    const b = addMeshVertex(data, 's', a, 10.4, 5.3); // cách vertex trước ~0.5
    const { mesh: welded, merged } = weldMeshVertices(data, 's', b, 1);
    expect(merged).toBe(1);
    expect(meshVertexCount(welded)).toBe(5);
    expectValidTriangles(welded);
  });

  it('returns merged 0 when nothing is close', () => {
    const { data, mesh } = rig();
    const { merged } = weldMeshVertices(data, 's', mesh, 1);
    expect(merged).toBe(0);
  });
});

describe('boundBoneIndices', () => {
  it('lists bones appearing in influences', () => {
    const { data, mesh } = rig();
    const weighted = autoWeightVertices(data, 's', mesh.vertices, ['left', 'right']);
    const idx = boundBoneIndices(weighted, meshVertexCount(mesh));
    const names = idx.map((i) => data.bones[i]!.name);
    expect(names).toContain('left');
    expect(names).toContain('right');
    expect(boundBoneIndices(mesh.vertices, meshVertexCount(mesh))).toEqual([]);
  });
});

describe('SetMeshGeometry', () => {
  function docWithMesh() {
    const { data, mesh } = rig();
    data.animations['a'] = {
      attachments: { default: { s: { m: { deform: [{ vertices: [5, 5] }] } } } },
    };
    return { doc: new SpineDocument(data), mesh };
  }

  it('replaces geometry and clears deform keys in one undo step', () => {
    const { doc } = docWithMesh();
    const next = addMeshVertex(
      doc.data,
      's',
      doc.data.skins[0]!.attachments!['s']!['m']! as SpineMeshAttachment,
      10,
      5,
    );
    doc.execute(
      new SetMeshGeometry('default', 's', 'm', {
        vertices: next.vertices,
        uvs: next.uvs,
        triangles: next.triangles,
        hull: next.hull ?? 5,
      }),
    );
    const att = doc.data.skins[0]!.attachments!['s']!['m']! as SpineMeshAttachment;
    expect(meshVertexCount(att)).toBe(5);
    expect(doc.data.animations['a']!.attachments?.default?.s?.m).toBeUndefined();
    doc.undo();
    const restored = doc.data.skins[0]!.attachments!['s']!['m']! as SpineMeshAttachment;
    expect(meshVertexCount(restored)).toBe(4);
    expect(doc.data.animations['a']!.attachments?.default?.s?.m?.deform?.length).toBe(1);
  });

  it('validates triangles and hull', () => {
    const { doc } = docWithMesh();
    expect(() =>
      doc.execute(
        new SetMeshGeometry('default', 's', 'm', {
          vertices: [0, 0, 1, 0, 0, 1],
          uvs: [0, 0, 1, 0, 0, 1],
          triangles: [0, 1, 9],
          hull: 3,
        }),
      ),
    ).toThrow(/Triangles/);
  });
});
