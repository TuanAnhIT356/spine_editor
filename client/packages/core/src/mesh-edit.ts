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
