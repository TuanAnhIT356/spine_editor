/**
 * Types describing the on-disk Spine JSON format (target version 4.2).
 *
 * Reference: the publicly documented format at
 * http://esotericsoftware.com/spine-json-format
 *
 * Every field that the format treats as optional (i.e. omitted when equal to
 * its default value in exported files) is optional here. The editor's internal
 * model (`../model/types.ts`) applies defaults for the rig graph; skins,
 * events and animations are stored verbatim in these format shapes.
 */

/** Bezier control values, or 'stepped'. Linear when absent. */
export type SpineCurve = 'stepped' | number[];

export type SpineInherit =
  'normal' | 'onlyTranslation' | 'noRotationOrReflection' | 'noScale' | 'noScaleOrReflection';

export type SpineBlendMode = 'normal' | 'additive' | 'multiply' | 'screen';

export interface SpineSkeletonMeta {
  /** Format version the file was exported for, e.g. "4.2.43". */
  spine: string;
  hash?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fps?: number;
  images?: string;
  audio?: string;
}

export interface SpineBone {
  name: string;
  parent?: string;
  length?: number;
  rotation?: number;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  shearX?: number;
  shearY?: number;
  inherit?: SpineInherit;
  /** True when the bone is only active when a skin requiring it is active. */
  skin?: boolean;
  /** Nonessential (editor-only) data. */
  color?: string;
  icon?: string;
  visible?: boolean;
}

export interface SpineSlot {
  name: string;
  bone: string;
  color?: string;
  dark?: string;
  attachment?: string;
  blend?: SpineBlendMode;
  /** Nonessential. */
  visible?: boolean;
}

export interface SpineIkConstraint {
  name: string;
  order?: number;
  skin?: boolean;
  bones: string[];
  target: string;
  mix?: number;
  softness?: number;
  bendPositive?: boolean;
  compress?: boolean;
  stretch?: boolean;
  uniform?: boolean;
}

export interface SpineTransformConstraint {
  name: string;
  order?: number;
  skin?: boolean;
  bones: string[];
  target: string;
  rotation?: number;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  shearY?: number;
  mixRotate?: number;
  mixX?: number;
  /** Defaults to mixX when omitted. */
  mixY?: number;
  mixScaleX?: number;
  /** Defaults to mixScaleX when omitted. */
  mixScaleY?: number;
  mixShearY?: number;
  relative?: boolean;
  local?: boolean;
}

export interface SpinePathConstraint {
  name: string;
  order?: number;
  skin?: boolean;
  bones: string[];
  /** Target is a SLOT name (the slot must have a path attachment). */
  target: string;
  positionMode?: 'fixed' | 'percent';
  spacingMode?: 'length' | 'fixed' | 'percent' | 'proportional';
  rotateMode?: 'tangent' | 'chain' | 'chainScale';
  rotation?: number;
  position?: number;
  spacing?: number;
  mixRotate?: number;
  mixX?: number;
  mixY?: number;
}

/** Physics constraints are new in Spine 4.2. */
export interface SpinePhysicsConstraint {
  name: string;
  order?: number;
  skin?: boolean;
  bone: string;
  x?: number;
  y?: number;
  rotate?: number;
  scaleX?: number;
  shearX?: number;
  limit?: number;
  fps?: number;
  inertia?: number;
  strength?: number;
  damping?: number;
  mass?: number;
  wind?: number;
  gravity?: number;
  mix?: number;
  inertiaGlobal?: boolean;
  strengthGlobal?: boolean;
  dampingGlobal?: boolean;
  massGlobal?: boolean;
  windGlobal?: boolean;
  gravityGlobal?: boolean;
  mixGlobal?: boolean;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface SpineSequence {
  count: number;
  start?: number;
  digits?: number;
  setup?: number;
}

export interface SpineRegionAttachment {
  /** Omitted in files — 'region' is the default attachment type. */
  type?: 'region';
  name?: string;
  path?: string;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  width?: number;
  height?: number;
  color?: string;
  sequence?: SpineSequence;
}

export interface SpineMeshAttachment {
  type: 'mesh';
  name?: string;
  path?: string;
  uvs: number[];
  triangles: number[];
  /**
   * Unweighted: x,y pairs (uvs.length === vertices.length). Weighted: for each
   * vertex, a bone count followed by boneIndex,x,y,weight per bone.
   */
  vertices: number[];
  hull?: number;
  edges?: number[];
  width?: number;
  height?: number;
  color?: string;
  sequence?: SpineSequence;
}

export interface SpineLinkedMeshAttachment {
  type: 'linkedmesh';
  name?: string;
  path?: string;
  skin?: string;
  parent: string;
  timelines?: boolean;
  width?: number;
  height?: number;
  color?: string;
}

export interface SpineBoundingBoxAttachment {
  type: 'boundingbox';
  vertexCount: number;
  vertices: number[];
  color?: string;
}

export interface SpinePathAttachment {
  type: 'path';
  closed?: boolean;
  constantSpeed?: boolean;
  lengths: number[];
  vertexCount: number;
  vertices: number[];
  color?: string;
}

export interface SpinePointAttachment {
  type: 'point';
  x?: number;
  y?: number;
  rotation?: number;
  color?: string;
}

export interface SpineClippingAttachment {
  type: 'clipping';
  /** Name of the slot where clipping stops. */
  end?: string;
  vertexCount: number;
  vertices: number[];
  color?: string;
}

export type SpineAttachment =
  | SpineRegionAttachment
  | SpineMeshAttachment
  | SpineLinkedMeshAttachment
  | SpineBoundingBoxAttachment
  | SpinePathAttachment
  | SpinePointAttachment
  | SpineClippingAttachment;

export interface SpineSkin {
  name: string;
  /** slot name → attachment name → attachment. */
  attachments?: Record<string, Record<string, SpineAttachment>>;
  /** Bones/constraints required by this skin. */
  bones?: string[];
  ik?: string[];
  transform?: string[];
  path?: string[];
  physics?: string[];
  color?: string;
}

export interface SpineEventDef {
  int?: number;
  float?: number;
  string?: string;
  audio?: string;
  volume?: number;
  balance?: number;
}

// ---------------------------------------------------------------------------
// Animation timelines
// ---------------------------------------------------------------------------

/** Key for all bone timelines: rotate uses `value`, translate/scale/shear use x/y. */
export interface SpineBoneKey {
  time?: number;
  value?: number;
  x?: number;
  y?: number;
  curve?: SpineCurve;
}

export type SpineBoneTimelineName =
  | 'rotate'
  | 'translate'
  | 'translatex'
  | 'translatey'
  | 'scale'
  | 'scalex'
  | 'scaley'
  | 'shear'
  | 'shearx'
  | 'sheary';

export interface SpineInheritKey {
  time?: number;
  inherit?: SpineInherit;
}

export type SpineBoneTimelines = Partial<Record<SpineBoneTimelineName, SpineBoneKey[]>> & {
  inherit?: SpineInheritKey[];
};

export interface SpineAttachmentKey {
  time?: number;
  name?: string | null;
}

export interface SpineColorKey {
  time?: number;
  color?: string;
  curve?: SpineCurve;
}

export interface SpineTwoColorKey {
  time?: number;
  light?: string;
  dark?: string;
  curve?: SpineCurve;
}

/** Generic single-value key (alpha, path position/spacing, physics values…). */
export interface SpineValueKey {
  time?: number;
  value?: number;
  curve?: SpineCurve;
}

export interface SpineSlotTimelines {
  attachment?: SpineAttachmentKey[];
  rgba?: SpineColorKey[];
  rgb?: SpineColorKey[];
  alpha?: SpineValueKey[];
  rgba2?: SpineTwoColorKey[];
  rgb2?: SpineTwoColorKey[];
}

export interface SpineIkKey {
  time?: number;
  mix?: number;
  softness?: number;
  bendPositive?: boolean;
  compress?: boolean;
  stretch?: boolean;
  curve?: SpineCurve;
}

export interface SpineTransformKey {
  time?: number;
  mixRotate?: number;
  mixX?: number;
  mixY?: number;
  mixScaleX?: number;
  mixScaleY?: number;
  mixShearY?: number;
  curve?: SpineCurve;
}

export interface SpinePathMixKey {
  time?: number;
  mixRotate?: number;
  mixX?: number;
  mixY?: number;
  curve?: SpineCurve;
}

export interface SpinePathTimelines {
  position?: SpineValueKey[];
  spacing?: SpineValueKey[];
  mix?: SpinePathMixKey[];
}

export interface SpinePhysicsTimelines {
  inertia?: SpineValueKey[];
  strength?: SpineValueKey[];
  damping?: SpineValueKey[];
  mass?: SpineValueKey[];
  wind?: SpineValueKey[];
  gravity?: SpineValueKey[];
  mix?: SpineValueKey[];
  reset?: { time?: number }[];
}

export interface SpineDeformKey {
  time?: number;
  offset?: number;
  vertices?: number[];
  curve?: SpineCurve;
}

export interface SpineSequenceKey {
  time?: number;
  mode?: 'hold' | 'once' | 'loop' | 'pingpong' | 'onceReverse' | 'loopReverse' | 'pingpongReverse';
  index?: number;
  delay?: number;
}

export interface SpineAttachmentTimelines {
  deform?: SpineDeformKey[];
  sequence?: SpineSequenceKey[];
}

export interface SpineDrawOrderKey {
  time?: number;
  offsets?: { slot: string; offset: number }[];
}

export interface SpineEventKey {
  time?: number;
  name: string;
  int?: number;
  float?: number;
  string?: string;
  volume?: number;
  balance?: number;
}

export interface SpineAnimation {
  bones?: Record<string, SpineBoneTimelines>;
  slots?: Record<string, SpineSlotTimelines>;
  ik?: Record<string, SpineIkKey[]>;
  transform?: Record<string, SpineTransformKey[]>;
  path?: Record<string, SpinePathTimelines>;
  physics?: Record<string, SpinePhysicsTimelines>;
  /** skin name → slot name → attachment name → deform/sequence timelines. */
  attachments?: Record<string, Record<string, Record<string, SpineAttachmentTimelines>>>;
  drawOrder?: SpineDrawOrderKey[];
  events?: SpineEventKey[];
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface SpineJson {
  skeleton: SpineSkeletonMeta;
  bones?: SpineBone[];
  slots?: SpineSlot[];
  ik?: SpineIkConstraint[];
  transform?: SpineTransformConstraint[];
  path?: SpinePathConstraint[];
  physics?: SpinePhysicsConstraint[];
  skins?: SpineSkin[];
  events?: Record<string, SpineEventDef>;
  animations?: Record<string, SpineAnimation>;
}
