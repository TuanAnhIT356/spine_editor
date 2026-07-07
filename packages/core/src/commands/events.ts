import type { SkeletonData } from '../model/types.js';
import type { SpineAnimation, SpineEventDef, SpineEventKey } from '../spine-json/types.js';
import type { Command } from './history.js';

const TIME_EPSILON = 1e-9;

/** Creates or replaces an event definition. */
export class SetEventDef implements Command {
  readonly label: string;
  private previous: SpineEventDef | undefined;
  private existed = false;

  constructor(
    private readonly name: string,
    private readonly def: SpineEventDef,
  ) {
    this.label = `Set event "${name}"`;
  }

  execute(data: SkeletonData): void {
    this.existed = this.name in data.events;
    this.previous = data.events[this.name];
    data.events[this.name] = structuredClone(this.def);
  }

  undo(data: SkeletonData): void {
    if (this.existed && this.previous) data.events[this.name] = this.previous;
    else delete data.events[this.name];
  }
}

export class RemoveEventDef implements Command {
  readonly label: string;
  private previous: SpineEventDef | undefined;

  constructor(private readonly name: string) {
    this.label = `Remove event "${name}"`;
  }

  execute(data: SkeletonData): void {
    if (!(this.name in data.events)) throw new Error(`Event "${this.name}" does not exist.`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if ((anim.events ?? []).some((k) => k.name === this.name)) {
        throw new Error(`Cannot remove event "${this.name}"; keyed in animation "${animName}".`);
      }
    }
    this.previous = data.events[this.name];
    delete data.events[this.name];
  }

  undo(data: SkeletonData): void {
    if (this.previous) data.events[this.name] = this.previous;
  }
}

/**
 * Inserts or replaces an event key (matched by time AND event name), keeping
 * the event timeline sorted by time.
 */
export class UpsertEventKeyframe implements Command {
  readonly label: string;
  private before: SpineAnimation | undefined;

  constructor(
    private readonly animation: string,
    private readonly key: SpineEventKey,
  ) {
    this.label = `Key event "${key.name}"`;
  }

  execute(data: SkeletonData): void {
    const anim = data.animations[this.animation];
    if (!anim) throw new Error(`Animation "${this.animation}" does not exist.`);
    if (!(this.key.name in data.events)) {
      throw new Error(`Event "${this.key.name}" is not defined; call SetEventDef first.`);
    }
    this.before = structuredClone(anim);
    const keys = (anim.events ??= []);
    const time = this.key.time ?? 0;
    const existing = keys.findIndex(
      (k) => k.name === this.key.name && Math.abs((k.time ?? 0) - time) < TIME_EPSILON,
    );
    if (existing >= 0) keys[existing] = this.key;
    else {
      keys.push(this.key);
      keys.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    }
  }

  undo(data: SkeletonData): void {
    if (this.before) data.animations[this.animation] = this.before;
  }
}
