/**
 * Animation evaluator: samples an animation at time t and produces the
 * animated pose (bone locals, world matrices, slot attachments).
 *
 * Phase 3 scope: all bone timelines (rotate/translate/scale/shear + single
 * axis variants) with linear/stepped/bezier curves, plus the slot attachment
 * timeline. Constraints (IK/transform/path/physics), slot colors, deform,
 * draw order and events are preserved in the data but not evaluated yet.
 *
 * Spine timeline semantics: rotate/translate/shear values are OFFSETS added
 * to the setup pose; scale values are FACTORS multiplied with the setup pose.
 */

import type { BoneData, SkeletonData } from './model/types.js';
import { computeSetupPose, type Mat2D } from './pose.js';
import type {
  SpineAnimation,
  SpineAttachmentKey,
  SpineBoneKey,
  SpineCurve,
} from './spine-json/types.js';

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** Solves a cubic bezier segment (x = time axis) for the value at `x`. */
function bezierValue(
  x: number,
  x1: number,
  y1: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x2: number,
  y2: number,
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (cubic(x1, cx1, cx2, x2, t) < x) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return cubic(y1, cy1, cy2, y2, t);
}

function segmentValue(
  time: number,
  t1: number,
  v1: number,
  t2: number,
  v2: number,
  curve: SpineCurve | undefined,
  channel: number,
): number {
  if (curve === 'stepped') return v1;
  if (Array.isArray(curve)) {
    const o = channel * 4;
    const cx1 = curve[o];
    const cy1 = curve[o + 1];
    const cx2 = curve[o + 2];
    const cy2 = curve[o + 3];
    if (cx1 !== undefined && cy1 !== undefined && cx2 !== undefined && cy2 !== undefined) {
      return bezierValue(time, t1, v1, cx1, cy1, cx2, cy2, t2, v2);
    }
  }
  const span = t2 - t1;
  const p = span > 0 ? (time - t1) / span : 0;
  return v1 + (v2 - v1) * p;
}

type NumField = 'value' | 'x' | 'y';

function keyNum(key: SpineBoneKey, field: NumField, dflt: number): number {
  const v = key[field];
  return typeof v === 'number' ? v : dflt;
}

/**
 * Samples a bone timeline. `channel` selects the bezier block within the
 * curve array (0 for single-value and x, 1 for y in two-value timelines).
 */
export function sampleBoneTimeline(
  keys: SpineBoneKey[],
  time: number,
  field: NumField,
  channel: number,
  dflt: number,
): number {
  const first = keys[0];
  if (!first) return dflt;
  if (time <= (first.time ?? 0)) return keyNum(first, field, dflt);
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1]?.time ?? 0) <= time) i++;
  const k1 = keys[i];
  if (!k1) return dflt;
  if (i === keys.length - 1) return keyNum(k1, field, dflt);
  const k2 = keys[i + 1];
  if (!k2) return keyNum(k1, field, dflt);
  return segmentValue(
    time,
    k1.time ?? 0,
    keyNum(k1, field, dflt),
    k2.time ?? 0,
    keyNum(k2, field, dflt),
    k1.curve,
    channel,
  );
}

/** Active attachment for a slot at time t (setup attachment before first key). */
export function sampleAttachment(
  keys: SpineAttachmentKey[],
  time: number,
  setup: string | null,
): string | null {
  let result = setup;
  for (const key of keys) {
    if ((key.time ?? 0) > time) break;
    result = key.name ?? null;
  }
  return result;
}

/** Highest key time reachable anywhere in the animation. */
export function getAnimationDuration(anim: SpineAnimation): number {
  let max = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node !== null && typeof node === 'object') {
      const t = (node as { time?: unknown }).time;
      if (typeof t === 'number' && t > max) max = t;
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(anim);
  return max;
}

/** Bone locals with the animation's bone timelines applied at time t. */
export function computeAnimatedLocals(
  data: SkeletonData,
  animationName: string,
  time: number,
): BoneData[] {
  const anim = data.animations[animationName];
  if (!anim?.bones) return data.bones;
  return data.bones.map((bone) => {
    const tl = anim.bones?.[bone.name];
    if (!tl) return bone;
    const b = { ...bone };
    if (tl.rotate) b.rotation = bone.rotation + sampleBoneTimeline(tl.rotate, time, 'value', 0, 0);
    if (tl.translate) {
      b.x = bone.x + sampleBoneTimeline(tl.translate, time, 'x', 0, 0);
      b.y = bone.y + sampleBoneTimeline(tl.translate, time, 'y', 1, 0);
    }
    if (tl.translatex) b.x = bone.x + sampleBoneTimeline(tl.translatex, time, 'value', 0, 0);
    if (tl.translatey) b.y = bone.y + sampleBoneTimeline(tl.translatey, time, 'value', 0, 0);
    if (tl.scale) {
      b.scaleX = bone.scaleX * sampleBoneTimeline(tl.scale, time, 'x', 0, 1);
      b.scaleY = bone.scaleY * sampleBoneTimeline(tl.scale, time, 'y', 1, 1);
    }
    if (tl.scalex) b.scaleX = bone.scaleX * sampleBoneTimeline(tl.scalex, time, 'value', 0, 1);
    if (tl.scaley) b.scaleY = bone.scaleY * sampleBoneTimeline(tl.scaley, time, 'value', 0, 1);
    if (tl.shear) {
      b.shearX = bone.shearX + sampleBoneTimeline(tl.shear, time, 'x', 0, 0);
      b.shearY = bone.shearY + sampleBoneTimeline(tl.shear, time, 'y', 1, 0);
    }
    if (tl.shearx) b.shearX = bone.shearX + sampleBoneTimeline(tl.shearx, time, 'value', 0, 0);
    if (tl.sheary) b.shearY = bone.shearY + sampleBoneTimeline(tl.sheary, time, 'value', 0, 0);
    return b;
  });
}

/** Slot attachment overrides at time t (only slots with attachment timelines). */
export function computeAnimatedAttachments(
  data: SkeletonData,
  animationName: string,
  time: number,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const anim = data.animations[animationName];
  if (!anim?.slots) return out;
  for (const slot of data.slots) {
    const keys = anim.slots[slot.name]?.attachment;
    if (keys && keys.length > 0) out.set(slot.name, sampleAttachment(keys, time, slot.attachment));
  }
  return out;
}

export interface AnimatedPose {
  locals: BoneData[];
  world: Map<string, Mat2D>;
  attachments: Map<string, string | null>;
}

export function computeAnimatedPose(
  data: SkeletonData,
  animationName: string,
  time: number,
): AnimatedPose {
  const locals = computeAnimatedLocals(data, animationName, time);
  return {
    locals,
    world: computeSetupPose({ ...data, bones: locals }),
    attachments: computeAnimatedAttachments(data, animationName, time),
  };
}
