/**
 * Types describing the on-disk Spine JSON format (target version 4.2).
 *
 * Reference: the publicly documented format at
 * http://esotericsoftware.com/spine-json-format
 *
 * These are intentionally minimal for Phase 0 — just enough to type the test
 * fixtures. Phase 1 fleshes them out to full coverage (skins, attachments,
 * constraints, all timeline kinds) alongside the serializer/parser.
 */

export interface SpineSkeletonMeta {
  /** Format version the file was exported for, e.g. "4.2.43". */
  spine: string;
  hash?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  images?: string;
  audio?: string;
}

export interface SpineBone {
  name: string;
  parent?: string;
  length?: number;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  shearX?: number;
  shearY?: number;
}

export interface SpineSlot {
  name: string;
  bone: string;
  attachment?: string;
  color?: string;
  blend?: 'normal' | 'additive' | 'multiply' | 'screen';
}

export interface SpineJson {
  skeleton: SpineSkeletonMeta;
  bones?: SpineBone[];
  slots?: SpineSlot[];
  skins?: unknown[];
  animations?: Record<string, unknown>;
}
