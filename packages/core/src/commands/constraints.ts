import type { IkConstraintData, SkeletonData } from '../model/types.js';
import type { Command } from './history.js';

export class AddIkConstraint implements Command {
  readonly label: string;

  constructor(private readonly constraint: IkConstraintData) {
    this.label = `Add IK constraint "${constraint.name}"`;
  }

  execute(data: SkeletonData): void {
    const c = this.constraint;
    if (data.ik.some((x) => x.name === c.name)) {
      throw new Error(`IK constraint "${c.name}" already exists.`);
    }
    if (c.bones.length < 1 || c.bones.length > 2) {
      throw new Error('IK constraints require 1 or 2 bones.');
    }
    for (const bone of [...c.bones, c.target]) {
      if (!data.bones.some((b) => b.name === bone)) {
        throw new Error(`Bone "${bone}" does not exist.`);
      }
    }
    data.ik.push(structuredClone(c));
  }

  undo(data: SkeletonData): void {
    const idx = data.ik.findIndex((x) => x.name === this.constraint.name);
    if (idx >= 0) data.ik.splice(idx, 1);
  }
}

export class RemoveIkConstraint implements Command {
  readonly label: string;
  private removed: IkConstraintData | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove IK constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = data.ik.findIndex((x) => x.name === this.name);
    if (idx < 0) throw new Error(`IK constraint "${this.name}" does not exist.`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if (anim.ik && this.name in anim.ik) {
        throw new Error(
          `Cannot remove IK constraint "${this.name}"; referenced by animation "${animName}".`,
        );
      }
    }
    this.removed = data.ik[idx];
    this.removedIndex = idx;
    data.ik.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.ik.splice(this.removedIndex, 0, this.removed);
  }
}
