# Phase 19 — Weights view + Mesh tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add/remove/weld mesh vertices with automatic Delaunay retriangulation, a Spine-style floating Weights window (bones palette, Bind/Remove/Swap, Auto/Smooth/Prune, brush Amount + Add/Replace), and 2 new MCP tools (`edit_mesh`, `adjust_weights` → 61 total).

**Architecture:** Pure geometry/weight helpers in `core` (`mesh-edit.ts` mới + mở rộng `weights.ts`), một command mới `SetMeshGeometry` (đổi vertices/uvs/triangles/hull + xóa deform keys trong 1 undo step). Editor thêm mesh-tool row trong SlotDock, click-handlers Create/Delete trong Viewport, cửa sổ nổi WeightsWindow (pattern Preview/Ghosting) và overlay màu blend theo bone trong renderer. MCP ops gọi đúng các core helper như UI.

**Tech Stack:** TypeScript strict, Vitest, zustand, PixiJS v8, `delaunator` (ISC) — dependency mới duy nhất.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-11-phase19-weights-mesh-design.md`.
- Mọi lệnh pnpm chạy từ `client/`; test 1 file: `pnpm --filter @spine-editor/core test -- test/mesh-edit.test.ts`.
- KHÔNG thêm Spine Runtimes; delaunator (ISC) là dependency mới duy nhất.
- Mọi edit đều là Command (undoable); core không phụ thuộc UI.
- Không đổi text các nút/selector e2e đang dùng: "Edit", "Done", "New", "Play", "Pause", `.tree`, `.row.bone`, `.ruler`, `.track .key`.
- Commit message kết thúc bằng `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Format trước mỗi commit: `pnpm exec prettier --write <files>`; lint: `pnpm lint`.

---

### Task 1: Core mesh-edit — delaunator, hull-ring builder, add/remove/weld

**Files:**

- Modify: `client/packages/core/package.json` (dependency delaunator)
- Modify: `client/packages/core/src/mesh.ts` (builder xếp hull ring trước)
- Create: `client/packages/core/src/mesh-edit.ts`
- Modify: `client/packages/core/src/weights.ts` (thêm `boundBoneIndices`)
- Modify: `client/packages/core/src/index.ts` (export mesh-edit)
- Test: `client/packages/core/test/mesh-edit.test.ts`

**Interfaces:**

- Consumes: `meshVertexCount`, `isWeightedVertices`, `autoWeightVertices`, `computeVertexWorldPositions` (weights.ts); `computeSetupPose`, `applyMat`, `invertMat`, `Mat2D` (pose.ts); `SpineMeshAttachment` (spine-json/types.ts).
- Produces (Task 2/4/6 dùng):
  - `boundBoneIndices(vertices: number[], vertexCount: number): number[]`
  - `meshLocalPositions(data: SkeletonData, slotName: string, mesh: SpineMeshAttachment): number[]`
  - `retriangulate(local: number[], hull: number): number[]`
  - `addMeshVertex(data, slotName, mesh, x: number, y: number): SpineMeshAttachment`
  - `removeMeshVertex(data, slotName, mesh, vertexIndex: number): SpineMeshAttachment`
  - `weldMeshVertices(data, slotName, mesh, threshold = 1): { mesh: SpineMeshAttachment; merged: number }`

- [ ] **Step 1: Thêm dependency**

```bash
cd /Users/tuananh/Projects/you/spine_editor/client
pnpm --filter @spine-editor/core add delaunator
pnpm --filter @spine-editor/core add -D @types/delaunator
```

Expected: `client/packages/core/package.json` có `"delaunator": "^5..."` trong dependencies và `"@types/delaunator"` trong devDependencies.

- [ ] **Step 2: Viết test fail** — `client/packages/core/test/mesh-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addMeshVertex,
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
  autoWeightVertices,
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

/** Các chỉ số tam giác hợp lệ và đủ phủ (≥1 tam giác, index trong [0,count)). */
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
    // Các cặp hull kề nhau (kể cả cuối→đầu) cách nhau đúng 1 bước lưới (20 hoặc ~13.33).
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
    // Vertex interior (sau ring) đúng 4 điểm cho lưới 3×3.
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
```

- [ ] **Step 3: RED**

Run (từ `client/`): `pnpm --filter @spine-editor/core test -- test/mesh-edit.test.ts`
Expected: FAIL — `addMeshVertex` không export.

- [ ] **Step 4: Sửa `mesh.ts` — hull ring trước** (thay toàn bộ hàm):

```ts
export function buildGridMeshAttachment(
  width: number,
  height: number,
  cols = 3,
  rows = 3,
): SpineMeshAttachment {
  if (cols < 1 || rows < 1) throw new Error('Grid mesh needs at least 1x1 cells.');
  const stride = cols + 1;
  const total = (cols + 1) * (rows + 1);
  // Spine hull convention: the first `hull` vertices trace the outline in order.
  const ring: number[] = [];
  for (let cx = 0; cx <= cols; cx++) ring.push(cx); // top row →
  for (let ry = 1; ry <= rows; ry++) ring.push(ry * stride + cols); // right col ↓
  for (let cx = cols - 1; cx >= 0; cx--) ring.push(rows * stride + cx); // bottom ←
  for (let ry = rows - 1; ry >= 1; ry--) ring.push(ry * stride); // left ↑
  const inRing = new Set(ring);
  const order: number[] = [...ring];
  for (let i = 0; i < total; i++) if (!inRing.has(i)) order.push(i);
  const newIndex = new Map(order.map((gridIdx, idx) => [gridIdx, idx]));
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (const gridIdx of order) {
    const cx = gridIdx % stride;
    const ry = Math.floor(gridIdx / stride);
    const u = cx / cols;
    const v = ry / rows;
    // v=0 is the image top; vertex y is up, so the top row sits at +height/2.
    vertices.push(-width / 2 + u * width, height / 2 - v * height);
    uvs.push(u, v);
  }
  const triangles: number[] = [];
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const tl = ry * stride + cx;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      triangles.push(
        newIndex.get(tl)!,
        newIndex.get(tr)!,
        newIndex.get(br)!,
        newIndex.get(tl)!,
        newIndex.get(br)!,
        newIndex.get(bl)!,
      );
    }
  }
  return { type: 'mesh', uvs, triangles, vertices, hull: 2 * (cols + rows), width, height };
}
```

- [ ] **Step 5: `boundBoneIndices` vào `weights.ts`** (thêm sau `boneWeightPerVertex`):

```ts
/** Bone indices appearing in a weighted vertex array's influences (sorted). */
export function boundBoneIndices(vertices: number[], vertexCount: number): number[] {
  if (!isWeightedVertices(vertices, vertexCount)) return [];
  const out = new Set<number>();
  let vi = 0;
  for (let v = 0; v < vertexCount; v++) {
    const count = vertices[vi++] ?? 0;
    for (let b = 0; b < count; b++) {
      out.add(vertices[vi] ?? 0);
      vi += 4;
    }
  }
  return [...out].sort((a, b) => a - b);
}
```

- [ ] **Step 6: Tạo `client/packages/core/src/mesh-edit.ts`**:

```ts
/**
 * Mesh geometry editing: add/remove/weld vertices with automatic Delaunay
 * retriangulation (delaunator), honoring the Spine hull convention — the
 * first `hull` vertices trace the outline, in order. All functions are pure
 * (they return a new attachment) and accept weighted or unweighted meshes.
 */

import Delaunator from 'delaunator';
import type { SkeletonData } from './model/types.js';
import { applyMat, computeSetupPose, invertMat } from './pose.js';
import type { SpineMeshAttachment } from './spine-json/types.js';
import {
  autoWeightVertices,
  boundBoneIndices,
  computeVertexWorldPositions,
  isWeightedVertices,
  meshVertexCount,
} from './weights.js';

/** Distance (local units) within which a new vertex snaps into a hull edge. */
const HULL_SNAP = 6;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Vertex positions in slot-bone local space (resolves the weighted layout). */
export function meshLocalPositions(
  data: SkeletonData,
  slotName: string,
  mesh: SpineMeshAttachment,
): number[] {
  const count = meshVertexCount(mesh);
  if (!isWeightedVertices(mesh.vertices, count)) return [...mesh.vertices];
  const slot = data.slots.find((s) => s.name === slotName);
  if (!slot) throw new Error(`Slot "${slotName}" does not exist.`);
  const pose = computeSetupPose(data);
  const boneWorld = pose.get(slot.bone);
  if (!boneWorld) throw new Error(`Bone "${slot.bone}" has no pose.`);
  const world = computeVertexWorldPositions(mesh.vertices, count, boneWorld, data.bones, pose);
  const inv = invertMat(boneWorld);
  const out: number[] = [];
  for (let i = 0; i < world.length; i += 2) {
    const p = applyMat(inv, world[i]!, world[i + 1]!);
    out.push(r2(p.x), r2(p.y));
  }
  return out;
}

function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!;
    const yi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!;
    const yj = poly[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Delaunay triangles over local x,y pairs, dropping triangles outside the hull polygon. */
export function retriangulate(local: number[], hull: number): number[] {
  const del = new Delaunator(Float64Array.from(local));
  const hullPoly = local.slice(0, hull * 2);
  const out: number[] = [];
  for (let t = 0; t < del.triangles.length; t += 3) {
    const a = del.triangles[t]!;
    const b = del.triangles[t + 1]!;
    const c = del.triangles[t + 2]!;
    const cx = (local[a * 2]! + local[b * 2]! + local[c * 2]!) / 3;
    const cy = (local[a * 2 + 1]! + local[b * 2 + 1]! + local[c * 2 + 1]!) / 3;
    if (hull >= 3 && !pointInPolygon(cx, cy, hullPoly)) continue;
    out.push(a, b, c);
  }
  if (out.length === 0) throw new Error('Triangulation failed (degenerate mesh).');
  return out;
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Influence blocks per vertex of a weighted array (for splicing). */
function influenceBlocks(vertices: number[], count: number): number[][] {
  const blocks: number[][] = [];
  let vi = 0;
  for (let v = 0; v < count; v++) {
    const n = vertices[vi] ?? 0;
    blocks.push(vertices.slice(vi, vi + 1 + n * 4));
    vi += 1 + n * 4;
  }
  return blocks;
}

/**
 * Adds a vertex at local x,y. Near a hull edge (< HULL_SNAP) it is inserted
 * into the outline; otherwise it becomes an interior vertex. UVs interpolate
 * from the attachment's width/height frame; on weighted meshes the new
 * vertex is auto-weighted over the currently bound bones.
 */
export function addMeshVertex(
  data: SkeletonData,
  slotName: string,
  mesh: SpineMeshAttachment,
  x: number,
  y: number,
): SpineMeshAttachment {
  const count = meshVertexCount(mesh);
  const hull = Math.min(mesh.hull ?? count, count);
  const local = meshLocalPositions(data, slotName, mesh);
  let insertAt = count;
  let newHull = hull;
  if (hull >= 2) {
    let best = -1;
    let bestDist = HULL_SNAP;
    for (let i = 0; i < hull; i++) {
      const j = (i + 1) % hull;
      const d = distToSegment(
        x,
        y,
        local[i * 2]!,
        local[i * 2 + 1]!,
        local[j * 2]!,
        local[j * 2 + 1]!,
      );
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) {
      insertAt = best + 1;
      newHull = hull + 1;
    }
  }
  const newLocal = [...local];
  newLocal.splice(insertAt * 2, 0, r2(x), r2(y));
  const w = mesh.width ?? 100;
  const h = mesh.height ?? 100;
  const u = Math.min(1, Math.max(0, (x + w / 2) / w));
  const v = Math.min(1, Math.max(0, (h / 2 - y) / h));
  const newUvs = [...mesh.uvs];
  newUvs.splice(insertAt * 2, 0, Math.round(u * 10000) / 10000, Math.round(v * 10000) / 10000);
  const triangles = retriangulate(newLocal, newHull);
  let vertices: number[];
  if (isWeightedVertices(mesh.vertices, count)) {
    const boneNames = boundBoneIndices(mesh.vertices, count)
      .map((i) => data.bones[i]?.name)
      .filter((n): n is string => n !== undefined);
    const block = autoWeightVertices(data, slotName, [r2(x), r2(y)], boneNames);
    const blocks = influenceBlocks(mesh.vertices, count);
    blocks.splice(insertAt, 0, block);
    vertices = blocks.flat();
  } else {
    vertices = newLocal;
  }
  return { ...mesh, vertices, uvs: newUvs, triangles, hull: newHull };
}

/** Removes one vertex (hull vertices shrink the outline) and retriangulates. */
export function removeMeshVertex(
  data: SkeletonData,
  slotName: string,
  mesh: SpineMeshAttachment,
  vertexIndex: number,
): SpineMeshAttachment {
  const count = meshVertexCount(mesh);
  if (count <= 3) throw new Error('A mesh needs at least 3 vertices.');
  if (vertexIndex < 0 || vertexIndex >= count) {
    throw new Error(`Vertex ${vertexIndex} is out of range.`);
  }
  const hull = Math.min(mesh.hull ?? count, count);
  const isHull = vertexIndex < hull;
  if (isHull && hull <= 3) throw new Error('The hull needs at least 3 vertices.');
  const local = meshLocalPositions(data, slotName, mesh);
  const newLocal = [...local];
  newLocal.splice(vertexIndex * 2, 2);
  const newUvs = [...mesh.uvs];
  newUvs.splice(vertexIndex * 2, 2);
  const newHull = isHull ? hull - 1 : hull;
  const triangles = retriangulate(newLocal, newHull);
  let vertices: number[];
  if (isWeightedVertices(mesh.vertices, count)) {
    const blocks = influenceBlocks(mesh.vertices, count);
    blocks.splice(vertexIndex, 1);
    vertices = blocks.flat();
  } else {
    vertices = newLocal;
  }
  return { ...mesh, vertices, uvs: newUvs, triangles, hull: newHull };
}

/** Merges vertices closer than `threshold` (lowest index survives) and retriangulates. */
export function weldMeshVertices(
  data: SkeletonData,
  slotName: string,
  mesh: SpineMeshAttachment,
  threshold = 1,
): { mesh: SpineMeshAttachment; merged: number } {
  const count = meshVertexCount(mesh);
  const hull = Math.min(mesh.hull ?? count, count);
  const local = meshLocalPositions(data, slotName, mesh);
  const target = Array.from({ length: count }, (_, i) => i);
  for (let a = 0; a < count; a++) {
    if (target[a] !== a) continue;
    for (let b = a + 1; b < count; b++) {
      if (target[b] !== b) continue;
      const d = Math.hypot(local[a * 2]! - local[b * 2]!, local[a * 2 + 1]! - local[b * 2 + 1]!);
      if (d < threshold) target[b] = a;
    }
  }
  const merged = target.filter((t, i) => t !== i).length;
  if (merged === 0) return { mesh, merged: 0 };
  const keep = target.map((t, i) => (t === i ? i : -1)).filter((i) => i >= 0);
  if (keep.length < 3) throw new Error('Welding would leave fewer than 3 vertices.');
  let removedHull = 0;
  for (let i = 0; i < hull; i++) if (target[i] !== i) removedHull++;
  const newHull = hull - removedHull;
  if (newHull < 3) throw new Error('Welding would leave fewer than 3 hull vertices.');
  const newLocal: number[] = [];
  const newUvs: number[] = [];
  for (const i of keep) {
    newLocal.push(local[i * 2]!, local[i * 2 + 1]!);
    newUvs.push(mesh.uvs[i * 2]!, mesh.uvs[i * 2 + 1]!);
  }
  const triangles = retriangulate(newLocal, newHull);
  let vertices: number[];
  if (isWeightedVertices(mesh.vertices, count)) {
    const blocks = influenceBlocks(mesh.vertices, count);
    vertices = keep.flatMap((i) => blocks[i]!);
  } else {
    vertices = newLocal;
  }
  return { mesh: { ...mesh, vertices, uvs: newUvs, triangles, hull: newHull }, merged };
}
```

- [ ] **Step 7: Export** — thêm vào cuối `client/packages/core/src/index.ts` (sau dòng `export * from './presets.js';`):

```ts
export * from './mesh-edit.js';
```

- [ ] **Step 8: GREEN + full suite**

Run: `pnpm --filter @spine-editor/core test -- test/mesh-edit.test.ts` → PASS.
Run: `pnpm --filter @spine-editor/core test` → toàn bộ pass (132 cũ + mới; weights.test/phase4b.test không đổi vì assertions order-agnostic, vertex 0 vẫn là góc trên-trái).
Run: `pnpm typecheck` → sạch.

- [ ] **Step 9: Commit**

```bash
cd /Users/tuananh/Projects/you/spine_editor/client
pnpm exec prettier --write packages/core/src/mesh.ts packages/core/src/mesh-edit.ts packages/core/src/weights.ts packages/core/src/index.ts packages/core/test/mesh-edit.test.ts packages/core/package.json
pnpm lint
cd .. && git add client/packages/core client/pnpm-lock.yaml
git commit -m "P19: core mesh-edit — add/remove/weld vertices, Delaunay retriangulation, hull-ring grid builder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Command SetMeshGeometry (xóa deform keys cùng undo step)

**Files:**

- Modify: `client/packages/core/src/commands/structure.ts`
- Test: `client/packages/core/test/mesh-edit.test.ts` (thêm describe)

**Interfaces:**

- Consumes: `Command` interface (pattern SetAttachmentVertices trong cùng file), `SpineSkin`, `SpineAttachmentTimelines` types.
- Produces: `new SetMeshGeometry(skinName, slotName, attachmentName, { vertices, uvs, triangles, hull })` — Task 4 (Viewport/SlotDock) và Task 6 (ops.ts) dùng.

- [ ] **Step 1: Test fail** — thêm vào cuối `client/packages/core/test/mesh-edit.test.ts`:

```ts
import { SetMeshGeometry, SpineDocument } from '../src/index.js';
// (gộp vào import đầu file)

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
```

Lưu ý: `SpineDocument.execute` propagate exception từ `command.execute` (History không catch) nên `expect(() => doc.execute(...)).toThrow(...)` hoạt động đúng.

- [ ] **Step 2: RED** — `pnpm --filter @spine-editor/core test -- test/mesh-edit.test.ts` → FAIL (SetMeshGeometry không tồn tại).

- [ ] **Step 3: Implement** — thêm vào `client/packages/core/src/commands/structure.ts` (sau class SetAttachmentVertices; import thêm `SpineAttachmentTimelines`, `SpineMeshAttachment` từ `../spine-json/types.js` nếu chưa có):

```ts
export interface MeshGeometry {
  vertices: number[];
  uvs: number[];
  triangles: number[];
  hull: number;
}

/**
 * Replaces a mesh attachment's full geometry (vertices/uvs/triangles/hull).
 * Changing the vertex count invalidates deform keys, so every deform/sequence
 * timeline for this attachment is removed in the same undo step (Spine warns
 * and does the same).
 */
export class SetMeshGeometry implements Command {
  readonly label: string;
  private beforeSkin: SpineSkin | undefined;
  private beforeTimelines: Record<string, SpineAttachmentTimelines> | undefined;

  constructor(
    private readonly skinName: string,
    private readonly slotName: string,
    private readonly attachmentName: string,
    private readonly geometry: MeshGeometry,
  ) {
    this.label = `Edit mesh geometry of "${attachmentName}"`;
  }

  execute(data: SkeletonData): void {
    const skin = data.skins.find((s) => s.name === this.skinName);
    if (!skin) throw new Error(`Skin "${this.skinName}" does not exist.`);
    const att = skin.attachments?.[this.slotName]?.[this.attachmentName];
    if (!att || att.type !== 'mesh') {
      throw new Error(`Attachment "${this.attachmentName}" is not a mesh.`);
    }
    const g = this.geometry;
    const count = g.uvs.length / 2;
    if (!Number.isInteger(count) || count < 3) throw new Error('Mesh needs at least 3 vertices.');
    if (g.vertices.length !== count * 2) {
      let vi = 0;
      let seen = 0;
      while (vi < g.vertices.length) {
        const n = g.vertices[vi];
        if (typeof n !== 'number' || n < 1 || !Number.isInteger(n)) break;
        vi += 1 + n * 4;
        seen++;
      }
      if (vi !== g.vertices.length || seen !== count) {
        throw new Error(`Vertex array does not match ${count} vertices.`);
      }
    }
    if (
      g.triangles.length === 0 ||
      g.triangles.length % 3 !== 0 ||
      g.triangles.some((t) => !Number.isInteger(t) || t < 0 || t >= count)
    ) {
      throw new Error('Triangles reference missing vertices.');
    }
    if (!Number.isInteger(g.hull) || g.hull < 3 || g.hull > count) {
      throw new Error(`Hull must be between 3 and ${count}.`);
    }
    this.beforeSkin = structuredClone(skin);
    this.beforeTimelines = {};
    for (const [animName, anim] of Object.entries(data.animations)) {
      const bySkin = anim.attachments?.[this.skinName];
      const timelines = bySkin?.[this.slotName]?.[this.attachmentName];
      if (!timelines) continue;
      this.beforeTimelines[animName] = structuredClone(timelines);
      delete bySkin![this.slotName]![this.attachmentName];
      if (Object.keys(bySkin![this.slotName]!).length === 0) delete bySkin![this.slotName];
      if (Object.keys(bySkin!).length === 0) delete anim.attachments![this.skinName];
      if (Object.keys(anim.attachments!).length === 0) delete anim.attachments;
    }
    att.vertices = [...g.vertices];
    att.uvs = [...g.uvs];
    att.triangles = [...g.triangles];
    att.hull = g.hull;
  }

  undo(data: SkeletonData): void {
    if (this.beforeSkin) {
      const idx = data.skins.findIndex((s) => s.name === this.skinName);
      if (idx >= 0) data.skins[idx] = this.beforeSkin;
    }
    for (const [animName, timelines] of Object.entries(this.beforeTimelines ?? {})) {
      const anim = data.animations[animName];
      if (!anim) continue;
      anim.attachments ??= {};
      anim.attachments[this.skinName] ??= {};
      anim.attachments[this.skinName]![this.slotName] ??= {};
      anim.attachments[this.skinName]![this.slotName]![this.attachmentName] = timelines;
    }
  }
}
```

Kiểu `SpineAttachmentTimelines`: xem tên chính xác trong `spine-json/types.ts` dòng ~429 (`Record<string, Record<string, Record<string, SpineAttachmentTimelines>>>`) — nếu tên khác, dùng tên đó.

- [ ] **Step 4: GREEN** — chạy lại file test → PASS; `pnpm --filter @spine-editor/core test` → tất cả pass; `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
cd /Users/tuananh/Projects/you/spine_editor/client
pnpm exec prettier --write packages/core/src/commands/structure.ts packages/core/test/mesh-edit.test.ts
pnpm lint
cd .. && git add client/packages/core
git commit -m "P19: SetMeshGeometry command — geometry swap + deform-key wipe in one undo step

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Core weight ops — smooth / prune / swap / removeBone

**Files:**

- Modify: `client/packages/core/src/weights.ts`
- Test: `client/packages/core/test/weights.test.ts` (thêm describe)

**Interfaces:**

- Consumes: `parseInfluences`/`packInfluences`/`Influence` (private trong weights.ts), `computeSetupPose`, `invertMat`, `applyMat`. **Không import mesh-edit.ts** (mesh-edit đã import weights — tránh vòng): phần giải local positions inline trong helper `meshSetupContext` dưới đây.
- Produces (Task 5/6 dùng):
  - `smoothWeights(data, slotName, mesh: SpineMeshAttachment, iterations = 1): number[]`
  - `pruneWeights(vertices, vertexCount, opts: { maxInfluences?: number; threshold?: number }): number[]`
  - `swapWeights(data, slotName, mesh, boneA: string, boneB: string): number[]`
  - `removeBoneFromWeights(data, slotName, mesh, boneName: string): number[]`

- [ ] **Step 1: Test fail** — thêm vào cuối `client/packages/core/test/weights.test.ts`:

```ts
import {
  boundBoneIndices,
  pruneWeights,
  removeBoneFromWeights,
  smoothWeights,
  swapWeights,
  type SpineMeshAttachment,
} from '../src/index.js';
// (gộp vào import đầu file)

/** Mesh lưới 2×1 (6 vertex) weighted trên 2 bone; helper lấy attachment đã ép kiểu. */
function weightedRig() {
  const data = rig();
  const mesh = data.skins[0]!.attachments!['skin-slot']!['img']! as SpineMeshAttachment;
  mesh.vertices = autoWeightVertices(data, 'skin-slot', mesh.vertices, ['left', 'right']);
  return { data, mesh, count: mesh.uvs.length / 2 };
}

describe('weight ops (P19)', () => {
  it('smoothWeights pulls weights toward neighbors and keeps sums at 1', () => {
    const { data, mesh, count } = weightedRig();
    const leftIdx = data.bones.findIndex((b) => b.name === 'left');
    const before = boneWeightPerVertex(mesh.vertices, count, leftIdx);
    const smoothed = smoothWeights(data, 'skin-slot', mesh, 1);
    const after = boneWeightPerVertex(smoothed, count, leftIdx);
    const rightIdx = data.bones.findIndex((b) => b.name === 'right');
    const afterR = boneWeightPerVertex(smoothed, count, rightIdx);
    for (let v = 0; v < count; v++) {
      expect(after[v]! + afterR[v]!).toBeCloseTo(1, 2);
    }
    // Vertex có weight left lớn nhất giảm về phía trung bình (láng giềng nhỏ hơn).
    const maxV = before.indexOf(Math.max(...before));
    expect(after[maxV]!).toBeLessThan(before[maxV]!);
  });

  it('pruneWeights drops small influences and renormalizes', () => {
    const { count } = weightedRig();
    // Vertex 0: 0.97/0.03 → prune 0.05 giữ 1 influence weight 1.
    const vertices = [2, 0, 10, 0, 0.97, 1, -10, 0, 0.03];
    const pruned = pruneWeights(vertices, 1, { threshold: 0.05 });
    expect(pruned).toEqual([1, 0, 10, 0, 1]);
    void count;
  });

  it('swapWeights exchanges influence and keeps world positions', () => {
    const { data, mesh, count } = weightedRig();
    const pose = computeSetupPose(data);
    const rootWorld = pose.get('root')!;
    const before = computeVertexWorldPositions(mesh.vertices, count, rootWorld, data.bones, pose);
    const leftIdx = data.bones.findIndex((b) => b.name === 'left');
    const rightIdx = data.bones.findIndex((b) => b.name === 'right');
    const wLeftBefore = boneWeightPerVertex(mesh.vertices, count, leftIdx);
    const swapped = swapWeights(data, 'skin-slot', mesh, 'left', 'right');
    const after = computeVertexWorldPositions(swapped, count, rootWorld, data.bones, pose);
    for (let i = 0; i < before.length; i++) expect(after[i]!).toBeCloseTo(before[i]!, 0);
    const wRightAfter = boneWeightPerVertex(swapped, count, rightIdx);
    for (let v = 0; v < count; v++) expect(wRightAfter[v]!).toBeCloseTo(wLeftBefore[v]!, 3);
  });

  it('removeBoneFromWeights rebinds orphan vertices to remaining bones', () => {
    const { data, mesh, count } = weightedRig();
    const leftIdx = data.bones.findIndex((b) => b.name === 'left');
    const out = removeBoneFromWeights(data, 'skin-slot', mesh, 'left');
    expect(isWeightedVertices(out, count)).toBe(true);
    expect(boneWeightPerVertex(out, count, leftIdx).every((w) => w === 0)).toBe(true);
    const rightIdx = data.bones.findIndex((b) => b.name === 'right');
    const wRight = boneWeightPerVertex(out, count, rightIdx);
    for (let v = 0; v < count; v++) expect(wRight[v]!).toBeCloseTo(1, 3);
  });

  it('removing the last bone returns unweighted local pairs preserving positions', () => {
    const { data, count } = weightedRig();
    const mesh = data.skins[0]!.attachments!['skin-slot']!['img']! as SpineMeshAttachment;
    mesh.vertices = autoWeightVertices(
      data,
      'skin-slot',
      buildGridMeshAttachment(200, 40, 2, 1).vertices,
      ['left'],
    );
    const pose = computeSetupPose(data);
    const rootWorld = pose.get('root')!;
    const before = computeVertexWorldPositions(mesh.vertices, count, rootWorld, data.bones, pose);
    const out = removeBoneFromWeights(data, 'skin-slot', mesh, 'left');
    expect(out.length).toBe(count * 2);
    const after = computeVertexWorldPositions(out, count, rootWorld, data.bones, pose);
    for (let i = 0; i < before.length; i++) expect(after[i]!).toBeCloseTo(before[i]!, 0);
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @spine-editor/core test -- test/weights.test.ts` → FAIL.

- [ ] **Step 3: Implement** — thêm vào cuối `client/packages/core/src/weights.ts` (import bổ sung `computeSetupPose`, `invertMat` đã có; thêm `SpineMeshAttachment` type import từ `./spine-json/types.js`):

```ts
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** World positions + slot-bone context for a mesh (setup pose). */
function meshSetupContext(data: SkeletonData, slotName: string, mesh: SpineMeshAttachment) {
  const slot = data.slots.find((s) => s.name === slotName);
  if (!slot) throw new Error(`Slot "${slotName}" does not exist.`);
  const pose = computeSetupPose(data);
  const boneWorld = pose.get(slot.bone);
  if (!boneWorld) throw new Error(`Bone "${slot.bone}" has no pose.`);
  const count = mesh.uvs.length / 2;
  const world = computeVertexWorldPositions(mesh.vertices, count, boneWorld, data.bones, pose);
  return { pose, boneWorld, count, world };
}

/**
 * Averages weights with triangle-edge neighbors (60% own + 40% neighbor mean
 * per iteration). New influences get bone-local coords from the setup pose.
 */
export function smoothWeights(
  data: SkeletonData,
  slotName: string,
  mesh: SpineMeshAttachment,
  iterations = 1,
): number[] {
  const { pose, count, world } = meshSetupContext(data, slotName, mesh);
  if (!isWeightedVertices(mesh.vertices, count)) throw new Error('Mesh is not weighted.');
  const neighbors: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const tri = [mesh.triangles[t]!, mesh.triangles[t + 1]!, mesh.triangles[t + 2]!];
    for (const a of tri) for (const b of tri) if (a !== b) neighbors[a]?.add(b);
  }
  const invCache = new Map<number, Mat2D>();
  const invFor = (boneIdx: number): Mat2D | null => {
    const cached = invCache.get(boneIdx);
    if (cached) return cached;
    const m = pose.get(data.bones[boneIdx]?.name ?? '');
    if (!m) return null;
    const inv = invertMat(m);
    invCache.set(boneIdx, inv);
    return inv;
  };
  let per = parseInfluences(mesh.vertices, count);
  for (let it = 0; it < iterations; it++) {
    const weightOf = (v: number, bone: number) =>
      per[v]!.find((inf) => inf.bone === bone)?.weight ?? 0;
    const next: Influence[][] = [];
    for (let v = 0; v < count; v++) {
      const bones = new Set(per[v]!.map((inf) => inf.bone));
      for (const n of neighbors[v]!) for (const inf of per[n]!) bones.add(inf.bone);
      const list: Influence[] = [];
      for (const b of bones) {
        const around = [...neighbors[v]!];
        const avg =
          around.length > 0
            ? around.reduce((s, n) => s + weightOf(n, b), 0) / around.length
            : weightOf(v, b);
        const w = 0.6 * weightOf(v, b) + 0.4 * avg;
        if (w <= 0.001) continue;
        const existing = per[v]!.find((inf) => inf.bone === b);
        if (existing) {
          list.push({ ...existing, weight: w });
        } else {
          const inv = invFor(b);
          if (!inv) continue;
          const p = applyMat(inv, world[v * 2]!, world[v * 2 + 1]!);
          list.push({
            bone: b,
            x: Math.round(p.x * 100) / 100,
            y: Math.round(p.y * 100) / 100,
            weight: w,
          });
        }
      }
      const sum = list.reduce((s, inf) => s + inf.weight, 0);
      if (sum > 0) for (const inf of list) inf.weight = round4(inf.weight / sum);
      next.push(list.length > 0 ? list : per[v]!);
    }
    per = next;
  }
  return packInfluences(per);
}

/** Drops influences below `threshold`, caps at `maxInfluences`, renormalizes. */
export function pruneWeights(
  vertices: number[],
  vertexCount: number,
  opts: { maxInfluences?: number; threshold?: number } = {},
): number[] {
  if (!isWeightedVertices(vertices, vertexCount)) throw new Error('Mesh is not weighted.');
  const maxInfluences = opts.maxInfluences ?? 4;
  const threshold = opts.threshold ?? 0.01;
  const per = parseInfluences(vertices, vertexCount);
  const out = per.map((list) => {
    let kept = list.filter((inf) => inf.weight >= threshold);
    kept.sort((a, b) => b.weight - a.weight);
    kept = kept.slice(0, Math.max(1, maxInfluences));
    if (kept.length === 0) {
      const biggest = [...list].sort((a, b) => b.weight - a.weight)[0];
      kept = biggest ? [biggest] : [];
    }
    const sum = kept.reduce((s, inf) => s + inf.weight, 0);
    if (sum > 0) for (const inf of kept) inf.weight = round4(inf.weight / sum);
    return kept;
  });
  return packInfluences(out);
}

/** Exchanges two bones' influence (weights swap; local coords recomputed). */
export function swapWeights(
  data: SkeletonData,
  slotName: string,
  mesh: SpineMeshAttachment,
  boneA: string,
  boneB: string,
): number[] {
  const { pose, count, world } = meshSetupContext(data, slotName, mesh);
  if (!isWeightedVertices(mesh.vertices, count)) throw new Error('Mesh is not weighted.');
  const idxA = data.bones.findIndex((b) => b.name === boneA);
  const idxB = data.bones.findIndex((b) => b.name === boneB);
  if (idxA < 0) throw new Error(`Bone "${boneA}" does not exist.`);
  if (idxB < 0) throw new Error(`Bone "${boneB}" does not exist.`);
  const invA = invertMat(pose.get(boneA)!);
  const invB = invertMat(pose.get(boneB)!);
  const per = parseInfluences(mesh.vertices, count);
  const out = per.map((list, v) => {
    const wA = list.find((inf) => inf.bone === idxA)?.weight ?? 0;
    const wB = list.find((inf) => inf.bone === idxB)?.weight ?? 0;
    const rest = list.filter((inf) => inf.bone !== idxA && inf.bone !== idxB);
    const wx = world[v * 2]!;
    const wy = world[v * 2 + 1]!;
    if (wB > 0) {
      const p = applyMat(invA, wx, wy);
      rest.push({
        bone: idxA,
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
        weight: wB,
      });
    }
    if (wA > 0) {
      const p = applyMat(invB, wx, wy);
      rest.push({
        bone: idxB,
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
        weight: wA,
      });
    }
    return rest;
  });
  return packInfluences(out);
}

/**
 * Unbinds one bone. Vertices it influenced renormalize over their remaining
 * bones; orphaned vertices re-auto-weight over the other bound bones. When it
 * was the only bound bone, returns unweighted slot-bone-space pairs.
 */
export function removeBoneFromWeights(
  data: SkeletonData,
  slotName: string,
  mesh: SpineMeshAttachment,
  boneName: string,
): number[] {
  const { boneWorld, count, world } = meshSetupContext(data, slotName, mesh);
  if (!isWeightedVertices(mesh.vertices, count)) throw new Error('Mesh is not weighted.');
  const idx = data.bones.findIndex((b) => b.name === boneName);
  if (idx < 0) throw new Error(`Bone "${boneName}" does not exist.`);
  const remaining = boundBoneIndices(mesh.vertices, count)
    .filter((i) => i !== idx)
    .map((i) => data.bones[i]?.name)
    .filter((n): n is string => n !== undefined);
  const invSlot = invertMat(boneWorld);
  const localPairs: number[] = [];
  for (let v = 0; v < count; v++) {
    const p = applyMat(invSlot, world[v * 2]!, world[v * 2 + 1]!);
    localPairs.push(Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100);
  }
  if (remaining.length === 0) return localPairs;
  const per = parseInfluences(mesh.vertices, count);
  const out = per.map((list, v) => {
    const kept = list.filter((inf) => inf.bone !== idx);
    if (kept.length === 0) {
      // Orphan: re-bind this vertex over the remaining bones by distance.
      const block = autoWeightVertices(
        data,
        slotName,
        [localPairs[v * 2]!, localPairs[v * 2 + 1]!],
        remaining,
      );
      return parseInfluences(block, 1)[0]!;
    }
    const sum = kept.reduce((s, inf) => s + inf.weight, 0);
    if (sum > 0) for (const inf of kept) inf.weight = round4(inf.weight / sum);
    return kept;
  });
  return packInfluences(out);
}
```

Import cần bổ sung ở đầu weights.ts: `import type { SpineMeshAttachment } from './spine-json/types.js';` và đảm bảo `computeSetupPose`, `invertMat` đã import từ `./pose.js` (đã có).

- [ ] **Step 4: GREEN** — file test rồi full core suite + typecheck.

- [ ] **Step 5: Commit**

```bash
cd /Users/tuananh/Projects/you/spine_editor/client
pnpm exec prettier --write packages/core/src/weights.ts packages/core/test/weights.test.ts
pnpm lint
cd .. && git add client/packages/core
git commit -m "P19: weight ops — smooth, prune, swap, remove-bone with rebind

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Editor mesh tools — modes Create/Delete, Weld/Reset, brush Amount

**Files:**

- Modify: `client/packages/editor/src/state/store.ts` (MeshEditState + actions)
- Modify: `client/packages/editor/src/components/Viewport.tsx` (create/delete click, paintDab amount/replace/shift)
- Modify: `client/packages/editor/src/components/tree/dock/SlotDock.tsx` (MeshToolsRow)
- Modify: `client/packages/editor/src/styles.css`

**Interfaces:**

- Consumes: `addMeshVertex`, `removeMeshVertex`, `weldMeshVertices`, `SetMeshGeometry`, `buildGridMeshAttachment`, `boneWeightPerVertex` (core, Task 1–3).
- Produces: `meshEdit.mode` union mới `'vertices' | 'create' | 'delete' | 'weights'`; `meshEdit.paintAmount: number`, `meshEdit.paintMode: 'add' | 'replace'`; actions `setPaintAmount(n)`, `setPaintMode(m)` — Task 5 dùng.

- [ ] **Step 1: store.ts** — sửa interface + init + actions:

Trong `MeshEditState` (dòng ~90):

```ts
export interface MeshEditState {
  slot: string;
  attachment: string;
  mode: 'vertices' | 'create' | 'delete' | 'weights';
  /** Bone whose weights are shown/painted in weights mode. */
  paintBone: string | null;
  /** Weight-brush strength 0..1 and behavior. */
  paintAmount: number;
  paintMode: 'add' | 'replace';
}
```

Khai báo actions (cạnh `setPaintBone`):

```ts
setPaintAmount(amount: number): void;
setPaintMode(mode: 'add' | 'replace'): void;
```

`startMeshEdit` (dòng ~298) khởi tạo thêm:

```ts
meshEdit: { slot, attachment, mode: 'vertices', paintBone: null, paintAmount: 0.2, paintMode: 'add' },
```

Impl (cạnh `setPaintBone` impl):

```ts
setPaintAmount: (paintAmount) =>
  set((s) => (s.meshEdit ? { meshEdit: { ...s.meshEdit, paintAmount } } : s)),
setPaintMode: (paintMode) =>
  set((s) => (s.meshEdit ? { meshEdit: { ...s.meshEdit, paintMode } } : s)),
```

- [ ] **Step 2: Viewport.tsx — Create/Delete click** — trong `onPointerDown`, NGAY đầu nhánh `if (ctx) {` (trước nhánh weights):

```ts
if (ctx.edit.mode === 'create' || ctx.edit.mode === 'delete') {
  if (state.mode !== 'setup') {
    state.setError('Add/remove mesh vertices in setup mode only.');
    return;
  }
  if (ctx.att.type !== 'mesh') {
    state.setError('Add/remove vertices works on meshes only.');
    return;
  }
  const mesh = ctx.att;
  try {
    let next;
    if (ctx.edit.mode === 'create') {
      const wpt = r.screenToWorld(p.x, p.y);
      const inv = invertMat(ctx.boneWorld);
      const lp = applyMat(inv, wpt.x, wpt.y);
      next = addMeshVertex(state.doc.data, ctx.edit.slot, mesh, lp.x, lp.y);
    } else {
      const positions = editWorldPositions(ctx);
      let best = -1;
      let bestDist = 12;
      for (let v = 0; v < ctx.count; v++) {
        const sp = r.worldToScreen(positions[v * 2]!, positions[v * 2 + 1]!);
        const d = Math.hypot(sp.x - p.x, sp.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = v;
        }
      }
      if (best < 0) return;
      next = removeMeshVertex(state.doc.data, ctx.edit.slot, mesh, best);
    }
    state.execute(
      new SetMeshGeometry('default', ctx.edit.slot, ctx.edit.attachment, {
        vertices: next.vertices,
        uvs: next.uvs,
        triangles: next.triangles,
        hull: next.hull ?? next.uvs.length / 2,
      }),
    );
  } catch (err) {
    state.setError(err instanceof Error ? err.message : String(err));
  }
  return;
}
```

Import thêm ở đầu Viewport.tsx: `addMeshVertex`, `removeMeshVertex`, `SetMeshGeometry`, `boneWeightPerVertex` (từ `@spine-editor/core` — `applyMat`/`invertMat` đã có). Chú ý: `ctx.att.type !== 'mesh'` narrow được vì `att` là union `SpineAttachment`.

- [ ] **Step 3: Viewport.tsx — paintDab amount/replace/shift**:

Đổi chữ ký: `function paintDab(ctx: ..., p: { x: number; y: number }, subtract = false) {`. Thay dòng `const delta = 0.2 * (1 - d / radius);` bằng:

```ts
const st = useEditor.getState();
const amount = st.meshEdit?.paintAmount ?? 0.2;
const mode = st.meshEdit?.paintMode ?? 'add';
const falloff = 1 - d / radius;
const cur = curWeights ? curWeights[v]! : 0;
const delta = mode === 'replace' ? amount * falloff - cur : (subtract ? -1 : 1) * amount * falloff;
```

và TRƯỚC vòng `for (let v = 0; ...)` thêm:

```ts
const curWeights =
  useEditor.getState().meshEdit?.paintMode === 'replace'
    ? boneWeightPerVertex(working, ctx.count, boneIndex)
    : null;
```

(2 lời gọi getState gộp thành 1 biến `st` đặt trước vòng lặp — sắp xếp: `const st = useEditor.getState();` ngay đầu hàm sau các guard, rồi `curWeights` dùng `st.meshEdit?.paintMode`.)

Cập nhật 2 call site: trong `onPointerDown` nhánh weights `paintDab(ctx, p, e.shiftKey)`; trong `onPointerMove` chỗ `kind === 'paint'` → `paintDab(ctx, localPoint(e), e.shiftKey)` (tìm `paintDab(` trong file — đúng 2 chỗ gọi).

- [ ] **Step 4: SlotDock.tsx — MeshToolsRow** — thêm component (trên `WeightsSection`):

```tsx
/** Mode + action row for the mesh being edited (setup-mode geometry tools). */
function MeshToolsRow({ slotName, attName }: { slotName: string; attName: string }) {
  const meshEdit = useEditor((s) => s.meshEdit);
  const mode = useEditor((s) => s.mode);
  const doc = useEditor((s) => s.doc);
  if (!meshEdit) return null;
  const att = doc.data.skins.find((s) => s.name === 'default')?.attachments?.[slotName]?.[attName];
  if (!att || att.type !== 'mesh') return null;
  const setup = mode === 'setup';
  const state = () => useEditor.getState();
  const geometryOf = (m: {
    vertices: number[];
    uvs: number[];
    triangles: number[];
    hull?: number;
  }) => ({
    vertices: m.vertices,
    uvs: m.uvs,
    triangles: m.triangles,
    hull: m.hull ?? m.uvs.length / 2,
  });
  const modes = [
    ['vertices', 'Modify'],
    ['create', 'Create'],
    ['delete', 'Delete'],
    ['weights', 'Weights'],
  ] as const;
  return (
    <div className="mesh-tools">
      {modes.map(([m, label]) => (
        <button
          key={m}
          className={meshEdit.mode === m ? 'active' : ''}
          disabled={!setup && (m === 'create' || m === 'delete')}
          onClick={() => state().setMeshEditMode(m)}
        >
          {label}
        </button>
      ))}
      <button
        disabled={!setup}
        title="Merge vertices closer than 1 unit"
        onClick={() => {
          try {
            const { mesh: welded, merged } = weldMeshVertices(state().doc.data, slotName, att, 1);
            if (merged > 0) {
              state().execute(
                new SetMeshGeometry('default', slotName, attName, geometryOf(welded)),
              );
              state().setError(`Welded ${merged} vertex${merged > 1 ? 'es' : ''}.`);
            }
          } catch (err) {
            state().setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        Weld
      </button>
      <button
        disabled={!setup || !att.width || !att.height}
        title="Replace geometry with a fresh 3×3 grid (clears weights + deform keys)"
        onClick={() => {
          const grid = buildGridMeshAttachment(att.width!, att.height!);
          state().execute(new SetMeshGeometry('default', slotName, attName, geometryOf(grid)));
        }}
      >
        Reset
      </button>
    </div>
  );
}
```

Import thêm vào SlotDock.tsx: `SetMeshGeometry`, `buildGridMeshAttachment`, `weldMeshVertices` từ `@spine-editor/core`.

Render: trong JSX của `AttachmentsSection`, ngay TRƯỚC dòng `{meshEdit?.slot === slotName && (<WeightsSection .../>)}` thêm:

```tsx
{
  meshEdit?.slot === slotName && <MeshToolsRow slotName={slotName} attName={meshEdit.attachment} />;
}
```

- [ ] **Step 5: styles.css** — thêm cuối file:

```css
/* ---- Mesh tools row (P19) ---- */
.mesh-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0;
}
.mesh-tools button.active {
  background: var(--accent-soft);
  border-color: var(--accent);
}
```

- [ ] **Step 6: Verify** — `pnpm typecheck` sạch; `pnpm --filter @spine-editor/editor build` sạch. Manual (tùy chọn): `pnpm --filter @spine-editor/editor dev` — import ảnh, attach, create mesh qua chat/bridge hoặc SlotDock, Edit → Create click thêm vertex, Delete click xóa, undo hoạt động.

- [ ] **Step 7: Commit**

```bash
cd /Users/tuananh/Projects/you/spine_editor/client
pnpm exec prettier --write packages/editor/src/state/store.ts packages/editor/src/components/Viewport.tsx packages/editor/src/components/tree/dock/SlotDock.tsx packages/editor/src/styles.css
pnpm lint
cd .. && git add client/packages/editor
git commit -m "P19: mesh tool row — Create/Delete vertex clicks, Weld, Reset, brush amount plumbing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: WeightsWindow + overlay màu theo bone

**Files:**

- Create: `client/packages/editor/src/components/weight-colors.ts`
- Create: `client/packages/editor/src/components/WeightsWindow.tsx`
- Modify: `client/packages/editor/src/viewport/renderer.ts` (editTarget.weightColors + blend + bone tint)
- Modify: `client/packages/editor/src/components/Viewport.tsx` (truyền weightColors)
- Modify: `client/packages/editor/src/components/Toolbar.tsx` (Views ▾ item + auto-open)
- Modify: `client/packages/editor/src/components/tree/dock/SlotDock.tsx` (WeightsSection rút gọn)
- Modify: `client/packages/editor/src/styles.css`

**Interfaces:**

- Consumes: `boundBoneIndices`, `autoWeightVertices`, `smoothWeights`, `pruneWeights`, `swapWeights`, `removeBoneFromWeights`, `meshLocalPositions`, `boneWeightPerVertex`, `SetAttachmentVertices`, `meshVertexCount`, `isWeightedVertices` (core); store meshEdit + `setPaintAmount`/`setPaintMode` (Task 4).
- Produces: `WEIGHT_COLORS: readonly number[]`; `RenderInput.editTarget.weightColors?: ReadonlyMap<string, number>`.

- [ ] **Step 1: weight-colors.ts**:

```ts
/** Fixed palette for weight overlays: bound bone i → WEIGHT_COLORS[i % length]. */
export const WEIGHT_COLORS: readonly number[] = [
  0xe06c6c, 0x6cc96c, 0x6c9fe0, 0xe0c66c, 0xc66ce0, 0x6cc9c9, 0xe08c4c, 0x9c9ce0,
];
```

- [ ] **Step 2: renderer.ts** — 3 chỗ:

(a) `RenderInput.editTarget` thêm field (sau `weightBone`):

```ts
/** Bound bone → overlay color; blends vertex handles when no heatmap bone is set. */
weightColors?: ReadonlyMap<string, number>;
```

(b) Field instance + set trong `render()`: thêm `private weightTint: ReadonlyMap<string, number> | null = null;` cạnh các field khác (gần `ready = false`), và trong `render(input)` ngay sau dòng `const data = input.bonesOverride ? { ...input.data, bones: input.bonesOverride } : input.data;`:

```ts
this.weightTint = input.editTarget?.weightColors ?? null;
```

Trong `drawBones` đổi dòng `const color = selected ? 0xffcc33 : 0x7fb2e5;` thành:

```ts
const color = selected ? 0xffcc33 : (this.weightTint?.get(bone.name) ?? 0x7fb2e5);
```

(c) `drawOverlays` — sau block `let weights: Float32Array | null = null; if (edit.weightBone) {...}` thêm:

```ts
let blend: Float32Array[] | null = null;
const blendColors: number[] = [];
if (!edit.weightBone && edit.weightColors && isWeightedVertices(vertices, count)) {
  blend = [];
  for (const [boneName, c] of edit.weightColors) {
    const bi = data.bones.findIndex((b) => b.name === boneName);
    if (bi < 0) continue;
    blend.push(boneWeightPerVertex(vertices, count, bi));
    blendColors.push(c);
  }
}
```

và trong vòng vertex, sau `if (weights) { ... }` thêm nhánh:

```ts
else if (blend && blend.length > 0) {
  let rr = 0;
  let gg = 0;
  let bb = 0;
  for (let k = 0; k < blend.length; k++) {
    const w = blend[k]![v]!;
    const c = blendColors[k]!;
    rr += w * ((c >> 16) & 255);
    gg += w * ((c >> 8) & 255);
    bb += w * (c & 255);
  }
  color =
    (Math.min(255, Math.round(rr)) << 16) |
    (Math.min(255, Math.round(gg)) << 8) |
    Math.min(255, Math.round(bb));
}
```

renderer.ts đã import `boneWeightPerVertex` + `isWeightedVertices`? Kiểm tra block import từ `@spine-editor/core` đầu file — `boneWeightPerVertex` đã dùng (heatmap dòng ~592) nên có; thêm `isWeightedVertices` nếu thiếu.

- [ ] **Step 3: Viewport.tsx — truyền weightColors** — thêm helper (cạnh `weightColorMap` chưa có — tạo mới, trên component hoặc trong file, sau imports):

```ts
/** Bound bones → palette colors for the weights overlay (order = boundBoneIndices). */
function weightColorMap(state: ReturnType<typeof useEditor.getState>) {
  const edit = state.meshEdit;
  if (!edit) return undefined;
  const att = state.doc.data.skins.find((s) => s.name === 'default')?.attachments?.[edit.slot]?.[
    edit.attachment
  ];
  if (!att || att.type !== 'mesh') return undefined;
  const count = meshVertexCount(att);
  if (!isWeightedVertices(att.vertices, count)) return undefined;
  const map = new Map<string, number>();
  boundBoneIndices(att.vertices, count).forEach((bi, i) => {
    const name = state.doc.data.bones[bi]?.name;
    if (name) map.set(name, WEIGHT_COLORS[i % WEIGHT_COLORS.length]!);
  });
  return map;
}
```

Trong `buildRenderInput`, mở rộng object `editTarget` (thêm 1 dòng sau `weightBone: ...`):

```ts
weightColors: state.meshEdit.mode === 'weights' ? weightColorMap(state) : undefined,
```

Import thêm: `boundBoneIndices`, `meshVertexCount` (nếu thiếu), `isWeightedVertices` đã có; `WEIGHT_COLORS` từ `./weight-colors.js`.

- [ ] **Step 4: WeightsWindow.tsx** (file mới, đầy đủ):

```tsx
import {
  SetAttachmentVertices,
  autoWeightVertices,
  boneWeightPerVertex,
  boundBoneIndices,
  isWeightedVertices,
  meshLocalPositions,
  meshVertexCount,
  pruneWeights,
  removeBoneFromWeights,
  smoothWeights,
  swapWeights,
} from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store.js';
import { WEIGHT_COLORS } from './weight-colors.js';

const POS_KEY = 'spine-editor.weights-window';

/** Spine-style Weights view: bound-bone palette, Bind/Remove/Swap, Auto/Smooth/Prune. */
export function WeightsWindow({ onClose }: { onClose: () => void }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const meshEdit = useEditor((s) => s.meshEdit);
  const doc = useEditor((s) => s.doc);
  const [session, setSession] = useState<string[]>([]);
  const [influences, setInfluences] = useState(4);
  const [prune, setPrune] = useState(0.01);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [pos, setPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { x: number; y: number };
      if (typeof saved.x === 'number') return saved;
    } catch {
      /* first open */
    }
    return { x: 80, y: 110 };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => localStorage.setItem(POS_KEY, JSON.stringify(pos)), [pos]);
  // Đổi mesh đang edit → reset session/swap.
  const editKey = meshEdit ? `${meshEdit.slot}/${meshEdit.attachment}` : '';
  useEffect(() => {
    setSession([]);
    setSwapFrom(null);
  }, [editKey]);

  const att = meshEdit
    ? doc.data.skins.find((s) => s.name === 'default')?.attachments?.[meshEdit.slot]?.[
        meshEdit.attachment
      ]
    : undefined;
  const mesh = att && att.type === 'mesh' ? att : null;
  const count = mesh ? meshVertexCount(mesh) : 0;
  const weighted = mesh ? isWeightedVertices(mesh.vertices, count) : false;
  const boundNames =
    mesh && weighted
      ? boundBoneIndices(mesh.vertices, count)
          .map((i) => doc.data.bones[i]?.name)
          .filter((n): n is string => n !== undefined)
      : [];
  const listed = [...boundNames, ...session.filter((n) => !boundNames.includes(n))];
  const unlisted = doc.data.bones.map((b) => b.name).filter((n) => !listed.includes(n));

  const run = (fn: () => number[]) => {
    const state = useEditor.getState();
    if (!meshEdit) return;
    try {
      const vertices = fn();
      state.execute(
        new SetAttachmentVertices('default', meshEdit.slot, meshEdit.attachment, vertices),
      );
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pct = (name: string): string => {
    if (!mesh || !weighted || count === 0) return '—';
    const bi = doc.data.bones.findIndex((b) => b.name === name);
    if (bi < 0) return '—';
    const w = boneWeightPerVertex(mesh.vertices, count, bi);
    let sum = 0;
    for (const v of w) sum += v;
    return `${((sum / count) * 100).toFixed(1)}%`;
  };

  return (
    <div className="weights-window" style={{ left: pos.x, top: pos.y }}>
      <div
        className="chat-header"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const { dx, dy } = drag.current;
          setPos({ x: Math.max(0, e.clientX - dx), y: Math.max(0, e.clientY - dy) });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span className="chat-title">Weights</span>
        <button className="close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="weights-body">
        {!mesh || !meshEdit ? (
          <div className="empty">Edit a mesh first (Tree → attachment → Edit).</div>
        ) : (
          <>
            <div className="panel-title">Bones</div>
            {listed.length === 0 && <div className="empty">Bind bones, then Auto.</div>}
            {listed.map((name, i) => (
              <div
                key={name}
                className={`weights-bone ${swapFrom === name ? 'swap-from' : ''}`}
                onClick={() => {
                  if (swapFrom && swapFrom !== name && mesh) {
                    run(() => swapWeights(doc.data, meshEdit.slot, mesh, swapFrom, name));
                    setSwapFrom(null);
                  }
                }}
              >
                <span
                  className="weights-dot"
                  style={{
                    background: `#${WEIGHT_COLORS[i % WEIGHT_COLORS.length]!.toString(16).padStart(6, '0')}`,
                  }}
                />
                <label>
                  <input
                    type="radio"
                    name="weights-paint"
                    checked={meshEdit.paintBone === name}
                    onChange={() => {
                      useEditor.getState().setPaintBone(name);
                      useEditor.getState().setMeshEditMode('weights');
                    }}
                  />
                  {name}
                </label>
                <span className="weights-pct">{pct(name)}</span>
              </div>
            ))}
            <div className="weights-actions">
              <select
                value=""
                title="Bind a bone (then Auto or paint)"
                onChange={(e) => {
                  if (e.target.value) {
                    setSession((prev) => [...prev, e.target.value]);
                    useEditor.getState().setPaintBone(e.target.value);
                  }
                }}
              >
                <option value="">Bind…</option>
                {unlisted.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                disabled={!meshEdit.paintBone || !weighted}
                title="Unbind the selected bone"
                onClick={() => {
                  const bone = meshEdit.paintBone;
                  if (!bone || !mesh) return;
                  run(() => removeBoneFromWeights(doc.data, meshEdit.slot, mesh, bone));
                  setSession((prev) => prev.filter((n) => n !== bone));
                  useEditor.getState().setPaintBone(null);
                }}
              >
                Remove
              </button>
              <button
                disabled={!meshEdit.paintBone || !weighted || listed.length < 2}
                className={swapFrom ? 'active' : ''}
                title="Swap: click this, then click another bone in the list"
                onClick={() => setSwapFrom(swapFrom ? null : meshEdit.paintBone)}
              >
                Swap
              </button>
            </div>
            <div className="weights-actions">
              <button
                disabled={listed.length === 0}
                title="Recompute distance-based weights over the listed bones"
                onClick={() => {
                  if (!mesh) return;
                  run(() =>
                    autoWeightVertices(
                      doc.data,
                      meshEdit.slot,
                      meshLocalPositions(doc.data, meshEdit.slot, mesh),
                      listed,
                      influences,
                    ),
                  );
                }}
              >
                Auto
              </button>
              <button
                disabled={!weighted}
                title="Average weights with neighboring vertices"
                onClick={() => mesh && run(() => smoothWeights(doc.data, meshEdit.slot, mesh, 1))}
              >
                Smooth
              </button>
              <button
                disabled={!weighted}
                title="Drop influences below the threshold"
                onClick={() =>
                  mesh &&
                  run(() =>
                    pruneWeights(mesh.vertices, count, {
                      maxInfluences: influences,
                      threshold: prune,
                    }),
                  )
                }
              >
                Prune
              </button>
            </div>
            <label className="field">
              <span>Influences</span>
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={influences}
                onChange={(e) =>
                  setInfluences(Math.max(1, Math.min(8, Math.round(Number(e.target.value)))))
                }
              />
            </label>
            <label className="field">
              <span>Prune &lt;</span>
              <input
                type="number"
                min={0}
                max={0.5}
                step={0.01}
                value={prune}
                onChange={(e) => setPrune(Math.max(0, Number(e.target.value)))}
              />
            </label>
            <label className="field">
              <span>Amount</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={meshEdit.paintAmount}
                onChange={(e) => useEditor.getState().setPaintAmount(Number(e.target.value))}
              />
            </label>
            <div className="weights-actions">
              {(['add', 'replace'] as const).map((m) => (
                <button
                  key={m}
                  className={meshEdit.paintMode === m ? 'active' : ''}
                  title={m === 'add' ? 'Brush adds weight (Shift subtracts)' : 'Brush sets weight'}
                  onClick={() => useEditor.getState().setPaintMode(m)}
                >
                  {m === 'add' ? 'Add' : 'Replace'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Toolbar.tsx** — import `WeightsWindow`, thêm state + auto-open + Views item + render:

```ts
import { WeightsWindow } from './WeightsWindow.js';
// state (cạnh showPreview/showGhosting):
const [showWeights, setShowWeights] = useState(false);
const meshEditMode = useEditor((s) => s.meshEdit?.mode ?? null);
const hasMeshEdit = meshEditMode !== null;
useEffect(() => {
  if (meshEditMode === 'weights') setShowWeights(true);
}, [meshEditMode]);
```

(Toolbar đã import `useState`; thêm `useEffect` vào import react nếu chưa có. `useEditor` đã import.)

Views ▾ dropdown — thêm sau item Ghosting:

```tsx
<label className="views-item">
  <input
    type="checkbox"
    checked={showWeights}
    disabled={!hasMeshEdit}
    onChange={() => setShowWeights((v) => !v)}
  />
  Weights
</label>
```

Render cạnh các window khác:

```tsx
{
  showWeights && <WeightsWindow onClose={() => setShowWeights(false)} />;
}
```

- [ ] **Step 6: SlotDock.tsx — WeightsSection rút gọn** — thay TOÀN BỘ hàm `WeightsSection` (và xóa `influenceBoneIndices` + các import không còn dùng: `autoWeightVertices`, `useState` nếu không nơi khác dùng):

```tsx
/** Weights status + shortcut to the floating Weights window. */
function WeightsSection({ slotName, attName }: { slotName: string; attName: string }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const doc = useEditor((s) => s.doc);
  const meshEdit = useEditor((s) => s.meshEdit);
  const att = doc.data.skins.find((s) => s.name === 'default')?.attachments?.[slotName]?.[attName];
  if (!att || att.type !== 'mesh' || !meshEdit) return null;
  const weighted = isWeightedVertices(att.vertices, meshVertexCount(att));
  return (
    <>
      <div className="panel-title">Weights</div>
      <div className="empty">
        {weighted
          ? 'Weighted mesh — use the Weights window to paint and adjust.'
          : 'Unweighted — open the Weights window to bind bones.'}
      </div>
      <button onClick={() => useEditor.getState().setMeshEditMode('weights')}>Weights…</button>
    </>
  );
}
```

(Nút set mode `weights` → Toolbar auto-open effect mở window.) Giữ import `meshVertexCount`, `isWeightedVertices`.

- [ ] **Step 7: styles.css** — thêm cuối file:

```css
/* ---- Weights window (P19) ---- */
.weights-window {
  position: fixed;
  z-index: 25;
  width: 260px;
  max-height: 480px;
  display: flex;
  flex-direction: column;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}
.weights-body {
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.weights-bone {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
}
.weights-bone.swap-from {
  outline: 1px solid var(--accent);
}
.weights-bone label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.weights-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.weights-pct {
  color: var(--text-dim);
  font-size: 11px;
}
.weights-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.weights-actions button.active {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.weights-body .field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
}
.weights-body .field input[type='number'] {
  width: 56px;
}
.weights-body .field input[type='range'] {
  width: 110px;
}
```

- [ ] **Step 8: Verify** — `pnpm typecheck` + `pnpm --filter @spine-editor/editor build` + `pnpm test` (editor không có test riêng nhưng suite tổng phải xanh).

- [ ] **Step 9: Commit**

```bash
cd /Users/tuananh/Projects/you/spine_editor/client
pnpm exec prettier --write packages/editor/src
pnpm lint
cd .. && git add client/packages/editor
git commit -m "P19: floating Weights window + per-bone color overlay + brush controls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: MCP — edit_mesh + adjust_weights (61 tools)

**Files:**

- Modify: `client/packages/shared/src/index.ts` (BRIDGE_OPS +2)
- Modify: `client/packages/shared/src/tools.ts` (2 defs; sửa comment "55 editor tools" nếu thấy — cập nhật số thành 61)
- Modify: `client/packages/shared/test/*.test.ts` (count 59 → 61; grep `59`)
- Modify: `client/packages/editor/src/bridge/ops.ts` (2 cases)
- Modify: `client/packages/mcp-server/e2e/bridge.mjs` (bước 9c2 + summary `meshEditWorks`)

**Interfaces:**

- Consumes: core helpers Task 1–3, `SetMeshGeometry`, `SetAttachmentVertices`; helpers ops.ts: `str`, `optNum`, `optStr`, `state()`, `executeOrThrow`.
- Produces: bridge ops `edit_mesh`, `adjust_weights`; TOOL_DEFS length 61.

- [ ] **Step 1: shared/index.ts** — thêm `'edit_mesh', 'adjust_weights',` vào mảng `BRIDGE_OPS` (cạnh `'set_mesh_vertices'`, `'bind_weights'` — tìm trong mảng).

- [ ] **Step 2: shared/tools.ts** — thêm 2 defs ngay sau def `bind_weights` (tìm `'bind_weights'`):

```ts
def(
  'edit_mesh',
  "Edit mesh geometry: add/remove a vertex (automatic Delaunay retriangulation), weld near-duplicate vertices, or reset to a fresh 3x3 grid. Geometry changes clear the mesh's deform keys (one undo step, like Spine). Coordinates are in the slot bone's local space.",
  {
    slot: z.string().describe('Slot whose mesh attachment to edit'),
    attachment: z
      .string()
      .optional()
      .describe('Attachment name (defaults to the active attachment)'),
    action: z.enum(['add_vertex', 'remove_vertex', 'weld', 'reset']),
    x: z.number().optional().describe('add_vertex: local x'),
    y: z.number().optional().describe('add_vertex: local y'),
    vertexIndex: z.number().int().optional().describe('remove_vertex: vertex index to remove'),
    threshold: z.number().optional().describe('weld: merge distance (default 1)'),
  },
),
def(
  'adjust_weights',
  'Weight tools for a mesh: auto (recompute distance-based weights), smooth (average with neighbors), prune (drop small influences), swap (exchange two bones), remove_bone (unbind one bone, re-normalizing the rest).',
  {
    slot: z.string().describe('Slot whose mesh attachment to adjust'),
    attachment: z
      .string()
      .optional()
      .describe('Attachment name (defaults to the active attachment)'),
    action: z.enum(['auto', 'smooth', 'prune', 'swap', 'remove_bone']),
    bones: z
      .array(z.string())
      .optional()
      .describe('auto: bones to bind (defaults to currently bound)'),
    iterations: z.number().int().optional().describe('smooth: passes (default 1)'),
    maxInfluences: z
      .number()
      .int()
      .optional()
      .describe('auto/prune: max bones per vertex (default 4)'),
    threshold: z.number().optional().describe('prune: drop influences below this (default 0.01)'),
    boneA: z.string().optional().describe('swap: first bone'),
    boneB: z.string().optional().describe('swap: second bone'),
    bone: z.string().optional().describe('remove_bone: bone to unbind'),
  },
),
```

Sửa comment đầu file tools.ts: `the 55 editor tools` → `the 61 editor tools` (số hiện tại trong comment có thể là 55/59 — đặt 61).

- [ ] **Step 3: shared test count** — `grep -rn "59" client/packages/shared/test/` → đổi các assertion length 59 thành 61 (và nếu test đếm BRIDGE_OPS, +2).

- [ ] **Step 4: RED** — `pnpm --filter @spine-editor/shared test` phải FAIL trước khi sửa test (count mismatch), PASS sau khi sửa. Chạy thêm `pnpm --filter @spine-editor/mcp-server test` — nếu có assertion count tools, cập nhật tương tự.

- [ ] **Step 5: ops.ts — 2 cases** — thêm sau case `bind_weights` (import bổ sung từ `@spine-editor/core`: `SetMeshGeometry`, `addMeshVertex`, `removeMeshVertex`, `weldMeshVertices`, `meshLocalPositions`, `meshVertexCount`, `boundBoneIndices`, `smoothWeights`, `pruneWeights`, `swapWeights`, `removeBoneFromWeights`, `isWeightedVertices` — `buildGridMeshAttachment`, `autoWeightVertices`, `SetAttachmentVertices` đã có):

```ts
case 'edit_mesh': {
  const s = state();
  const slotName = str(params, 'slot');
  const attName = optStr(params, 'attachment') ?? s.doc.findSlot(slotName)?.attachment ?? undefined;
  if (!attName) throw new Error(`Slot "${slotName}" has no active attachment; pass one.`);
  const att = s.doc.data.skins.find((sk) => sk.name === 'default')?.attachments?.[slotName]?.[
    attName
  ];
  if (!att || att.type !== 'mesh') {
    throw new Error(`Attachment "${attName}" is not a mesh (create_mesh first).`);
  }
  const action = str(params, 'action');
  let next = att;
  let merged = 0;
  if (action === 'add_vertex') {
    const x = optNum(params, 'x');
    const y = optNum(params, 'y');
    if (x === undefined || y === undefined) {
      throw new Error('add_vertex needs "x" and "y" (slot-bone local space).');
    }
    next = addMeshVertex(s.doc.data, slotName, att, x, y);
  } else if (action === 'remove_vertex') {
    const idx = optNum(params, 'vertexIndex');
    if (idx === undefined) throw new Error('remove_vertex needs "vertexIndex".');
    next = removeMeshVertex(s.doc.data, slotName, att, Math.round(idx));
  } else if (action === 'weld') {
    const res = weldMeshVertices(s.doc.data, slotName, att, optNum(params, 'threshold') ?? 1);
    if (res.merged === 0) {
      return { merged: 0, vertexCount: meshVertexCount(att) };
    }
    next = res.mesh;
    merged = res.merged;
  } else if (action === 'reset') {
    if (!att.width || !att.height) throw new Error('Mesh has no width/height; cannot reset.');
    next = buildGridMeshAttachment(att.width, att.height);
  } else {
    throw new Error(`Unknown edit_mesh action "${action}".`);
  }
  executeOrThrow(
    new SetMeshGeometry('default', slotName, attName, {
      vertices: next.vertices,
      uvs: next.uvs,
      triangles: next.triangles,
      hull: next.hull ?? next.uvs.length / 2,
    }),
  );
  return {
    vertexCount: meshVertexCount(next),
    hull: next.hull ?? null,
    triangles: next.triangles.length / 3,
    ...(action === 'weld' ? { merged } : {}),
  };
}

case 'adjust_weights': {
  const s = state();
  const slotName = str(params, 'slot');
  const attName = optStr(params, 'attachment') ?? s.doc.findSlot(slotName)?.attachment ?? undefined;
  if (!attName) throw new Error(`Slot "${slotName}" has no active attachment; pass one.`);
  const att = s.doc.data.skins.find((sk) => sk.name === 'default')?.attachments?.[slotName]?.[
    attName
  ];
  if (!att || att.type !== 'mesh') {
    throw new Error(`Attachment "${attName}" is not a mesh (create_mesh first).`);
  }
  const count = meshVertexCount(att);
  const action = str(params, 'action');
  let vertices: number[];
  if (action === 'auto') {
    const passed = params['bones'];
    const bones =
      Array.isArray(passed) && passed.every((b): b is string => typeof b === 'string')
        ? passed
        : boundBoneIndices(att.vertices, count)
            .map((i) => s.doc.data.bones[i]?.name)
            .filter((n): n is string => n !== undefined);
    if (bones.length === 0) throw new Error('Pass "bones" — the mesh has none bound yet.');
    vertices = autoWeightVertices(
      s.doc.data,
      slotName,
      meshLocalPositions(s.doc.data, slotName, att),
      bones,
      Math.round(optNum(params, 'maxInfluences') ?? 4),
    );
  } else if (action === 'smooth') {
    vertices = smoothWeights(
      s.doc.data,
      slotName,
      att,
      Math.round(optNum(params, 'iterations') ?? 1),
    );
  } else if (action === 'prune') {
    vertices = pruneWeights(att.vertices, count, {
      maxInfluences: Math.round(optNum(params, 'maxInfluences') ?? 4),
      threshold: optNum(params, 'threshold') ?? 0.01,
    });
  } else if (action === 'swap') {
    vertices = swapWeights(s.doc.data, slotName, att, str(params, 'boneA'), str(params, 'boneB'));
  } else if (action === 'remove_bone') {
    vertices = removeBoneFromWeights(s.doc.data, slotName, att, str(params, 'bone'));
  } else {
    throw new Error(`Unknown adjust_weights action "${action}".`);
  }
  executeOrThrow(new SetAttachmentVertices('default', slotName, attName, vertices));
  const after = s.doc.data.skins.find((sk) => sk.name === 'default')?.attachments?.[slotName]?.[
    attName
  ] as { vertices: number[] };
  return {
    weighted: isWeightedVertices(after.vertices, count),
    bones: boundBoneIndices(after.vertices, count)
      .map((i) => s.doc.data.bones[i]?.name)
      .filter((n): n is string => n !== undefined),
  };
}
```

Lưu ý kiểu: biến `next` khởi tạo `= att` để TS không phàn nàn definite assignment; các nhánh đều gán lại hoặc return sớm.

- [ ] **Step 6: typecheck + suites** — `pnpm typecheck && pnpm test` từ `client/` — tất cả xanh (shared 3 với count 61, core, mcp-server 4).

- [ ] **Step 7: bridge.mjs — bước 9c2** — sau dòng `const weightedFlag = ...` thêm:

```js
// 9c2. Mesh geometry + weight tools (Phase 19).
const meshEditRes = await call('edit_mesh', {
  slot: flagSlot.slot,
  action: 'add_vertex',
  x: 7,
  y: 3,
});
const pruneRes = await call('adjust_weights', {
  slot: flagSlot.slot,
  action: 'prune',
  threshold: 0.01,
});
const p19Export = JSON.parse((await call('export_spine_json')).json);
const p19Flag = p19Export.skins?.[0]?.attachments?.[flagSlot.slot]?.flag;
```

Trong object summary (cạnh `rigFromPartsWorks`) thêm:

```js
meshEditWorks:
  meshEditRes.vertexCount === (flagAtts.flag?.uvs?.length ?? 0) / 2 + 1 &&
  pruneRes.weighted === true &&
  (p19Flag?.uvs?.length ?? 0) / 2 === meshEditRes.vertexCount &&
  p19Flag?.vertices?.length !== p19Flag?.uvs?.length,
```

(`flagAtts` lấy từ `phase8Export` — chụp TRƯỚC edit_mesh nên +1 là đúng; flag mesh đã weighted từ 9c nên add_vertex đi nhánh weighted.)

- [ ] **Step 8: Commit**

```bash
cd /Users/tuananh/Projects/you/spine_editor/client
pnpm exec prettier --write packages/shared/src packages/shared/test packages/editor/src/bridge/ops.ts packages/mcp-server/e2e/bridge.mjs
pnpm lint
cd .. && git add client/packages/shared client/packages/editor client/packages/mcp-server
git commit -m "P19: MCP edit_mesh + adjust_weights — 61 tools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E battery + docs

**Files:**

- Modify: `CLAUDE.md`, `PLAN.md`

- [ ] **Step 1: Battery đầy đủ** (theo `.claude/skills/verify/SKILL.md`):

1. `cd client && pnpm build` — sạch.
2. Kill :4173; từ `client/packages/editor`: `pnpm exec vite preview --port 4173` (nền).
3. `CHROMIUM_PATH="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" node e2e/smoke.mjs` → `"issues": []`.
4. `node e2e/anim.mjs` → `"issues": []`.
5. Kill :8017; từ `client/packages/mcp-server`: `node e2e/bridge.mjs` → `toolCount: 61`, `setIkWorks: true`, `rigFromPartsWorks: true`, `presetWalkWorks: true`, **`meshEditWorks: true`**.
6. Server fake (từ `server/`, data dir mới + `SPINE_SERVER_CHAT_FAKE=1 SPINE_SERVER_SEGMENT_FAKE=1`, port 8100); từ `client/packages/editor`: `node e2e/chat.mjs` → `chatRigWorks: true`, `pageErrors: []`.
7. `cd server && uv run pytest -q` → 60 passed, 2 skipped (không đổi).
8. Kill các server nền.

- [ ] **Step 2: Docs**

- `CLAUDE.md`: sau câu Phase 18, thêm: `**Phase 19 done**: mesh vertex add/remove/weld/reset với Delaunay retriangulation ('core/src/mesh-edit.ts', delaunator; 'SetMeshGeometry' xóa deform keys cùng undo step; grid builder xếp hull ring chuẩn Spine), weight ops smooth/prune/swap/remove-bone, cửa sổ Weights nổi (bones palette + %, Bind/Remove/Swap, Auto/Smooth/Prune, brush Amount Add/Replace, overlay màu blend theo bone + bone tint), hàng Mesh tools Modify/Create/Delete/Weights/Weld/Reset (geometry chỉ setup mode), MCP 'edit_mesh' + 'adjust_weights' — **61 MCP tools total**.` và đổi đuôi `Next: PLAN.md §8 phases 19–22.` → `Next: PLAN.md §8 phases 20–22.`
- `PLAN.md`: row 19 → `| **19** | Weights view + Mesh tools — ✅ (07/2026) | ...` (giữ mô tả); dòng §4 (169) đổi ghi chú "Chưa thêm/xóa vertex" → "Phase 19: thêm/xóa/weld vertex + Delaunay retriangulate"; mục §6 (~dòng 239–243) đánh dấu gap add/remove vertex đã đóng (ghi "✅ Phase 19").

- [ ] **Step 3: Format + suites cuối** — `pnpm exec prettier --config .prettierrc.json --write "../CLAUDE.md" "../PLAN.md"` từ client/, `pnpm format:check`, `pnpm test`.

- [ ] **Step 4: Commit**

```bash
cd /Users/tuananh/Projects/you/spine_editor
git add CLAUDE.md PLAN.md
git commit -m "P19: e2e + docs — Phase 19 complete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Final acceptance (spec §6)

- [ ] Core tests mới xanh (mesh-edit + weight ops + SetMeshGeometry); suites + pytest xanh
- [ ] 4 e2e xanh, `toolCount: 61`, `meshEditWorks: true`, không đổi selector cũ
- [ ] Manual: Create/Delete vertex bằng click, Weld/Reset, Weights window bind→auto→paint→smooth→prune, overlay màu
- [ ] Docs cập nhật (CLAUDE.md 61 tools, PLAN.md row 19 ✅ + gap §6 đóng)
