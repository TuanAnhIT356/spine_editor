import type { BoneData, SkeletonData } from '../model/types.js';
import type { Command } from './history.js';

function findBoneIndex(data: SkeletonData, name: string): number {
  return data.bones.findIndex((b) => b.name === name);
}

export class AddBone implements Command {
  readonly label: string;

  constructor(
    private readonly bone: BoneData,
    private readonly index?: number,
  ) {
    this.label = `Add bone "${bone.name}"`;
  }

  execute(data: SkeletonData): void {
    if (findBoneIndex(data, this.bone.name) >= 0) {
      throw new Error(`Bone "${this.bone.name}" already exists.`);
    }
    if (this.bone.parent === null) {
      if (data.bones.length > 0) throw new Error('Only the first bone may have no parent.');
    } else if (findBoneIndex(data, this.bone.parent) < 0) {
      throw new Error(`Parent bone "${this.bone.parent}" does not exist.`);
    }
    data.bones.splice(this.index ?? data.bones.length, 0, this.bone);
  }

  undo(data: SkeletonData): void {
    const idx = findBoneIndex(data, this.bone.name);
    if (idx >= 0) data.bones.splice(idx, 1);
  }
}

export class RemoveBone implements Command {
  readonly label: string;
  private removed: BoneData | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove bone "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = findBoneIndex(data, this.name);
    if (idx < 0) throw new Error(`Bone "${this.name}" does not exist.`);
    const blockers: string[] = [];
    for (const b of data.bones) if (b.parent === this.name) blockers.push(`child bone "${b.name}"`);
    for (const s of data.slots) if (s.bone === this.name) blockers.push(`slot "${s.name}"`);
    for (const c of data.ik)
      if (c.bones.includes(this.name) || c.target === this.name) blockers.push(`IK "${c.name}"`);
    for (const c of data.transform)
      if (c.bones.includes(this.name) || c.target === this.name)
        blockers.push(`transform "${c.name}"`);
    for (const c of data.path)
      if ((c.bones ?? []).includes(this.name)) blockers.push(`path "${c.name}"`);
    for (const c of data.physics) if (c.bone === this.name) blockers.push(`physics "${c.name}"`);
    for (const [animName, anim] of Object.entries(data.animations))
      if (anim.bones && this.name in anim.bones) blockers.push(`animation "${animName}"`);
    if (blockers.length > 0) {
      throw new Error(`Cannot remove bone "${this.name}"; referenced by ${blockers.join(', ')}.`);
    }
    this.removed = data.bones[idx];
    this.removedIndex = idx;
    data.bones.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.bones.splice(this.removedIndex, 0, this.removed);
  }
}

export class RenameBone implements Command {
  readonly label: string;

  constructor(
    private readonly from: string,
    private readonly to: string,
  ) {
    this.label = `Rename bone "${from}" to "${to}"`;
  }

  execute(data: SkeletonData): void {
    this.apply(data, this.from, this.to);
  }

  undo(data: SkeletonData): void {
    this.apply(data, this.to, this.from);
  }

  /** Renames the bone and cascades to every reference by bone name. */
  private apply(data: SkeletonData, from: string, to: string): void {
    const idx = findBoneIndex(data, from);
    if (idx < 0) throw new Error(`Bone "${from}" does not exist.`);
    if (findBoneIndex(data, to) >= 0) throw new Error(`Bone "${to}" already exists.`);
    const bone = data.bones[idx];
    if (!bone) return;
    bone.name = to;
    for (const b of data.bones) if (b.parent === from) b.parent = to;
    for (const s of data.slots) if (s.bone === from) s.bone = to;
    for (const c of data.ik) {
      c.bones = c.bones.map((n) => (n === from ? to : n));
      if (c.target === from) c.target = to;
    }
    for (const c of data.transform) {
      c.bones = c.bones.map((n) => (n === from ? to : n));
      if (c.target === from) c.target = to;
    }
    for (const c of data.path) {
      c.bones = c.bones.map((n) => (n === from ? to : n));
    }
    for (const c of data.physics) if (c.bone === from) c.bone = to;
    for (const skin of data.skins) {
      if (skin.bones) skin.bones = skin.bones.map((n) => (n === from ? to : n));
    }
    for (const anim of Object.values(data.animations)) {
      if (anim.bones && from in anim.bones) {
        const timelines = anim.bones[from];
        delete anim.bones[from];
        if (timelines) anim.bones[to] = timelines;
      }
    }
  }
}

export type BoneTransformPatch = Partial<
  Pick<
    BoneData,
    'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY' | 'length' | 'inherit'
  >
>;

export class SetBoneTransform implements Command {
  readonly label: string;
  private previous: BoneTransformPatch = {};

  constructor(
    private readonly name: string,
    private readonly patch: BoneTransformPatch,
  ) {
    this.label = `Transform bone "${name}"`;
  }

  execute(data: SkeletonData): void {
    const bone = data.bones.find((b) => b.name === this.name);
    if (!bone) throw new Error(`Bone "${this.name}" does not exist.`);
    this.previous = {};
    for (const key of Object.keys(this.patch) as (keyof BoneTransformPatch)[]) {
      (this.previous as Record<string, unknown>)[key] = bone[key];
      (bone as unknown as Record<string, unknown>)[key] = this.patch[key];
    }
  }

  undo(data: SkeletonData): void {
    const bone = data.bones.find((b) => b.name === this.name);
    if (!bone) return;
    Object.assign(bone, this.previous);
  }
}

/** Sets or clears a bone's tree color (8-hex RGBA, e.g. "ff8800ff"). */
export class SetBoneColor implements Command {
  readonly label: string;
  private previous: string | undefined;

  constructor(
    private readonly name: string,
    private readonly color: string | undefined,
  ) {
    this.label = `Color bone "${name}"`;
  }

  execute(data: SkeletonData): void {
    if (this.color !== undefined && !/^[0-9a-fA-F]{8}$/.test(this.color)) {
      throw new Error('Bone color must be 8-hex RGBA (e.g. "ff8800ff").');
    }
    const bone = data.bones.find((b) => b.name === this.name);
    if (!bone) throw new Error(`Bone "${this.name}" does not exist.`);
    this.previous = bone.color;
    if (this.color === undefined) delete bone.color;
    else bone.color = this.color;
  }

  undo(data: SkeletonData): void {
    const bone = data.bones.find((b) => b.name === this.name);
    if (!bone) return;
    if (this.previous === undefined) delete bone.color;
    else bone.color = this.previous;
  }
}
