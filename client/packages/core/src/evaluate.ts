/**
 * Animation evaluator: samples an animation at time t and produces the
 * animated pose (bone locals, world matrices, slot attachments, colors,
 * deforms and draw order).
 *
 * Evaluated: all bone timelines (rotate/translate/scale/shear + single-axis
 * variants) with linear/stepped/bezier curves; slot attachment, rgba and
 * alpha timelines; IK (mix + bendPositive), transform constraints (static
 * mix values) and path constraint position/spacing/mix timelines; mesh
 * deform; draw order. Physics constraints preview via PhysicsSimulator.
 * Not evaluated (data round-trips untouched): events, animated
 * transform-constraint mix timelines, animated physics-property timelines,
 * bone inherit timelines, two-color (rgba2/rgb2) and sequence timelines.
 *
 * Spine timeline semantics: rotate/translate/shear values are OFFSETS added
 * to the setup pose; scale values are FACTORS multiplied with the setup pose.
 */

import type { BoneData, SkeletonData } from './model/types.js';
// Registers the path-constraint applier with pose.ts (import side effect) so
// evaluator users get path constraints even without importing the barrel.
import './path.js';
import { computePose, type IkPoseValue, type Mat2D, type PathPoseValue } from './pose.js';
import type {
  SpineAnimation,
  SpineAttachmentKey,
  SpineBoneKey,
  SpineColorKey,
  SpineCurve,
  SpineDeformKey,
  SpineDrawOrderKey,
  SpineIkKey,
  SpineValueKey,
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

/** Samples an IK timeline: mix interpolates, bendPositive holds per segment. */
export function sampleIkTimeline(keys: SpineIkKey[], time: number): IkPoseValue {
  const first = keys[0];
  if (!first) return {};
  const pick = (k: SpineIkKey): IkPoseValue => {
    const v: IkPoseValue = {};
    if (k.mix !== undefined) v.mix = k.mix;
    if (k.bendPositive !== undefined) v.bendPositive = k.bendPositive;
    return v;
  };
  if (time <= (first.time ?? 0)) return pick(first);
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1]?.time ?? 0) <= time) i++;
  const k1 = keys[i];
  if (!k1) return {};
  if (i === keys.length - 1) return pick(k1);
  const k2 = keys[i + 1];
  if (!k2) return pick(k1);
  const result = pick(k1);
  if (k1.mix !== undefined || k2.mix !== undefined) {
    result.mix = segmentValue(
      time,
      k1.time ?? 0,
      k1.mix ?? 1,
      k2.time ?? 0,
      k2.mix ?? 1,
      k1.curve,
      0,
    );
  }
  return result;
}

/** Per-constraint IK overrides sampled from the animation at time t. */
export function computeAnimatedIk(
  data: SkeletonData,
  animationName: string,
  time: number,
): Map<string, IkPoseValue> {
  const out = new Map<string, IkPoseValue>();
  const anim = data.animations[animationName];
  if (!anim?.ik) return out;
  for (const [name, keys] of Object.entries(anim.ik)) {
    out.set(name, sampleIkTimeline(keys, time));
  }
  return out;
}

/** Per-constraint path values sampled from the animation at time t. */
export function computeAnimatedPath(
  data: SkeletonData,
  animationName: string,
  time: number,
): Map<string, PathPoseValue> {
  const out = new Map<string, PathPoseValue>();
  const anim = data.animations[animationName];
  if (!anim?.path) return out;
  for (const [name, timelines] of Object.entries(anim.path)) {
    const constraint = data.path.find((p) => p.name === name);
    const value: PathPoseValue = {};
    if (timelines.position?.length) {
      value.position = sampleBoneTimeline(
        timelines.position as SpineBoneKey[],
        time,
        'value',
        0,
        constraint?.position ?? 0,
      );
    }
    if (timelines.spacing?.length) {
      value.spacing = sampleBoneTimeline(
        timelines.spacing as SpineBoneKey[],
        time,
        'value',
        0,
        constraint?.spacing ?? 0,
      );
    }
    const mixKeys = timelines.mix;
    if (mixKeys?.length) {
      const asBone = mixKeys as unknown as SpineBoneKey[];
      value.mixRotate = sampleMixChannel(asBone, time, 'mixRotate', 0, constraint?.mixRotate ?? 1);
      value.mixX = sampleMixChannel(asBone, time, 'mixX', 1, constraint?.mixX ?? 1);
      value.mixY = sampleMixChannel(asBone, time, 'mixY', 2, constraint?.mixY ?? value.mixX);
    }
    out.set(name, value);
  }
  return out;
}

/** Samples one named channel of a path mix timeline (bezier block per channel). */
function sampleMixChannel(
  keys: SpineBoneKey[],
  time: number,
  field: string,
  channel: number,
  dflt: number,
): number {
  const first = keys[0];
  if (!first) return dflt;
  const num = (k: SpineBoneKey): number => {
    const v = (k as Record<string, unknown>)[field];
    return typeof v === 'number' ? v : dflt;
  };
  if (time <= (first.time ?? 0)) return num(first);
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1]?.time ?? 0) <= time) i++;
  const k1 = keys[i];
  if (!k1) return dflt;
  const k2 = keys[i + 1];
  if (!k2) return num(k1);
  return segmentValue(time, k1.time ?? 0, num(k1), k2.time ?? 0, num(k2), k1.curve, channel);
}

function hexByte(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0');
}

function parseHex(color: string): [number, number, number, number] {
  const r = parseInt(color.slice(0, 2), 16) / 255;
  const g = parseInt(color.slice(2, 4), 16) / 255;
  const b = parseInt(color.slice(4, 6), 16) / 255;
  const a = color.length >= 8 ? parseInt(color.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

/** Samples an rgba color timeline (per-channel bezier blocks supported). */
export function sampleColorTimeline(keys: SpineColorKey[], time: number, setup: string): string {
  const first = keys[0];
  if (!first) return setup;
  const colorOf = (k: SpineColorKey) => k.color ?? setup;
  if (time <= (first.time ?? 0)) return colorOf(first);
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1]?.time ?? 0) <= time) i++;
  const k1 = keys[i];
  if (!k1) return setup;
  if (i === keys.length - 1) return colorOf(k1);
  const k2 = keys[i + 1];
  if (!k2) return colorOf(k1);
  const c1 = parseHex(colorOf(k1));
  const c2 = parseHex(colorOf(k2));
  const t1 = k1.time ?? 0;
  const t2 = k2.time ?? 0;
  const out = c1.map((v, ch) => segmentValue(time, t1, v, t2, c2[ch] ?? v, k1.curve, ch));
  return out.map(hexByte).join('');
}

/** Final rgba color per slot with color/alpha timelines applied at time t. */
export function computeAnimatedColors(
  data: SkeletonData,
  animationName: string,
  time: number,
): Map<string, string> {
  const out = new Map<string, string>();
  const anim = data.animations[animationName];
  if (!anim?.slots) return out;
  for (const slot of data.slots) {
    const timelines = anim.slots[slot.name];
    if (!timelines?.rgba && !timelines?.alpha) continue;
    let color = slot.color;
    if (timelines.rgba) color = sampleColorTimeline(timelines.rgba, time, slot.color);
    if (timelines.alpha) {
      const alphaKeys: SpineValueKey[] = timelines.alpha;
      const first = alphaKeys[0];
      if (first) {
        const a = sampleBoneTimeline(alphaKeys as SpineBoneKey[], time, 'value', 0, 1);
        color = color.slice(0, 6) + hexByte(a);
      }
    }
    out.set(slot.name, color);
  }
  return out;
}

/**
 * Samples a deform timeline into a full offsets array of `length` floats.
 * Keys store sparse vertex offsets (`offset` = start index); interpolation
 * uses the segment's single curve as a blend factor.
 */
export function sampleDeform(
  keys: SpineDeformKey[],
  time: number,
  length: number,
): Float32Array | undefined {
  const first = keys[0];
  if (!first) return undefined;
  const expand = (k: SpineDeformKey): Float32Array => {
    const out = new Float32Array(length);
    const verts = k.vertices ?? [];
    const start = k.offset ?? 0;
    for (let i = 0; i < verts.length && start + i < length; i++) out[start + i] = verts[i] ?? 0;
    return out;
  };
  if (time <= (first.time ?? 0)) return expand(first);
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1]?.time ?? 0) <= time) i++;
  const k1 = keys[i];
  if (!k1) return undefined;
  if (i === keys.length - 1) return expand(k1);
  const k2 = keys[i + 1];
  if (!k2) return expand(k1);
  const factor = segmentValue(time, k1.time ?? 0, 0, k2.time ?? 0, 1, k1.curve, 0);
  const v1 = expand(k1);
  const v2 = expand(k2);
  for (let j = 0; j < length; j++) v1[j] = (v1[j] ?? 0) + ((v2[j] ?? 0) - (v1[j] ?? 0)) * factor;
  return v1;
}

/**
 * Deform offset arrays per slot/attachment at time t. The needed array length
 * comes from the mesh's vertices (weighted meshes deform the per-influence
 * coordinates, matching Spine's layout).
 */
export function computeAnimatedDeforms(
  data: SkeletonData,
  animationName: string,
  time: number,
): Map<string, Map<string, Float32Array>> {
  const out = new Map<string, Map<string, Float32Array>>();
  const anim = data.animations[animationName];
  if (!anim?.attachments) return out;
  for (const bySlot of Object.values(anim.attachments)) {
    for (const [slotName, byAtt] of Object.entries(bySlot)) {
      for (const [attName, timelines] of Object.entries(byAtt)) {
        if (!timelines.deform?.length) continue;
        let meshLength = 0;
        for (const skin of data.skins) {
          const att = skin.attachments?.[slotName]?.[attName];
          if (att && att.type === 'mesh') {
            // Unweighted: offsets match vertices; weighted: offsets cover the
            // x,y coords per influence (vertices minus count+bone+weight slots).
            meshLength =
              att.vertices.length === att.uvs.length
                ? att.vertices.length
                : (att.vertices.length - att.uvs.length / 2) / 2;
            break;
          }
        }
        if (meshLength <= 0) continue;
        const offsets = sampleDeform(timelines.deform, time, meshLength);
        if (!offsets) continue;
        let slotMap = out.get(slotName);
        if (!slotMap) {
          slotMap = new Map();
          out.set(slotName, slotMap);
        }
        slotMap.set(attName, offsets);
      }
    }
  }
  return out;
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

/**
 * Slot draw order (slot names, back to front) at time t, or undefined when
 * the setup order applies (no timeline, before the first key, or an active
 * key with no offsets). Draw order keys are stepped — no interpolation.
 *
 * Reconstruction matches the runtime: each offset entry places its slot at
 * `setupIndex + offset`; unkeyed slots fill the remaining positions in setup
 * order.
 */
export function computeAnimatedDrawOrder(
  data: SkeletonData,
  animationName: string,
  time: number,
): string[] | undefined {
  const keys = data.animations[animationName]?.drawOrder;
  if (!keys?.length) return undefined;
  let active: SpineDrawOrderKey | undefined;
  for (const key of keys) {
    if ((key.time ?? 0) > time) break;
    active = key;
  }
  if (!active?.offsets?.length) return undefined;
  const n = data.slots.length;
  const setupIndex = new Map(data.slots.map((s, i) => [s.name, i]));
  const entries = active.offsets
    .filter((o) => setupIndex.has(o.slot))
    .sort((a, b) => setupIndex.get(a.slot)! - setupIndex.get(b.slot)!);
  const order = new Array<number>(n).fill(-1);
  const unchanged: number[] = [];
  let originalIndex = 0;
  for (const { slot, offset } of entries) {
    const slotIndex = setupIndex.get(slot)!;
    while (originalIndex < slotIndex) unchanged.push(originalIndex++);
    const target = originalIndex + offset;
    if (target >= 0 && target < n) order[target] = originalIndex;
    else unchanged.push(originalIndex);
    originalIndex++;
  }
  while (originalIndex < n) unchanged.push(originalIndex++);
  for (let i = n - 1; i >= 0; i--) {
    if (order[i] === -1) order[i] = unchanged.pop() ?? -1;
  }
  return order.map((idx) => data.slots[idx]!.name);
}

/**
 * Offsets entry list describing `targetOrder` relative to `setupOrder`
 * (both are slot-name arrays over the same set). Only slots whose position
 * changed are listed, sorted by setup index — the inverse of
 * `computeAnimatedDrawOrder`'s reconstruction for permutations where unkeyed
 * slots keep their relative order.
 */
export function computeDrawOrderOffsets(
  setupOrder: string[],
  targetOrder: string[],
): { slot: string; offset: number }[] {
  const targetIndex = new Map(targetOrder.map((s, i) => [s, i]));
  const offsets: { slot: string; offset: number }[] = [];
  setupOrder.forEach((slot, i) => {
    const t = targetIndex.get(slot);
    if (t !== undefined && t !== i) offsets.push({ slot, offset: t - i });
  });
  return offsets;
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
  colors: Map<string, string>;
  deforms: Map<string, Map<string, Float32Array>>;
}

export function computeAnimatedPose(
  data: SkeletonData,
  animationName: string,
  time: number,
): AnimatedPose {
  const locals = computeAnimatedLocals(data, animationName, time);
  return {
    locals,
    world: computePose(
      data,
      locals,
      computeAnimatedIk(data, animationName, time),
      computeAnimatedPath(data, animationName, time),
    ),
    attachments: computeAnimatedAttachments(data, animationName, time),
    colors: computeAnimatedColors(data, animationName, time),
    deforms: computeAnimatedDeforms(data, animationName, time),
  };
}
