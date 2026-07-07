/**
 * Setup-pose math: computes bone world transforms from local transforms.
 * Used by the viewport for rendering/hit-testing and later by the animation
 * evaluator (Phase 3) and MCP screenshots.
 *
 * Convention: x' = a*x + b*y + tx, y' = c*x + d*y + ty, Y axis up (Spine).
 */

import type { BoneData, SkeletonData, TransformConstraintData } from './model/types.js';

export interface Mat2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

const DEG_RAD = Math.PI / 180;

export const IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** Local transform matrix following Spine's rotation/scale/shear convention. */
export function boneLocalMatrix(
  bone: Pick<BoneData, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY'>,
): Mat2D {
  const rx = (bone.rotation + bone.shearX) * DEG_RAD;
  const ry = (bone.rotation + 90 + bone.shearY) * DEG_RAD;
  return {
    a: Math.cos(rx) * bone.scaleX,
    b: Math.cos(ry) * bone.scaleY,
    c: Math.sin(rx) * bone.scaleX,
    d: Math.sin(ry) * bone.scaleY,
    tx: bone.x,
    ty: bone.y,
  };
}

export function mulMat(p: Mat2D, l: Mat2D): Mat2D {
  return {
    a: p.a * l.a + p.b * l.c,
    b: p.a * l.b + p.b * l.d,
    c: p.c * l.a + p.d * l.c,
    d: p.c * l.b + p.d * l.d,
    tx: p.a * l.tx + p.b * l.ty + p.tx,
    ty: p.c * l.tx + p.d * l.ty + p.ty,
  };
}

export function applyMat(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.b * y + m.tx, y: m.c * x + m.d * y + m.ty };
}

export function invertMat(m: Mat2D): Mat2D {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return { ...IDENTITY };
  const ia = m.d / det;
  const ib = -m.b / det;
  const ic = -m.c / det;
  const id = m.a / det;
  return {
    a: ia,
    b: ib,
    c: ic,
    d: id,
    tx: -(ia * m.tx + ib * m.ty),
    ty: -(ic * m.tx + id * m.ty),
  };
}

/** Applies only the linear part (rotation/scale/shear, no translation). */
export function applyLinear(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.b * y, y: m.c * x + m.d * y };
}

/** World matrices from locals only — no constraints applied. */
function computeWorldRaw(bones: BoneData[]): Map<string, Mat2D> {
  const out = new Map<string, Mat2D>();
  for (const bone of bones) {
    const local = boneLocalMatrix(bone);
    const parent = bone.parent !== null ? out.get(bone.parent) : undefined;
    if (!parent) {
      out.set(bone.name, local);
      continue;
    }
    if (bone.inherit === 'onlyTranslation') {
      const p = applyMat(parent, bone.x, bone.y);
      out.set(bone.name, { ...local, tx: p.x, ty: p.y });
    } else {
      out.set(bone.name, mulMat(parent, local));
    }
  }
  return out;
}

const RAD_DEG = 180 / Math.PI;

function normalizeDeg(a: number): number {
  a %= 360;
  if (a > 180) a -= 360;
  else if (a < -180) a += 360;
  return a;
}

function lerpAngle(from: number, to: number, t: number): number {
  return from + normalizeDeg(to - from) * t;
}

/** Per-constraint values that IK timelines can override at a point in time. */
export interface IkPoseValue {
  mix?: number;
  bendPositive?: boolean;
}

/**
 * Aims a single bone's +X axis at the target (in the bone's parent space).
 * Assumes positive scale and no shear on the chain — a documented
 * approximation of Spine's full solver.
 */
function applyIk1(bone: BoneData, parentWorld: Mat2D, targetWorld: Mat2D, mix: number): void {
  const t = applyMat(invertMat(parentWorld), targetWorld.tx, targetWorld.ty);
  const desired = Math.atan2(t.y - bone.y, t.x - bone.x) * RAD_DEG;
  bone.rotation = lerpAngle(bone.rotation, desired, mix);
}

/**
 * Two-bone IK: rotates parent+child so the child's tip (its `length` along
 * +X) reaches the target, bending CCW when bendPositive. Requires the child
 * to be a direct child of the parent bone.
 */
function applyIk2(
  upper: BoneData,
  lower: BoneData,
  parentWorld: Mat2D,
  targetWorld: Mat2D,
  mix: number,
  bendPositive: boolean,
): void {
  const l1 = Math.hypot(lower.x, lower.y);
  const l2 = lower.length;
  if (l1 === 0 || l2 === 0) {
    applyIk1(upper, parentWorld, targetWorld, mix);
    return;
  }
  const T = applyMat(invertMat(parentWorld), targetWorld.tx, targetWorld.ty);
  const dx = T.x - upper.x;
  const dy = T.y - upper.y;
  const eps = 1e-6;
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(l1 - l2) + eps), l1 + l2 - eps);
  const base = Math.atan2(dy, dx);
  const cos0 = Math.min(1, Math.max(-1, (d * d + l1 * l1 - l2 * l2) / (2 * d * l1)));
  const bendSign = bendPositive ? 1 : -1;
  const upperDir = base + bendSign * Math.acos(cos0);
  // The lower bone's origin sits at angle atan2(lower.y, lower.x) within the
  // upper bone's frame; subtract it so the chain lands on upperDir.
  const upperDesired = upperDir * RAD_DEG - Math.atan2(lower.y, lower.x) * RAD_DEG;
  const lx = upper.x + Math.cos(upperDir) * l1;
  const ly = upper.y + Math.sin(upperDir) * l1;
  const lowerDesired = Math.atan2(T.y - ly, T.x - lx) * RAD_DEG - upperDesired;
  upper.rotation = lerpAngle(upper.rotation, upperDesired, mix);
  lower.rotation = lerpAngle(lower.rotation, lowerDesired, mix);
}

/** Rotation of a world matrix's +X axis in degrees CCW. */
export function worldRotationOf(m: Mat2D): number {
  return Math.atan2(m.c, m.a) * RAD_DEG;
}
const worldRotationDeg = worldRotationOf;

/**
 * Pulls each constrained bone toward the target's world transform, blended by
 * the constraint mixes. Covers the common non-local, non-relative case for
 * rotation, translation and scale; shear mixes and the local/relative flags
 * are not applied (documented approximation).
 */
function applyTransformConstraint(
  work: BoneData[],
  world: Map<string, Mat2D>,
  c: TransformConstraintData,
): void {
  const target = world.get(c.target);
  if (!target) return;
  const targetRot = worldRotationDeg(target);
  const targetScaleX = Math.hypot(target.a, target.c);
  for (const boneName of c.bones) {
    const bone = work.find((b) => b.name === boneName);
    const boneWorld = world.get(boneName);
    if (!bone || !boneWorld) continue;
    const parentWorld = (bone.parent !== null ? world.get(bone.parent) : undefined) ?? IDENTITY;
    if (c.mixRotate !== 0) {
      const current = worldRotationDeg(boneWorld);
      const next = lerpAngle(current, targetRot + c.rotation, c.mixRotate);
      bone.rotation += normalizeDeg(next - current);
    }
    if (c.mixX !== 0 || c.mixY !== 0) {
      const desired = applyMat(target, c.x, c.y);
      const nx = boneWorld.tx + (desired.x - boneWorld.tx) * c.mixX;
      const ny = boneWorld.ty + (desired.y - boneWorld.ty) * c.mixY;
      const local = applyMat(invertMat(parentWorld), nx, ny);
      bone.x = local.x;
      bone.y = local.y;
    }
    if (c.mixScaleX !== 0) {
      const current = Math.hypot(boneWorld.a, boneWorld.c);
      if (current > 1e-9) {
        const next = current + (targetScaleX + c.scaleX - current) * c.mixScaleX;
        bone.scaleX *= next / current;
      }
    }
    if (c.mixScaleY !== 0) {
      const current = Math.hypot(boneWorld.b, boneWorld.d);
      if (current > 1e-9) {
        const targetScaleY = Math.hypot(target.b, target.d);
        const next = current + (targetScaleY + c.scaleY - current) * c.mixScaleY;
        bone.scaleY *= next / current;
      }
    }
  }
}

/**
 * World matrices for every bone with IK and transform constraints applied in
 * `order`. `locals` overrides the setup locals (animated pose); `ikOverrides`
 * carries per-constraint timeline values. Bones must be ordered parents-first.
 * 'normal' and 'onlyTranslation' inherit modes are exact; the remaining modes
 * are approximated as 'normal'. Path and physics constraints are not
 * evaluated (path needs spline sampling, physics a stateful simulation);
 * their data still round-trips to the export.
 */
export function computePose(
  data: SkeletonData,
  locals?: BoneData[],
  ikOverrides?: ReadonlyMap<string, IkPoseValue>,
): Map<string, Mat2D> {
  const work = (locals ?? data.bones).map((b) => ({ ...b }));
  let world = computeWorldRaw(work);
  if (data.ik.length === 0 && data.transform.length === 0) return world;

  type Entry = { order: number; apply: () => void };
  const entries: Entry[] = [];
  for (const c of data.ik) {
    entries.push({
      order: c.order,
      apply: () => {
        const override = ikOverrides?.get(c.name);
        const mix = override?.mix ?? c.mix;
        const bendPositive = override?.bendPositive ?? c.bendPositive;
        if (mix === 0) return;
        const target = world.get(c.target);
        if (!target) return;
        const first = work.find((b) => b.name === c.bones[0]);
        if (!first) return;
        const parentWorld = first.parent !== null ? world.get(first.parent) : undefined;
        if (c.bones.length === 1) {
          applyIk1(first, parentWorld ?? IDENTITY, target, mix);
        } else {
          const second = work.find((b) => b.name === c.bones[1]);
          if (!second || second.parent !== first.name) return;
          applyIk2(first, second, parentWorld ?? IDENTITY, target, mix, bendPositive);
        }
      },
    });
  }
  for (const c of data.transform) {
    entries.push({ order: c.order, apply: () => applyTransformConstraint(work, world, c) });
  }
  entries.sort((a, b) => a.order - b.order);
  for (const entry of entries) {
    entry.apply();
    world = computeWorldRaw(work);
  }
  return world;
}

/**
 * World matrices for every bone in the setup pose, constraints included.
 */
export function computeSetupPose(data: SkeletonData): Map<string, Mat2D> {
  return computePose(data);
}
