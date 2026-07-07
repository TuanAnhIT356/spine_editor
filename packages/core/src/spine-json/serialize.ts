/**
 * Serializes the internal document model to on-disk Spine JSON (target 4.2).
 *
 * Follows Spine's export conventions: fields equal to their default value are
 * omitted, and top-level sections are omitted when empty. Together with the
 * defaults applied in `parse.ts` this makes parse → serialize a lossless
 * round-trip for canonical files.
 */

import type {
  BoneData,
  IkConstraintData,
  SkeletonData,
  SlotData,
  TransformConstraintData,
} from '../model/types.js';
import type {
  SpineBone,
  SpineIkConstraint,
  SpineJson,
  SpineSkeletonMeta,
  SpineSlot,
  SpineTransformConstraint,
} from './types.js';

function metaToJson(data: SkeletonData): SpineSkeletonMeta {
  const m = data.meta;
  const out: SpineSkeletonMeta = { spine: m.spine };
  if (m.hash !== undefined) out.hash = m.hash;
  if (m.x !== 0) out.x = m.x;
  if (m.y !== 0) out.y = m.y;
  if (m.width !== 0) out.width = m.width;
  if (m.height !== 0) out.height = m.height;
  if (m.fps !== undefined) out.fps = m.fps;
  if (m.images !== '') out.images = m.images;
  if (m.audio !== '') out.audio = m.audio;
  return out;
}

function boneToJson(b: BoneData): SpineBone {
  const out: SpineBone = { name: b.name };
  if (b.parent !== null) out.parent = b.parent;
  if (b.length !== 0) out.length = b.length;
  if (b.rotation !== 0) out.rotation = b.rotation;
  if (b.x !== 0) out.x = b.x;
  if (b.y !== 0) out.y = b.y;
  if (b.scaleX !== 1) out.scaleX = b.scaleX;
  if (b.scaleY !== 1) out.scaleY = b.scaleY;
  if (b.shearX !== 0) out.shearX = b.shearX;
  if (b.shearY !== 0) out.shearY = b.shearY;
  if (b.inherit !== 'normal') out.inherit = b.inherit;
  if (b.skinRequired) out.skin = true;
  if (b.color !== undefined) out.color = b.color;
  if (b.icon !== undefined) out.icon = b.icon;
  if (b.visible !== undefined) out.visible = b.visible;
  return out;
}

function slotToJson(s: SlotData): SpineSlot {
  const out: SpineSlot = { name: s.name, bone: s.bone };
  if (s.color !== 'ffffffff') out.color = s.color;
  if (s.dark !== null) out.dark = s.dark;
  if (s.attachment !== null) out.attachment = s.attachment;
  if (s.blend !== 'normal') out.blend = s.blend;
  if (s.visible !== undefined) out.visible = s.visible;
  return out;
}

function ikToJson(c: IkConstraintData): SpineIkConstraint {
  const out: SpineIkConstraint = { name: c.name, bones: [...c.bones], target: c.target };
  if (c.order !== 0) out.order = c.order;
  if (c.skinRequired) out.skin = true;
  if (c.mix !== 1) out.mix = c.mix;
  if (c.softness !== 0) out.softness = c.softness;
  if (!c.bendPositive) out.bendPositive = false;
  if (c.compress) out.compress = true;
  if (c.stretch) out.stretch = true;
  if (c.uniform) out.uniform = true;
  return out;
}

function transformToJson(c: TransformConstraintData): SpineTransformConstraint {
  const out: SpineTransformConstraint = { name: c.name, bones: [...c.bones], target: c.target };
  if (c.order !== 0) out.order = c.order;
  if (c.skinRequired) out.skin = true;
  if (c.rotation !== 0) out.rotation = c.rotation;
  if (c.x !== 0) out.x = c.x;
  if (c.y !== 0) out.y = c.y;
  if (c.scaleX !== 0) out.scaleX = c.scaleX;
  if (c.scaleY !== 0) out.scaleY = c.scaleY;
  if (c.shearY !== 0) out.shearY = c.shearY;
  if (c.mixRotate !== 1) out.mixRotate = c.mixRotate;
  if (c.mixX !== 1) out.mixX = c.mixX;
  if (c.mixY !== c.mixX) out.mixY = c.mixY;
  if (c.mixScaleX !== 1) out.mixScaleX = c.mixScaleX;
  if (c.mixScaleY !== c.mixScaleX) out.mixScaleY = c.mixScaleY;
  if (c.mixShearY !== 1) out.mixShearY = c.mixShearY;
  if (c.relative) out.relative = true;
  if (c.local) out.local = true;
  return out;
}

export function serializeSpineJson(data: SkeletonData): SpineJson {
  const out: SpineJson = { skeleton: metaToJson(data) };
  if (data.bones.length > 0) out.bones = data.bones.map(boneToJson);
  if (data.slots.length > 0) out.slots = data.slots.map(slotToJson);
  if (data.ik.length > 0) out.ik = data.ik.map(ikToJson);
  if (data.transform.length > 0) out.transform = data.transform.map(transformToJson);
  if (data.path.length > 0) out.path = structuredClone(data.path);
  if (data.physics.length > 0) out.physics = structuredClone(data.physics);
  if (data.skins.length > 0) out.skins = structuredClone(data.skins);
  if (Object.keys(data.events).length > 0) out.events = structuredClone(data.events);
  if (Object.keys(data.animations).length > 0) out.animations = structuredClone(data.animations);
  return out;
}

export function serializeSpineJsonString(
  data: SkeletonData,
  space: string | number = '\t',
): string {
  return JSON.stringify(serializeSpineJson(data), null, space);
}
