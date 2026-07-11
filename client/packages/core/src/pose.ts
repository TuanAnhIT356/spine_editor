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

/**
 * World matrix for one bone honoring its inherit mode, following the
 * reference runtime's Bone.updateWorldTransform:
 * - normal: full parent multiply.
 * - onlyTranslation: local orientation/scale, parent-transformed position.
 * - noRotationOrReflection: parent scale kept, parent rotation/reflection
 *   removed before applying the local transform.
 * - noScale / noScaleOrReflection: parent rotation kept at unit scale;
 *   noScale preserves a parent reflection, noScaleOrReflection drops it.
 */
function boneWorldMatrix(bone: BoneData, parent: Mat2D | undefined): Mat2D {
  const local = boneLocalMatrix(bone);
  if (!parent) return local;
  switch (bone.inherit) {
    case 'onlyTranslation': {
      const p = applyMat(parent, bone.x, bone.y);
      return { ...local, tx: p.x, ty: p.y };
    }
    case 'noRotationOrReflection': {
      const p = applyMat(parent, bone.x, bone.y);
      let pa = parent.a;
      let pb = parent.b;
      let pc = parent.c;
      let pd = parent.d;
      let s = pa * pa + pc * pc;
      let prx: number;
      if (s > 0.0001) {
        s = Math.abs(pa * pd - pb * pc) / s;
        pb = pc * s;
        pd = pa * s;
        prx = Math.atan2(pc, pa) * RAD_DEG;
      } else {
        pa = 0;
        pc = 0;
        prx = 90 - Math.atan2(pd, pb) * RAD_DEG;
      }
      const rx = ((bone.rotation + bone.shearX - prx) / RAD_DEG) as number;
      const ry = (bone.rotation + 90 + bone.shearY - prx) / RAD_DEG;
      const la = Math.cos(rx) * bone.scaleX;
      const lb = Math.cos(ry) * bone.scaleY;
      const lc = Math.sin(rx) * bone.scaleX;
      const ld = Math.sin(ry) * bone.scaleY;
      return {
        a: pa * la - pb * lc,
        b: pa * lb - pb * ld,
        c: pc * la + pd * lc,
        d: pc * lb + pd * ld,
        tx: p.x,
        ty: p.y,
      };
    }
    case 'noScale':
    case 'noScaleOrReflection': {
      const p = applyMat(parent, bone.x, bone.y);
      const r = bone.rotation / RAD_DEG;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      let za = parent.a * cos + parent.b * sin;
      let zc = parent.c * cos + parent.d * sin;
      let s = Math.hypot(za, zc);
      if (s > 1e-5) s = 1 / s;
      za *= s;
      zc *= s;
      s = 1;
      if (bone.inherit === 'noScale' && parent.a * parent.d - parent.b * parent.c < 0) s = -1;
      const r2 = Math.PI / 2 + Math.atan2(zc, za);
      const zb = Math.cos(r2) * s;
      const zd = Math.sin(r2) * s;
      const la = Math.cos((bone.shearX / RAD_DEG) as number) * bone.scaleX;
      const lb = Math.cos((90 + bone.shearY) / RAD_DEG) * bone.scaleY;
      const lc = Math.sin(bone.shearX / RAD_DEG) * bone.scaleX;
      const ld = Math.sin((90 + bone.shearY) / RAD_DEG) * bone.scaleY;
      return {
        a: za * la + zb * lc,
        b: za * lb + zb * ld,
        c: zc * la + zd * lc,
        d: zc * lb + zd * ld,
        tx: p.x,
        ty: p.y,
      };
    }
    default:
      return mulMat(parent, local);
  }
}

/** World matrices from locals only — no constraints applied. */
function computeWorldRaw(bones: BoneData[]): Map<string, Mat2D> {
  const out = new Map<string, Mat2D>();
  for (const bone of bones) {
    const parent = bone.parent !== null ? out.get(bone.parent) : undefined;
    out.set(bone.name, boneWorldMatrix(bone, parent));
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

/** Options mirroring the IK constraint fields beyond mix/bend. */
interface IkOptions {
  compress: boolean;
  stretch: boolean;
  uniform: boolean;
  softness: number;
}

/**
 * Aims a single bone's +X axis at the target (in the bone's parent space).
 * compress/stretch scale the bone along X (and Y with uniform) so its
 * `length` lands on the target. Assumes no shear on the chain — a documented
 * approximation of Spine's full solver.
 */
function applyIk1(
  bone: BoneData,
  parentWorld: Mat2D,
  targetWorld: Mat2D,
  mix: number,
  opts: IkOptions,
): void {
  const t = applyMat(invertMat(parentWorld), targetWorld.tx, targetWorld.ty);
  const desired = Math.atan2(t.y - bone.y, t.x - bone.x) * RAD_DEG;
  bone.rotation = lerpAngle(bone.rotation, desired, mix);
  if ((opts.compress || opts.stretch) && bone.length > 0) {
    const reach = bone.length * Math.abs(bone.scaleX);
    const dd = Math.hypot(t.x - bone.x, t.y - bone.y);
    if (reach > 1e-4 && ((opts.compress && dd < reach) || (opts.stretch && dd > reach))) {
      const s = (dd / reach - 1) * mix + 1;
      bone.scaleX *= s;
      if (opts.uniform) bone.scaleY *= s;
    }
  }
}

/**
 * Two-bone IK: rotates parent+child so the child's tip (its `length` along
 * +X) reaches the target, bending CCW when bendPositive. `softness` eases the
 * approach to full extension (the runtime's soft IK); `stretch` scales the
 * chain when the target lies beyond reach. Requires the child to be a direct
 * child of the parent bone.
 */
function applyIk2(
  upper: BoneData,
  lower: BoneData,
  parentWorld: Mat2D,
  targetWorld: Mat2D,
  mix: number,
  bendPositive: boolean,
  opts: IkOptions,
): void {
  const l1 = Math.hypot(lower.x, lower.y);
  const l2 = lower.length;
  if (l1 === 0 || l2 === 0) {
    applyIk1(upper, parentWorld, targetWorld, mix, opts);
    return;
  }
  const T = applyMat(invertMat(parentWorld), targetWorld.tx, targetWorld.ty);
  let dx = T.x - upper.x;
  let dy = T.y - upper.y;
  let dist = Math.hypot(dx, dy);

  // Soft IK: as the target nears full extension, pull it back smoothly so the
  // chain straightens gradually instead of snapping (mirrors the runtime).
  const softness = opts.softness;
  if (softness > 0) {
    const sd = dist - (l1 + l2) + softness;
    if (sd > 0) {
      let p = Math.min(1, sd / (softness * 2)) - 1;
      p = (sd - softness * (1 - p * p)) / dist;
      dx -= p * dx;
      dy -= p * dy;
      dist = Math.hypot(dx, dy);
    }
  }

  // Stretch: scale the chain so it can reach beyond l1+l2.
  let stretchScale = 1;
  if (opts.stretch && dist > l1 + l2 && l1 + l2 > 1e-4) {
    stretchScale = ((dist / (l1 + l2) - 1) * mix + 1) as number;
  }
  const sl1 = l1 * stretchScale;
  const sl2 = l2 * stretchScale;

  const eps = 1e-6;
  const d = Math.min(Math.max(dist, Math.abs(sl1 - sl2) + eps), sl1 + sl2 - eps);
  const base = Math.atan2(dy, dx);
  const cos0 = Math.min(1, Math.max(-1, (d * d + sl1 * sl1 - sl2 * sl2) / (2 * d * sl1)));
  const bendSign = bendPositive ? 1 : -1;
  const upperDir = base + bendSign * Math.acos(cos0);
  // The lower bone's origin sits at angle atan2(lower.y, lower.x) within the
  // upper bone's frame; subtract it so the chain lands on upperDir.
  const upperDesired = upperDir * RAD_DEG - Math.atan2(lower.y, lower.x) * RAD_DEG;
  const lx = upper.x + Math.cos(upperDir) * sl1;
  const ly = upper.y + Math.sin(upperDir) * sl1;
  const targetX = upper.x + dx;
  const targetY = upper.y + dy;
  const lowerDesired = Math.atan2(targetY - ly, targetX - lx) * RAD_DEG - upperDesired;
  upper.rotation = lerpAngle(upper.rotation, upperDesired, mix);
  lower.rotation = lerpAngle(lower.rotation, lowerDesired, mix);
  // Scaling only the upper bone stretches the whole chain: the lower bone
  // inherits the scale, so its world length grows by the same factor.
  if (stretchScale !== 1) upper.scaleX *= stretchScale;
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

/** Per-constraint values that path timelines can override at a point in time. */
export interface PathPoseValue {
  position?: number;
  spacing?: number;
  mixRotate?: number;
  mixX?: number;
  mixY?: number;
}

/**
 * Applier for path constraints, injected by path.ts to avoid a module cycle
 * (path sampling needs vertex math which lives outside this module).
 */
export type PathConstraintApplier = (
  data: SkeletonData,
  work: BoneData[],
  world: Map<string, Mat2D>,
  constraint: SkeletonData['path'][number],
  override: PathPoseValue | undefined,
) => void;

let pathApplier: PathConstraintApplier | null = null;

/**
 * Registered once by path.ts at module load (import side effect; evaluate.ts
 * and index.ts both import path.js). Callers that deep-import computePose
 * without pulling in path.js get path constraints silently skipped — import
 * the barrel or path.js explicitly.
 */
export function registerPathConstraintApplier(fn: PathConstraintApplier): void {
  pathApplier = fn;
}

/**
 * World matrices for every bone with IK, transform and path constraints
 * applied in `order`. `locals` overrides the setup locals (animated pose);
 * `ikOverrides`/`pathOverrides` carry per-constraint timeline values. Bones
 * must be ordered parents-first. All five inherit modes are honored. Physics
 * constraints are simulated separately (see PhysicsSimulator) since they are
 * stateful; their data still round-trips to the export.
 */
export function computePose(
  data: SkeletonData,
  locals?: BoneData[],
  ikOverrides?: ReadonlyMap<string, IkPoseValue>,
  pathOverrides?: ReadonlyMap<string, PathPoseValue>,
): Map<string, Mat2D> {
  const work = (locals ?? data.bones).map((b) => ({ ...b }));
  let world = computeWorldRaw(work);
  const pathCount = pathApplier ? data.path.length : 0;
  if (data.ik.length === 0 && data.transform.length === 0 && pathCount === 0) return world;

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
        const opts: IkOptions = {
          compress: c.compress,
          stretch: c.stretch,
          uniform: c.uniform,
          softness: c.softness,
        };
        if (c.bones.length === 1) {
          applyIk1(first, parentWorld ?? IDENTITY, target, mix, opts);
        } else {
          const second = work.find((b) => b.name === c.bones[1]);
          if (!second || second.parent !== first.name) return;
          applyIk2(first, second, parentWorld ?? IDENTITY, target, mix, bendPositive, opts);
        }
      },
    });
  }
  for (const c of data.transform) {
    entries.push({ order: c.order, apply: () => applyTransformConstraint(work, world, c) });
  }
  if (pathApplier) {
    for (const c of data.path) {
      entries.push({
        order: c.order ?? 0,
        apply: () => pathApplier!(data, work, world, c, pathOverrides?.get(c.name)),
      });
    }
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
