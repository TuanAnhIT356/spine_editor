import type { SkeletonData } from '../model/types.js';
import type { SpineAnimation, SpineBoneKey, SpineBoneTimelineName } from '../spine-json/types.js';
import type { Command } from './history.js';

const TIME_EPSILON = 1e-9;

function requireAnimation(data: SkeletonData, name: string): SpineAnimation {
  const anim = data.animations[name];
  if (!anim) throw new Error(`Animation "${name}" does not exist.`);
  return anim;
}

export class CreateAnimation implements Command {
  readonly label: string;

  constructor(private readonly name: string) {
    this.label = `Create animation "${name}"`;
  }

  execute(data: SkeletonData): void {
    if (this.name in data.animations) throw new Error(`Animation "${this.name}" already exists.`);
    data.animations[this.name] = {};
  }

  undo(data: SkeletonData): void {
    delete data.animations[this.name];
  }
}

export class RemoveAnimation implements Command {
  readonly label: string;
  private removed: SpineAnimation | undefined;

  constructor(private readonly name: string) {
    this.label = `Remove animation "${name}"`;
  }

  execute(data: SkeletonData): void {
    this.removed = requireAnimation(data, this.name);
    delete data.animations[this.name];
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.animations[this.name] = this.removed;
  }
}

export class RenameAnimation implements Command {
  readonly label: string;

  constructor(
    private readonly from: string,
    private readonly to: string,
  ) {
    this.label = `Rename animation "${from}" to "${to}"`;
  }

  execute(data: SkeletonData): void {
    this.apply(data, this.from, this.to);
  }

  undo(data: SkeletonData): void {
    this.apply(data, this.to, this.from);
  }

  private apply(data: SkeletonData, from: string, to: string): void {
    const anim = requireAnimation(data, from);
    if (to in data.animations) throw new Error(`Animation "${to}" already exists.`);
    delete data.animations[from];
    data.animations[to] = anim;
  }
}

/**
 * Inserts or replaces a keyframe on a bone timeline, keeping keys sorted by
 * time. A key whose time matches an existing key (within epsilon) replaces it.
 */
export class UpsertBoneKeyframe implements Command {
  readonly label: string;
  private before: SpineAnimation | undefined;

  constructor(
    private readonly animation: string,
    private readonly bone: string,
    private readonly timeline: SpineBoneTimelineName,
    private readonly key: SpineBoneKey,
  ) {
    this.label = `Key ${timeline} on "${bone}"`;
  }

  execute(data: SkeletonData): void {
    const anim = requireAnimation(data, this.animation);
    if (!data.bones.some((b) => b.name === this.bone)) {
      throw new Error(`Bone "${this.bone}" does not exist.`);
    }
    this.before = structuredClone(anim);
    const bones = (anim.bones ??= {});
    const timelines = (bones[this.bone] ??= {});
    const keys = (timelines[this.timeline] ??= []);
    const time = this.key.time ?? 0;
    const existing = keys.findIndex((k) => Math.abs((k.time ?? 0) - time) < TIME_EPSILON);
    if (existing >= 0) {
      keys[existing] = this.key;
    } else {
      keys.push(this.key);
      keys.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    }
  }

  undo(data: SkeletonData): void {
    if (this.before) data.animations[this.animation] = this.before;
  }
}

export class DeleteBoneKeyframe implements Command {
  readonly label: string;
  private before: SpineAnimation | undefined;

  constructor(
    private readonly animation: string,
    private readonly bone: string,
    private readonly timeline: SpineBoneTimelineName,
    private readonly time: number,
  ) {
    this.label = `Delete ${timeline} key on "${bone}"`;
  }

  execute(data: SkeletonData): void {
    const anim = requireAnimation(data, this.animation);
    const keys = anim.bones?.[this.bone]?.[this.timeline];
    const idx = keys?.findIndex((k) => Math.abs((k.time ?? 0) - this.time) < TIME_EPSILON) ?? -1;
    if (!keys || idx < 0) {
      throw new Error(
        `No ${this.timeline} key at time ${this.time} on bone "${this.bone}" in animation "${this.animation}".`,
      );
    }
    this.before = structuredClone(anim);
    keys.splice(idx, 1);
    const timelines = anim.bones?.[this.bone];
    if (keys.length === 0 && timelines) {
      delete timelines[this.timeline];
      if (Object.keys(timelines).length === 0 && anim.bones) {
        delete anim.bones[this.bone];
        if (Object.keys(anim.bones).length === 0) delete anim.bones;
      }
    }
  }

  undo(data: SkeletonData): void {
    if (this.before) data.animations[this.animation] = this.before;
  }
}

/** Moves a keyframe to a new time, keeping the timeline sorted. */
export class MoveBoneKeyframe implements Command {
  readonly label: string;
  private before: SpineAnimation | undefined;

  constructor(
    private readonly animation: string,
    private readonly bone: string,
    private readonly timeline: SpineBoneTimelineName,
    private readonly fromTime: number,
    private readonly toTime: number,
  ) {
    this.label = `Move ${timeline} key on "${bone}"`;
  }

  execute(data: SkeletonData): void {
    const anim = requireAnimation(data, this.animation);
    const keys = anim.bones?.[this.bone]?.[this.timeline];
    const idx =
      keys?.findIndex((k) => Math.abs((k.time ?? 0) - this.fromTime) < TIME_EPSILON) ?? -1;
    if (!keys || idx < 0) {
      throw new Error(
        `No ${this.timeline} key at time ${this.fromTime} on bone "${this.bone}" in animation "${this.animation}".`,
      );
    }
    if (this.toTime < 0) throw new Error('Keyframe time must be >= 0.');
    if (keys.some((k) => Math.abs((k.time ?? 0) - this.toTime) < TIME_EPSILON)) {
      throw new Error(`A ${this.timeline} key already exists at time ${this.toTime}.`);
    }
    this.before = structuredClone(anim);
    const key = keys[idx];
    if (!key) return;
    if (this.toTime === 0) delete key.time;
    else key.time = this.toTime;
    keys.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  }

  undo(data: SkeletonData): void {
    if (this.before) data.animations[this.animation] = this.before;
  }
}
