import type { IkConstraintData, SkeletonData, TransformConstraintData } from '../model/types.js';
import type { SpinePathConstraint, SpinePhysicsConstraint } from '../spine-json/types.js';
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

export class AddTransformConstraint implements Command {
  readonly label: string;

  constructor(private readonly constraint: TransformConstraintData) {
    this.label = `Add transform constraint "${constraint.name}"`;
  }

  execute(data: SkeletonData): void {
    const c = this.constraint;
    if (data.transform.some((x) => x.name === c.name)) {
      throw new Error(`Transform constraint "${c.name}" already exists.`);
    }
    if (c.bones.length < 1) throw new Error('Transform constraints require at least one bone.');
    for (const bone of [...c.bones, c.target]) {
      if (!data.bones.some((b) => b.name === bone)) {
        throw new Error(`Bone "${bone}" does not exist.`);
      }
    }
    data.transform.push(structuredClone(c));
  }

  undo(data: SkeletonData): void {
    const idx = data.transform.findIndex((x) => x.name === this.constraint.name);
    if (idx >= 0) data.transform.splice(idx, 1);
  }
}

/** Adds a path constraint; `target` must be a slot with a path attachment. */
export class AddPathConstraint implements Command {
  readonly label: string;

  constructor(private readonly constraint: SpinePathConstraint) {
    this.label = `Add path constraint "${constraint.name}"`;
  }

  execute(data: SkeletonData): void {
    const c = this.constraint;
    if (data.path.some((x) => x.name === c.name)) {
      throw new Error(`Path constraint "${c.name}" already exists.`);
    }
    if (c.bones.length < 1) throw new Error('Path constraints require at least one bone.');
    for (const bone of c.bones) {
      if (!data.bones.some((b) => b.name === bone)) {
        throw new Error(`Bone "${bone}" does not exist.`);
      }
    }
    if (!data.slots.some((s) => s.name === c.target)) {
      throw new Error(`Slot "${c.target}" does not exist (path targets are slots).`);
    }
    const hasPath = data.skins.some((skin) =>
      Object.values(skin.attachments?.[c.target] ?? {}).some((att) => att.type === 'path'),
    );
    if (!hasPath) {
      throw new Error(`Slot "${c.target}" has no path attachment.`);
    }
    data.path.push(structuredClone(c));
  }

  undo(data: SkeletonData): void {
    const idx = data.path.findIndex((x) => x.name === this.constraint.name);
    if (idx >= 0) data.path.splice(idx, 1);
  }
}

export class AddPhysicsConstraint implements Command {
  readonly label: string;

  constructor(private readonly constraint: SpinePhysicsConstraint) {
    this.label = `Add physics constraint "${constraint.name}"`;
  }

  execute(data: SkeletonData): void {
    const c = this.constraint;
    if (data.physics.some((x) => x.name === c.name)) {
      throw new Error(`Physics constraint "${c.name}" already exists.`);
    }
    if (!data.bones.some((b) => b.name === c.bone)) {
      throw new Error(`Bone "${c.bone}" does not exist.`);
    }
    data.physics.push(structuredClone(c));
  }

  undo(data: SkeletonData): void {
    const idx = data.physics.findIndex((x) => x.name === this.constraint.name);
    if (idx >= 0) data.physics.splice(idx, 1);
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

export class RemoveTransformConstraint implements Command {
  readonly label: string;
  private removed: TransformConstraintData | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove transform constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = data.transform.findIndex((x) => x.name === this.name);
    if (idx < 0) throw new Error(`Transform constraint "${this.name}" does not exist.`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if (anim.transform && this.name in anim.transform) {
        throw new Error(
          `Cannot remove transform constraint "${this.name}"; referenced by animation "${animName}".`,
        );
      }
    }
    this.removed = data.transform[idx];
    this.removedIndex = idx;
    data.transform.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.transform.splice(this.removedIndex, 0, this.removed);
  }
}

export class RemovePathConstraint implements Command {
  readonly label: string;
  private removed: SpinePathConstraint | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove path constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = data.path.findIndex((x) => x.name === this.name);
    if (idx < 0) throw new Error(`Path constraint "${this.name}" does not exist.`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if (anim.path && this.name in anim.path) {
        throw new Error(
          `Cannot remove path constraint "${this.name}"; referenced by animation "${animName}".`,
        );
      }
    }
    this.removed = data.path[idx];
    this.removedIndex = idx;
    data.path.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.path.splice(this.removedIndex, 0, this.removed);
  }
}

export class RemovePhysicsConstraint implements Command {
  readonly label: string;
  private removed: SpinePhysicsConstraint | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove physics constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = data.physics.findIndex((x) => x.name === this.name);
    if (idx < 0) throw new Error(`Physics constraint "${this.name}" does not exist.`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if (anim.physics && this.name in anim.physics) {
        throw new Error(
          `Cannot remove physics constraint "${this.name}"; referenced by animation "${animName}".`,
        );
      }
    }
    this.removed = data.physics[idx];
    this.removedIndex = idx;
    data.physics.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.physics.splice(this.removedIndex, 0, this.removed);
  }
}

/** Patches fields of an existing IK constraint (undo restores the snapshot). */
export class SetIkConstraintProperties implements Command {
  readonly label: string;
  private previous: IkConstraintData | null = null;

  constructor(
    private readonly name: string,
    private readonly patch: Partial<Omit<IkConstraintData, 'name'>>,
  ) {
    this.label = `Edit IK constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const c = data.ik.find((x) => x.name === this.name);
    if (!c) throw new Error(`IK constraint "${this.name}" does not exist.`);
    const bones = this.patch.bones ?? c.bones;
    if (bones.length < 1 || bones.length > 2) {
      throw new Error('IK constraints require 1 or 2 bones.');
    }
    for (const bone of [...bones, this.patch.target ?? c.target]) {
      if (!data.bones.some((b) => b.name === bone)) {
        throw new Error(`Bone "${bone}" does not exist.`);
      }
    }
    this.previous = structuredClone(c);
    Object.assign(c, structuredClone(this.patch));
  }

  undo(data: SkeletonData): void {
    const idx = data.ik.findIndex((x) => x.name === this.name);
    if (idx >= 0 && this.previous) data.ik[idx] = structuredClone(this.previous);
  }
}

/** Patches fields of an existing transform constraint. */
export class SetTransformConstraintProperties implements Command {
  readonly label: string;
  private previous: TransformConstraintData | null = null;

  constructor(
    private readonly name: string,
    private readonly patch: Partial<Omit<TransformConstraintData, 'name'>>,
  ) {
    this.label = `Edit transform constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const c = data.transform.find((x) => x.name === this.name);
    if (!c) throw new Error(`Transform constraint "${this.name}" does not exist.`);
    const bones = this.patch.bones ?? c.bones;
    if (bones.length < 1) throw new Error('Transform constraints require at least one bone.');
    for (const bone of [...bones, this.patch.target ?? c.target]) {
      if (!data.bones.some((b) => b.name === bone)) {
        throw new Error(`Bone "${bone}" does not exist.`);
      }
    }
    this.previous = structuredClone(c);
    Object.assign(c, structuredClone(this.patch));
  }

  undo(data: SkeletonData): void {
    const idx = data.transform.findIndex((x) => x.name === this.name);
    if (idx >= 0 && this.previous) data.transform[idx] = structuredClone(this.previous);
  }
}

/** Patches fields of an existing path constraint (verbatim JSON shape). */
export class SetPathConstraintProperties implements Command {
  readonly label: string;
  private previous: SpinePathConstraint | null = null;

  constructor(
    private readonly name: string,
    private readonly patch: Partial<Omit<SpinePathConstraint, 'name'>>,
  ) {
    this.label = `Edit path constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const c = data.path.find((x) => x.name === this.name);
    if (!c) throw new Error(`Path constraint "${this.name}" does not exist.`);
    for (const bone of this.patch.bones ?? c.bones) {
      if (!data.bones.some((b) => b.name === bone)) {
        throw new Error(`Bone "${bone}" does not exist.`);
      }
    }
    const target = this.patch.target ?? c.target;
    if (!data.slots.some((s) => s.name === target)) {
      throw new Error(`Slot "${target}" does not exist.`);
    }
    this.previous = structuredClone(c);
    Object.assign(c, structuredClone(this.patch));
  }

  undo(data: SkeletonData): void {
    const idx = data.path.findIndex((x) => x.name === this.name);
    if (idx >= 0 && this.previous) data.path[idx] = structuredClone(this.previous);
  }
}

/** Patches fields of an existing physics constraint (verbatim JSON shape). */
export class SetPhysicsConstraintProperties implements Command {
  readonly label: string;
  private previous: SpinePhysicsConstraint | null = null;

  constructor(
    private readonly name: string,
    private readonly patch: Partial<Omit<SpinePhysicsConstraint, 'name'>>,
  ) {
    this.label = `Edit physics constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const c = data.physics.find((x) => x.name === this.name);
    if (!c) throw new Error(`Physics constraint "${this.name}" does not exist.`);
    const bone = this.patch.bone ?? c.bone;
    if (!data.bones.some((b) => b.name === bone)) {
      throw new Error(`Bone "${bone}" does not exist.`);
    }
    this.previous = structuredClone(c);
    Object.assign(c, structuredClone(this.patch));
  }

  undo(data: SkeletonData): void {
    const idx = data.physics.findIndex((x) => x.name === this.name);
    if (idx >= 0 && this.previous) data.physics[idx] = structuredClone(this.previous);
  }
}
