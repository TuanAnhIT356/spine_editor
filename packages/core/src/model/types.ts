/**
 * Internal document model the editor operates on.
 *
 * The rig graph (bones, slots, IK and transform constraints) is normalized:
 * every field is present with Spine's default value applied, so editing code
 * never deals with optionals. Path/physics constraints, skins, events and
 * animations are stored verbatim in their JSON format shapes (fully typed in
 * `../spine-json/types.ts`) — this guarantees lossless round-trips while
 * their dedicated editing UIs don't exist yet.
 */

import type {
  SpineAnimation,
  SpineBlendMode,
  SpineEventDef,
  SpineInherit,
  SpinePathConstraint,
  SpinePhysicsConstraint,
  SpineSkin,
} from '../spine-json/types.js';

export interface SkeletonMeta {
  spine: string;
  hash?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fps?: number;
  images: string;
  audio: string;
}

export interface BoneData {
  name: string;
  /** null only for the root bone. */
  parent: string | null;
  length: number;
  rotation: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  inherit: SpineInherit;
  skinRequired: boolean;
  /** Nonessential passthrough. */
  color?: string;
  icon?: string;
  visible?: boolean;
}

export interface SlotData {
  name: string;
  bone: string;
  /** rgba hex, "ffffffff" when untinted. */
  color: string;
  /** Dark tint color, or null when two-color tinting is off. */
  dark: string | null;
  /** Setup-pose attachment name, or null. */
  attachment: string | null;
  blend: SpineBlendMode;
  /** Nonessential passthrough. */
  visible?: boolean;
}

export interface IkConstraintData {
  name: string;
  order: number;
  skinRequired: boolean;
  bones: string[];
  target: string;
  mix: number;
  softness: number;
  bendPositive: boolean;
  compress: boolean;
  stretch: boolean;
  uniform: boolean;
}

export interface TransformConstraintData {
  name: string;
  order: number;
  skinRequired: boolean;
  bones: string[];
  target: string;
  rotation: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  shearY: number;
  mixRotate: number;
  mixX: number;
  mixY: number;
  mixScaleX: number;
  mixScaleY: number;
  mixShearY: number;
  relative: boolean;
  local: boolean;
}

export interface SkeletonData {
  meta: SkeletonMeta;
  bones: BoneData[];
  slots: SlotData[];
  ik: IkConstraintData[];
  transform: TransformConstraintData[];
  /** Stored verbatim (format shape) until dedicated editing lands. */
  path: SpinePathConstraint[];
  physics: SpinePhysicsConstraint[];
  skins: SpineSkin[];
  events: Record<string, SpineEventDef>;
  animations: Record<string, SpineAnimation>;
}
