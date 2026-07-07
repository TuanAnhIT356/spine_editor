/**
 * Setup-pose math: computes bone world transforms from local transforms.
 * Used by the viewport for rendering/hit-testing and later by the animation
 * evaluator (Phase 3) and MCP screenshots.
 *
 * Convention: x' = a*x + b*y + tx, y' = c*x + d*y + ty, Y axis up (Spine).
 */

import type { BoneData, SkeletonData } from './model/types.js';

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
 * World matrices for every bone in the setup pose. Bones must be ordered
 * parents-first (enforced by the validator). 'normal' and 'onlyTranslation'
 * inherit modes are exact; the remaining modes are approximated as 'normal'
 * until the full evaluator lands in Phase 3.
 */
export function computeSetupPose(data: SkeletonData): Map<string, Mat2D> {
  const out = new Map<string, Mat2D>();
  for (const bone of data.bones) {
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
