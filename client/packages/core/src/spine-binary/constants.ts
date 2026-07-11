/**
 * Numeric codes of the .skel format. Codes marked [doc] follow the public
 * binary-format documentation; codes marked [dialect] cover Spine 4.2
 * features the public page does not document — files using them carry the
 * version marker "4.2-se.1" and are read back by our own reader only.
 * [dialect] named-skin names are written inline, not via the strings table.
 */

export const SKEL_VERSION = '4.2-se.1';

export const INHERIT_MODES = [
  'normal', // 0 [doc]
  'onlyTranslation',
  'noRotationOrReflection',
  'noScale',
  'noScaleOrReflection',
] as const;

export const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen'] as const; // [doc]

export const ATTACHMENT_TYPES = [
  'region', // 0 [doc]
  'boundingbox',
  'mesh',
  'linkedmesh',
  'path',
  'point',
  'clipping',
] as const;

export const CURVE_LINEAR = 0; // [doc]
export const CURVE_STEPPED = 1; // [doc]
export const CURVE_BEZIER = 2; // [doc]

// Slot timeline types: 0-2 [doc], 3-5 [dialect] (4.2 timelines).
export const SLOT_TIMELINES = ['attachment', 'rgba', 'rgba2', 'rgb', 'alpha', 'rgb2'] as const;

// Bone timeline types: 0-3 [doc], 4-9 [dialect] (single-axis variants).
export const BONE_TIMELINES = [
  'rotate',
  'translate',
  'scale',
  'shear',
  'translatex',
  'translatey',
  'scalex',
  'scaley',
  'shearx',
  'sheary',
] as const;

// Path constraint timeline types [doc order: position, spacing, mix].
export const PATH_TIMELINES = ['position', 'spacing', 'mix'] as const;

// Physics timelines [dialect] — the public doc has no physics section.
export const PHYSICS_TIMELINES = [
  'inertia',
  'strength',
  'damping',
  'mass',
  'wind',
  'gravity',
  'mix',
  'reset',
] as const;

export const POSITION_MODES = ['fixed', 'percent'] as const; // [doc]
export const SPACING_MODES = ['length', 'fixed', 'percent', 'proportional'] as const; // [doc]
export const ROTATE_MODES = ['tangent', 'chain', 'chainScale'] as const; // [doc]
