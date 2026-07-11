/**
 * Parses on-disk Spine JSON (target 4.2) into the internal document model,
 * applying Spine's default values to the rig graph. Skins, events, animations
 * and path/physics constraints are deep-cloned verbatim.
 */

import { SPINE_JSON_TARGET_VERSION } from '@spine-editor/shared';
import type {
  BoneData,
  IkConstraintData,
  SkeletonData,
  SlotData,
  TransformConstraintData,
} from '../model/types.js';
import { validateSkeleton, type ValidationIssue } from '../validate.js';
import type {
  SpineBone,
  SpineIkConstraint,
  SpineJson,
  SpineSlot,
  SpineTransformConstraint,
} from './types.js';

export interface ParseResult {
  data: SkeletonData;
  /** Structural warnings plus referential-integrity issues from validation. */
  issues: ValidationIssue[];
}

function parseBone(json: SpineBone): BoneData {
  const bone: BoneData = {
    name: json.name,
    parent: json.parent ?? null,
    length: json.length ?? 0,
    rotation: json.rotation ?? 0,
    x: json.x ?? 0,
    y: json.y ?? 0,
    scaleX: json.scaleX ?? 1,
    scaleY: json.scaleY ?? 1,
    shearX: json.shearX ?? 0,
    shearY: json.shearY ?? 0,
    inherit: json.inherit ?? 'normal',
    skinRequired: json.skin ?? false,
  };
  if (json.color !== undefined) bone.color = json.color;
  if (json.icon !== undefined) bone.icon = json.icon;
  if (json.visible !== undefined) bone.visible = json.visible;
  return bone;
}

function parseSlot(json: SpineSlot): SlotData {
  const slot: SlotData = {
    name: json.name,
    bone: json.bone,
    color: json.color ?? 'ffffffff',
    dark: json.dark ?? null,
    attachment: json.attachment ?? null,
    blend: json.blend ?? 'normal',
  };
  if (json.visible !== undefined) slot.visible = json.visible;
  return slot;
}

function parseIk(json: SpineIkConstraint): IkConstraintData {
  return {
    name: json.name,
    order: json.order ?? 0,
    skinRequired: json.skin ?? false,
    bones: [...json.bones],
    target: json.target,
    mix: json.mix ?? 1,
    softness: json.softness ?? 0,
    bendPositive: json.bendPositive ?? true,
    compress: json.compress ?? false,
    stretch: json.stretch ?? false,
    uniform: json.uniform ?? false,
  };
}

function parseTransform(json: SpineTransformConstraint): TransformConstraintData {
  const mixX = json.mixX ?? 1;
  const mixScaleX = json.mixScaleX ?? 1;
  return {
    name: json.name,
    order: json.order ?? 0,
    skinRequired: json.skin ?? false,
    bones: [...json.bones],
    target: json.target,
    rotation: json.rotation ?? 0,
    x: json.x ?? 0,
    y: json.y ?? 0,
    scaleX: json.scaleX ?? 0,
    scaleY: json.scaleY ?? 0,
    shearY: json.shearY ?? 0,
    mixRotate: json.mixRotate ?? 1,
    mixX,
    mixY: json.mixY ?? mixX,
    mixScaleX,
    mixScaleY: json.mixScaleY ?? mixScaleX,
    mixShearY: json.mixShearY ?? 1,
    relative: json.relative ?? false,
    local: json.local ?? false,
  };
}

export function parseSpineJson(json: SpineJson): ParseResult {
  const issues: ValidationIssue[] = [];

  const spine = json.skeleton?.spine ?? '';
  if (!spine.startsWith(SPINE_JSON_TARGET_VERSION)) {
    issues.push({
      severity: 'warning',
      path: 'skeleton.spine',
      message: `File version "${spine}" does not match target format ${SPINE_JSON_TARGET_VERSION}; parsing may be lossy.`,
    });
  }

  const data: SkeletonData = {
    meta: {
      spine,
      x: json.skeleton?.x ?? 0,
      y: json.skeleton?.y ?? 0,
      width: json.skeleton?.width ?? 0,
      height: json.skeleton?.height ?? 0,
      images: json.skeleton?.images ?? '',
      audio: json.skeleton?.audio ?? '',
    },
    bones: (json.bones ?? []).map(parseBone),
    slots: (json.slots ?? []).map(parseSlot),
    ik: (json.ik ?? []).map(parseIk),
    transform: (json.transform ?? []).map(parseTransform),
    path: structuredClone(json.path ?? []),
    physics: structuredClone(json.physics ?? []),
    skins: structuredClone(json.skins ?? []),
    events: structuredClone(json.events ?? {}),
    animations: structuredClone(json.animations ?? {}),
  };
  if (json.skeleton?.hash !== undefined) data.meta.hash = json.skeleton.hash;
  if (json.skeleton?.fps !== undefined) data.meta.fps = json.skeleton.fps;

  issues.push(...validateSkeleton(data));
  return { data, issues };
}

export function parseSpineJsonString(text: string): ParseResult {
  return parseSpineJson(JSON.parse(text) as SpineJson);
}
