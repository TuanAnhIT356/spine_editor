import type { BoneData, SlotData } from './types.js';

/** Creates a bone with Spine defaults, overridable via `patch`. */
export function createBone(
  name: string,
  parent: string | null,
  patch: Partial<Omit<BoneData, 'name' | 'parent'>> = {},
): BoneData {
  return {
    name,
    parent,
    length: 0,
    rotation: 0,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    inherit: 'normal',
    skinRequired: false,
    ...patch,
  };
}

/** Creates a slot with Spine defaults, overridable via `patch`. */
export function createSlot(
  name: string,
  bone: string,
  patch: Partial<Omit<SlotData, 'name' | 'bone'>> = {},
): SlotData {
  return {
    name,
    bone,
    color: 'ffffffff',
    dark: null,
    attachment: null,
    blend: 'normal',
    ...patch,
  };
}
