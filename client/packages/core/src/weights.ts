/**
 * Vertex/weight helpers shared by the renderer, the mesh-editing UI and the
 * MCP bridge: world positions for any vertex-based attachment, unweighted →
 * weighted conversion with distance-based auto weights, and weight painting.
 *
 * Weighted vertex layout (Spine): for each vertex, a bone count followed by
 * `boneIndex, x, y, weight` per influence, where x,y are in that bone's space.
 */

import type { BoneData, SkeletonData } from './model/types.js';
import { applyMat, computeSetupPose, invertMat, type Mat2D } from './pose.js';
import type { SpineMeshAttachment } from './spine-json/types.js';

export function isWeightedVertices(vertices: number[], vertexCount: number): boolean {
  return vertices.length !== vertexCount * 2;
}

/** Number of x,y vertices in a mesh attachment (uvs define the vertex count). */
export function meshVertexCount(mesh: { uvs: number[] }): number {
  return mesh.uvs.length / 2;
}

/**
 * World-space x,y per vertex for mesh/boundingbox/clipping/path vertices.
 * Unweighted vertices live in the slot bone's space (`boneWorld`); weighted
 * vertices blend per-influence bone spaces. `deform` offsets are added to the
 * local coordinates (per vertex for unweighted, per influence for weighted).
 */
export function computeVertexWorldPositions(
  vertices: number[],
  vertexCount: number,
  boneWorld: Mat2D,
  bones: BoneData[],
  pose: ReadonlyMap<string, Mat2D>,
  deform?: Float32Array,
): Float32Array {
  const out = new Float32Array(vertexCount * 2);
  if (!isWeightedVertices(vertices, vertexCount)) {
    for (let i = 0; i < out.length; i += 2) {
      const p = applyMat(
        boneWorld,
        (vertices[i] ?? 0) + (deform?.[i] ?? 0),
        (vertices[i + 1] ?? 0) + (deform?.[i + 1] ?? 0),
      );
      out[i] = p.x;
      out[i + 1] = p.y;
    }
    return out;
  }
  let vi = 0;
  let di = 0; // deform offsets cover the x,y of each bone influence
  for (let oi = 0; oi < out.length; oi += 2) {
    const count = vertices[vi++] ?? 0;
    let x = 0;
    let y = 0;
    for (let b = 0; b < count; b++) {
      const boneIdx = vertices[vi++] ?? 0;
      const bx = (vertices[vi++] ?? 0) + (deform?.[di] ?? 0);
      const by = (vertices[vi++] ?? 0) + (deform?.[di + 1] ?? 0);
      di += 2;
      const w = vertices[vi++] ?? 0;
      const m = pose.get(bones[boneIdx]?.name ?? '');
      if (!m) continue;
      const p = applyMat(m, bx, by);
      x += p.x * w;
      y += p.y * w;
    }
    out[oi] = x;
    out[oi + 1] = y;
  }
  return out;
}

function distToBone(px: number, py: number, world: Mat2D, length: number): number {
  const ox = world.tx;
  const oy = world.ty;
  if (length <= 0) return Math.hypot(px - ox, py - oy);
  const tip = applyMat(world, length, 0);
  const dx = tip.x - ox;
  const dy = tip.y - oy;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ox) * dx + (py - oy) * dy) / len2)) : 0;
  return Math.hypot(px - (ox + t * dx), py - (oy + t * dy));
}

/**
 * Converts an unweighted vertex array (slot-bone space) to the weighted
 * layout, distributing weights over `boneNames` by inverse squared distance
 * to each bone (segment from origin to tip). Keeps at most `maxInfluences`
 * bones per vertex, normalized to sum 1.
 */
export function autoWeightVertices(
  data: SkeletonData,
  slotName: string,
  vertices: number[],
  boneNames: string[],
  maxInfluences = 4,
): number[] {
  if (boneNames.length === 0) throw new Error('Pass at least one bone to bind.');
  const slot = data.slots.find((s) => s.name === slotName);
  if (!slot) throw new Error(`Slot "${slotName}" does not exist.`);
  const pose = computeSetupPose(data);
  const slotBoneWorld = pose.get(slot.bone);
  if (!slotBoneWorld) throw new Error(`Bone "${slot.bone}" has no pose.`);
  const targets = boneNames.map((name) => {
    const index = data.bones.findIndex((b) => b.name === name);
    const world = pose.get(name);
    if (index < 0 || !world) throw new Error(`Bone "${name}" does not exist.`);
    return { index, world, inv: invertMat(world), length: data.bones[index]!.length };
  });

  const out: number[] = [];
  for (let i = 0; i < vertices.length; i += 2) {
    const p = applyMat(slotBoneWorld, vertices[i] ?? 0, vertices[i + 1] ?? 0);
    const scored = targets
      .map((t) => ({ t, score: 1 / (distToBone(p.x, p.y, t.world, t.length) ** 2 + 1e-4) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxInfluences);
    const total = scored.reduce((sum, s) => sum + s.score, 0);
    out.push(scored.length);
    for (const { t, score } of scored) {
      const local = applyMat(t.inv, p.x, p.y);
      out.push(
        t.index,
        Math.round(local.x * 100) / 100,
        Math.round(local.y * 100) / 100,
        Math.round((score / total) * 10000) / 10000,
      );
    }
  }
  return out;
}

/** Per-vertex weight of one bone (0 where the bone has no influence). */
export function boneWeightPerVertex(
  vertices: number[],
  vertexCount: number,
  boneIndex: number,
): Float32Array {
  const out = new Float32Array(vertexCount);
  if (!isWeightedVertices(vertices, vertexCount)) return out;
  let vi = 0;
  for (let v = 0; v < vertexCount; v++) {
    const count = vertices[vi++] ?? 0;
    for (let b = 0; b < count; b++) {
      const idx = vertices[vi] ?? 0;
      const w = vertices[vi + 3] ?? 0;
      if (idx === boneIndex) out[v] = w;
      vi += 4;
    }
  }
  return out;
}

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

interface Influence {
  bone: number;
  x: number;
  y: number;
  weight: number;
}

function parseInfluences(vertices: number[], vertexCount: number): Influence[][] {
  const out: Influence[][] = [];
  let vi = 0;
  for (let v = 0; v < vertexCount; v++) {
    const count = vertices[vi++] ?? 0;
    const list: Influence[] = [];
    for (let b = 0; b < count; b++) {
      list.push({
        bone: vertices[vi] ?? 0,
        x: vertices[vi + 1] ?? 0,
        y: vertices[vi + 2] ?? 0,
        weight: vertices[vi + 3] ?? 0,
      });
      vi += 4;
    }
    out.push(list);
  }
  return out;
}

function packInfluences(perVertex: Influence[][]): number[] {
  const out: number[] = [];
  for (const list of perVertex) {
    out.push(list.length);
    for (const inf of list) out.push(inf.bone, inf.x, inf.y, inf.weight);
  }
  return out;
}

/**
 * Adjusts one vertex's weight for a bone by `delta`, rescaling the other
 * influences so weights keep summing to 1. When the bone doesn't influence
 * the vertex yet and `delta > 0`, `local` (the vertex position in the bone's
 * space) must be provided so the influence can be added.
 */
export function adjustVertexWeight(
  vertices: number[],
  vertexCount: number,
  vertexIndex: number,
  boneIndex: number,
  delta: number,
  local?: { x: number; y: number },
): number[] {
  if (!isWeightedVertices(vertices, vertexCount)) {
    throw new Error('Vertices are unweighted; bind bones first.');
  }
  const perVertex = parseInfluences(vertices, vertexCount);
  const list = perVertex[vertexIndex];
  if (!list) throw new Error(`Vertex ${vertexIndex} is out of range.`);
  let target = list.find((inf) => inf.bone === boneIndex);
  if (!target) {
    if (delta <= 0) return vertices;
    if (!local) throw new Error('Adding a new influence needs the bone-local position.');
    target = { bone: boneIndex, x: local.x, y: local.y, weight: 0 };
    list.push(target);
  }
  const before = target.weight;
  const after = Math.min(1, Math.max(0, before + delta));
  const othersSum = list.reduce((sum, inf) => (inf === target ? sum : sum + inf.weight), 0);
  const scale = othersSum > 0 ? (1 - after) / othersSum : 0;
  for (const inf of list) {
    if (inf === target) inf.weight = after;
    else inf.weight *= scale;
  }
  if (othersSum <= 0) target.weight = 1; // single influence stays fully bound
  perVertex[vertexIndex] = list.filter((inf) => inf.weight > 0.001);
  const kept = perVertex[vertexIndex]!;
  const sum = kept.reduce((s, inf) => s + inf.weight, 0);
  if (sum > 0) for (const inf of kept) inf.weight = Math.round((inf.weight / sum) * 10000) / 10000;
  return packInfluences(perVertex);
}

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
    const current = per;
    const weightOf = (v: number, bone: number) =>
      current[v]!.find((inf) => inf.bone === bone)?.weight ?? 0;
    const next: Influence[][] = [];
    for (let v = 0; v < count; v++) {
      const bones = new Set(current[v]!.map((inf) => inf.bone));
      for (const n of neighbors[v]!) for (const inf of current[n]!) bones.add(inf.bone);
      const list: Influence[] = [];
      for (const b of bones) {
        const around = [...neighbors[v]!];
        const avg =
          around.length > 0
            ? around.reduce((s, n) => s + weightOf(n, b), 0) / around.length
            : weightOf(v, b);
        const w = 0.6 * weightOf(v, b) + 0.4 * avg;
        if (w <= 0.001) continue;
        const existing = current[v]!.find((inf) => inf.bone === b);
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
      next.push(list.length > 0 ? list : current[v]!);
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
