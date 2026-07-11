/**
 * Referential-integrity validation for the document model. Run before export
 * and after parse; errors mean the file will not load correctly in a runtime.
 */

import type { SkeletonData } from './model/types.js';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  /** Dotted location, e.g. "slots[2].bone" or "animations.walk.bones.hip". */
  path: string;
  message: string;
}

export function validateSkeleton(data: SkeletonData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) =>
    issues.push({ severity: 'error', path, message });
  const warning = (path: string, message: string) =>
    issues.push({ severity: 'warning', path, message });

  const boneNames = new Set<string>();
  const boneIndex = new Map<string, number>();
  data.bones.forEach((bone, i) => {
    if (boneNames.has(bone.name)) error(`bones[${i}]`, `Duplicate bone name "${bone.name}".`);
    boneNames.add(bone.name);
    boneIndex.set(bone.name, i);
  });
  data.bones.forEach((bone, i) => {
    if (bone.parent === null) {
      if (i !== 0)
        warning(
          `bones[${i}]`,
          `Bone "${bone.name}" has no parent but is not first; Spine expects a single root bone.`,
        );
      return;
    }
    const parentIdx = boneIndex.get(bone.parent);
    if (parentIdx === undefined) {
      error(
        `bones[${i}].parent`,
        `Bone "${bone.name}" references missing parent "${bone.parent}".`,
      );
    } else if (parentIdx >= i) {
      error(
        `bones[${i}].parent`,
        `Bone "${bone.name}" must come after its parent "${bone.parent}".`,
      );
    }
  });

  const slotNames = new Set<string>();
  data.slots.forEach((slot, i) => {
    if (slotNames.has(slot.name)) error(`slots[${i}]`, `Duplicate slot name "${slot.name}".`);
    slotNames.add(slot.name);
    if (!boneNames.has(slot.bone)) {
      error(`slots[${i}].bone`, `Slot "${slot.name}" references missing bone "${slot.bone}".`);
    }
  });

  const requireBones = (names: string[], path: string) => {
    for (const name of names) {
      if (!boneNames.has(name)) error(path, `References missing bone "${name}".`);
    }
  };

  const ikNames = new Set<string>();
  data.ik.forEach((c, i) => {
    if (ikNames.has(c.name)) error(`ik[${i}]`, `Duplicate IK constraint name "${c.name}".`);
    ikNames.add(c.name);
    requireBones(c.bones, `ik[${i}].bones`);
    requireBones([c.target], `ik[${i}].target`);
    if (c.bones.length < 1 || c.bones.length > 2) {
      error(
        `ik[${i}].bones`,
        `IK constraint "${c.name}" must have 1 or 2 bones, has ${c.bones.length}.`,
      );
    }
  });

  const transformNames = new Set<string>();
  data.transform.forEach((c, i) => {
    if (transformNames.has(c.name))
      error(`transform[${i}]`, `Duplicate transform constraint name "${c.name}".`);
    transformNames.add(c.name);
    requireBones(c.bones, `transform[${i}].bones`);
    requireBones([c.target], `transform[${i}].target`);
  });

  const pathNames = new Set<string>();
  data.path.forEach((c, i) => {
    pathNames.add(c.name);
    requireBones(c.bones ?? [], `path[${i}].bones`);
    if (!slotNames.has(c.target)) {
      error(
        `path[${i}].target`,
        `Path constraint "${c.name}" references missing slot "${c.target}".`,
      );
    }
  });

  const physicsNames = new Set<string>();
  data.physics.forEach((c, i) => {
    physicsNames.add(c.name);
    if (!boneNames.has(c.bone)) {
      error(
        `physics[${i}].bone`,
        `Physics constraint "${c.name}" references missing bone "${c.bone}".`,
      );
    }
  });

  data.skins.forEach((skin, i) => {
    for (const slotName of Object.keys(skin.attachments ?? {})) {
      if (!slotNames.has(slotName)) {
        error(
          `skins[${i}].attachments.${slotName}`,
          `Skin "${skin.name}" has attachments for missing slot "${slotName}".`,
        );
      }
    }
    requireBones(skin.bones ?? [], `skins[${i}].bones`);
  });

  for (const [animName, anim] of Object.entries(data.animations)) {
    const base = `animations.${animName}`;
    for (const boneName of Object.keys(anim.bones ?? {})) {
      if (!boneNames.has(boneName))
        error(`${base}.bones.${boneName}`, `Timeline targets missing bone "${boneName}".`);
    }
    for (const slotName of Object.keys(anim.slots ?? {})) {
      if (!slotNames.has(slotName))
        error(`${base}.slots.${slotName}`, `Timeline targets missing slot "${slotName}".`);
    }
    for (const name of Object.keys(anim.ik ?? {})) {
      if (!ikNames.has(name))
        error(`${base}.ik.${name}`, `Timeline targets missing IK constraint "${name}".`);
    }
    for (const name of Object.keys(anim.transform ?? {})) {
      if (!transformNames.has(name))
        error(
          `${base}.transform.${name}`,
          `Timeline targets missing transform constraint "${name}".`,
        );
    }
    for (const name of Object.keys(anim.path ?? {})) {
      if (!pathNames.has(name))
        error(`${base}.path.${name}`, `Timeline targets missing path constraint "${name}".`);
    }
    for (const name of Object.keys(anim.physics ?? {})) {
      if (!physicsNames.has(name))
        error(`${base}.physics.${name}`, `Timeline targets missing physics constraint "${name}".`);
    }
    (anim.drawOrder ?? []).forEach((key, i) => {
      for (const offset of key.offsets ?? []) {
        if (!slotNames.has(offset.slot)) {
          error(
            `${base}.drawOrder[${i}]`,
            `Draw order offset targets missing slot "${offset.slot}".`,
          );
        }
      }
    });
    (anim.events ?? []).forEach((key, i) => {
      if (!(key.name in data.events)) {
        error(`${base}.events[${i}]`, `Event key targets undefined event "${key.name}".`);
      }
    });
  }

  return issues;
}
