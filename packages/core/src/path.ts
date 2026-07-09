/**
 * Path constraint evaluation: samples the target slot's path attachment
 * (a composite cubic Bezier) by arc length and pins the constrained bones to
 * it with the constraint's position/spacing/rotate modes and mixes.
 *
 * Approximations vs. the reference runtime (documented): spacing always uses
 * arc length (`constantSpeed: false` is treated as true), and `chainScale`
 * scales bones by world distance along X only.
 */

import type { BoneData, SkeletonData } from './model/types.js';
import {
  applyMat,
  IDENTITY,
  invertMat,
  registerPathConstraintApplier,
  worldRotationOf,
  type Mat2D,
  type PathPoseValue,
} from './pose.js';
import type { SpinePathAttachment, SpinePathConstraint } from './spine-json/types.js';
import { computeVertexWorldPositions } from './weights.js';

const RAD_DEG = 180 / Math.PI;
const SAMPLES_PER_CURVE = 20;

interface Segment {
  p0x: number;
  p0y: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  p1x: number;
  p1y: number;
}

export interface SplinePoint {
  x: number;
  y: number;
  /** Tangent direction in degrees CCW. */
  tangent: number;
}

/** Arc-length parameterized composite Bezier built from world vertices. */
export class PathSpline {
  private readonly segments: Segment[] = [];
  /** Cumulative arc length at each sample; SAMPLES_PER_CURVE per segment. */
  private readonly arc: number[] = [0];
  readonly length: number;

  /**
   * `verts` uses the path attachment layout: per point, handle-in x,y,
   * anchor x,y, handle-out x,y (6 floats per point).
   */
  constructor(verts: ArrayLike<number>, closed: boolean) {
    const points = Math.floor(verts.length / 6);
    const segCount = closed ? points : points - 1;
    for (let i = 0; i < segCount; i++) {
      const a = i;
      const b = (i + 1) % points;
      this.segments.push({
        p0x: verts[a * 6 + 2]!,
        p0y: verts[a * 6 + 3]!,
        c1x: verts[a * 6 + 4]!,
        c1y: verts[a * 6 + 5]!,
        c2x: verts[b * 6]!,
        c2y: verts[b * 6 + 1]!,
        p1x: verts[b * 6 + 2]!,
        p1y: verts[b * 6 + 3]!,
      });
    }
    let total = 0;
    for (const seg of this.segments) {
      let px = seg.p0x;
      let py = seg.p0y;
      for (let s = 1; s <= SAMPLES_PER_CURVE; s++) {
        const p = evalSegment(seg, s / SAMPLES_PER_CURVE);
        total += Math.hypot(p.x - px, p.y - py);
        this.arc.push(total);
        px = p.x;
        py = p.y;
      }
    }
    this.length = total;
  }

  /** Point + tangent at arc length `s` (clamped, or wrapped when `wrap`). */
  at(s: number, wrap: boolean): SplinePoint {
    const L = this.length;
    if (L <= 1e-9 || this.segments.length === 0) {
      const seg = this.segments[0];
      return { x: seg?.p0x ?? 0, y: seg?.p0y ?? 0, tangent: 0 };
    }
    if (wrap) {
      s = ((s % L) + L) % L;
    } else {
      s = Math.min(Math.max(s, 0), L);
    }
    // Binary search the cumulative table.
    let lo = 0;
    let hi = this.arc.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.arc[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    const idx = Math.max(1, lo);
    const s0 = this.arc[idx - 1]!;
    const s1 = this.arc[idx]!;
    const f = s1 - s0 > 1e-9 ? (s - s0) / (s1 - s0) : 0;
    const sampleIdx = idx - 1 + f; // global sample position
    const segIdx = Math.min(Math.floor(sampleIdx / SAMPLES_PER_CURVE), this.segments.length - 1);
    const u = sampleIdx / SAMPLES_PER_CURVE - segIdx;
    const seg = this.segments[segIdx]!;
    const p = evalSegment(seg, u);
    const d = evalSegmentDerivative(seg, u);
    return { x: p.x, y: p.y, tangent: Math.atan2(d.y, d.x) * RAD_DEG };
  }
}

function evalSegment(seg: Segment, t: number): { x: number; y: number } {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * seg.p0x + b1 * seg.c1x + b2 * seg.c2x + b3 * seg.p1x,
    y: b0 * seg.p0y + b1 * seg.c1y + b2 * seg.c2y + b3 * seg.p1y,
  };
}

function evalSegmentDerivative(seg: Segment, t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x:
      3 * u * u * (seg.c1x - seg.p0x) +
      6 * u * t * (seg.c2x - seg.c1x) +
      3 * t * t * (seg.p1x - seg.c2x),
    y:
      3 * u * u * (seg.c1y - seg.p0y) +
      6 * u * t * (seg.c2y - seg.c1y) +
      3 * t * t * (seg.p1y - seg.c2y),
  };
}

/** The path attachment a constraint targets (active first, else any path). */
export function findPathAttachment(
  data: SkeletonData,
  slotName: string,
): SpinePathAttachment | undefined {
  const slot = data.slots.find((s) => s.name === slotName);
  if (!slot) return undefined;
  const candidates: SpinePathAttachment[] = [];
  for (const skin of data.skins) {
    const bySlot = skin.attachments?.[slotName];
    if (!bySlot) continue;
    for (const [name, att] of Object.entries(bySlot)) {
      if (att.type !== 'path') continue;
      if (name === slot.attachment) return att;
      candidates.push(att);
    }
  }
  return candidates[0];
}

function normalizeDeg(a: number): number {
  a %= 360;
  if (a > 180) a -= 360;
  else if (a < -180) a += 360;
  return a;
}

function applyPathConstraint(
  data: SkeletonData,
  work: BoneData[],
  world: Map<string, Mat2D>,
  c: SpinePathConstraint,
  override: PathPoseValue | undefined,
): void {
  const mixRotate = override?.mixRotate ?? c.mixRotate ?? 1;
  const mixX = override?.mixX ?? c.mixX ?? 1;
  const mixY = override?.mixY ?? c.mixY ?? mixX;
  if (mixRotate === 0 && mixX === 0 && mixY === 0) return;
  const att = findPathAttachment(data, c.target);
  const slot = data.slots.find((s) => s.name === c.target);
  if (!att || !slot) return;
  const slotBoneWorld = world.get(slot.bone);
  if (!slotBoneWorld) return;

  const verts = computeVertexWorldPositions(
    att.vertices,
    att.vertexCount,
    slotBoneWorld,
    work,
    world,
  );
  const spline = new PathSpline(verts, att.closed ?? false);
  if (spline.length <= 1e-9) return;

  const bones = c.bones
    .map((name) => ({
      bone: work.find((b) => b.name === name),
      boneWorld: world.get(name),
    }))
    .filter((e): e is { bone: BoneData; boneWorld: Mat2D } => !!e.bone && !!e.boneWorld);
  if (bones.length === 0) return;

  const positionMode = c.positionMode ?? 'percent';
  const spacingMode = c.spacingMode ?? 'length';
  const position = override?.position ?? c.position ?? 0;
  const spacing = override?.spacing ?? c.spacing ?? 0;
  const wrap = att.closed ?? false;

  let s = positionMode === 'percent' ? position * spline.length : position;
  const points: SplinePoint[] = [];
  for (let i = 0; i < bones.length; i++) {
    if (i > 0) {
      const prev = bones[i - 1]!;
      let step: number;
      switch (spacingMode) {
        case 'fixed':
          step = spacing;
          break;
        case 'percent':
          step = spacing * spline.length;
          break;
        case 'proportional':
          step = spline.length / bones.length;
          break;
        default: {
          // 'length': the previous bone's world-scaled length plus spacing.
          const scaleX = Math.hypot(prev.boneWorld.a, prev.boneWorld.c);
          step = prev.bone.length * scaleX + spacing;
        }
      }
      s += step;
    }
    points.push(spline.at(s, wrap));
  }
  // One extra point past the last bone so chain modes can aim/scale it.
  const rotateMode = c.rotateMode ?? 'tangent';
  let tail: SplinePoint | null = null;
  if (rotateMode !== 'tangent') {
    const last = bones[bones.length - 1]!;
    const scaleX = Math.hypot(last.boneWorld.a, last.boneWorld.c);
    tail = spline.at(s + last.bone.length * scaleX + spacing, wrap);
  }

  bones.forEach(({ bone, boneWorld }, i) => {
    const point = points[i]!;
    const parentWorld = (bone.parent !== null ? world.get(bone.parent) : undefined) ?? IDENTITY;
    if (mixX !== 0 || mixY !== 0) {
      const nx = boneWorld.tx + (point.x - boneWorld.tx) * mixX;
      const ny = boneWorld.ty + (point.y - boneWorld.ty) * mixY;
      const local = applyMat(invertMat(parentWorld), nx, ny);
      bone.x = local.x;
      bone.y = local.y;
    }
    if (mixRotate !== 0) {
      let desired: number;
      if (rotateMode === 'tangent') {
        desired = point.tangent + (c.rotation ?? 0);
      } else {
        const next = i + 1 < points.length ? points[i + 1]! : tail!;
        desired = Math.atan2(next.y - point.y, next.x - point.x) * RAD_DEG + (c.rotation ?? 0);
        if (rotateMode === 'chainScale' && bone.length > 0) {
          const span = Math.hypot(next.x - point.x, next.y - point.y);
          const scaleX = Math.hypot(boneWorld.a, boneWorld.c);
          const current = bone.length * scaleX;
          if (current > 1e-6) bone.scaleX *= 1 + (span / current - 1) * mixRotate;
        }
      }
      const current = worldRotationOf(boneWorld);
      bone.rotation += normalizeDeg(desired - current) * mixRotate;
    }
  });
}

registerPathConstraintApplier(applyPathConstraint);
