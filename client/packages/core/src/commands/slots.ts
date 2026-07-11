import type { SkeletonData, SlotData } from '../model/types.js';
import type { Command } from './history.js';

function findSlotIndex(data: SkeletonData, name: string): number {
  return data.slots.findIndex((s) => s.name === name);
}

export class AddSlot implements Command {
  readonly label: string;

  constructor(
    private readonly slot: SlotData,
    private readonly index?: number,
  ) {
    this.label = `Add slot "${slot.name}"`;
  }

  execute(data: SkeletonData): void {
    if (findSlotIndex(data, this.slot.name) >= 0) {
      throw new Error(`Slot "${this.slot.name}" already exists.`);
    }
    if (!data.bones.some((b) => b.name === this.slot.bone)) {
      throw new Error(`Bone "${this.slot.bone}" does not exist.`);
    }
    data.slots.splice(this.index ?? data.slots.length, 0, this.slot);
  }

  undo(data: SkeletonData): void {
    const idx = findSlotIndex(data, this.slot.name);
    if (idx >= 0) data.slots.splice(idx, 1);
  }
}

export class RemoveSlot implements Command {
  readonly label: string;
  private removed: SlotData | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove slot "${name}"`;
  }

  execute(data: SkeletonData): void {
    const idx = findSlotIndex(data, this.name);
    if (idx < 0) throw new Error(`Slot "${this.name}" does not exist.`);
    const blockers: string[] = [];
    for (const skin of data.skins) {
      if (skin.attachments && this.name in skin.attachments) blockers.push(`skin "${skin.name}"`);
    }
    for (const c of data.path) if (c.target === this.name) blockers.push(`path "${c.name}"`);
    for (const [animName, anim] of Object.entries(data.animations)) {
      if (anim.slots && this.name in anim.slots) blockers.push(`animation "${animName}"`);
    }
    if (blockers.length > 0) {
      throw new Error(`Cannot remove slot "${this.name}"; referenced by ${blockers.join(', ')}.`);
    }
    this.removed = data.slots[idx];
    this.removedIndex = idx;
    data.slots.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.slots.splice(this.removedIndex, 0, this.removed);
  }
}

export class RenameSlot implements Command {
  readonly label: string;

  constructor(
    private readonly from: string,
    private readonly to: string,
  ) {
    this.label = `Rename slot "${from}" to "${to}"`;
  }

  execute(data: SkeletonData): void {
    this.apply(data, this.from, this.to);
  }

  undo(data: SkeletonData): void {
    this.apply(data, this.to, this.from);
  }

  /** Renames the slot and cascades to every reference by slot name. */
  private apply(data: SkeletonData, from: string, to: string): void {
    const idx = findSlotIndex(data, from);
    if (idx < 0) throw new Error(`Slot "${from}" does not exist.`);
    if (findSlotIndex(data, to) >= 0) throw new Error(`Slot "${to}" already exists.`);
    const slot = data.slots[idx];
    if (!slot) return;
    slot.name = to;
    for (const c of data.path) if (c.target === from) c.target = to;
    for (const skin of data.skins) {
      if (skin.attachments && from in skin.attachments) {
        const attachments = skin.attachments[from];
        delete skin.attachments[from];
        if (attachments) skin.attachments[to] = attachments;
      }
      for (const bySlot of Object.values(skin.attachments ?? {})) {
        for (const attachment of Object.values(bySlot)) {
          if (attachment.type === 'clipping' && attachment.end === from) attachment.end = to;
        }
      }
    }
    for (const anim of Object.values(data.animations)) {
      if (anim.slots && from in anim.slots) {
        const timelines = anim.slots[from];
        delete anim.slots[from];
        if (timelines) anim.slots[to] = timelines;
      }
      for (const key of anim.drawOrder ?? []) {
        for (const offset of key.offsets ?? []) {
          if (offset.slot === from) offset.slot = to;
        }
      }
    }
  }
}

export type SlotPatch = Partial<Omit<SlotData, 'name'>>;

export class SetSlotProperties implements Command {
  readonly label: string;
  private previous: SlotPatch = {};

  constructor(
    private readonly name: string,
    private readonly patch: SlotPatch,
  ) {
    this.label = `Edit slot "${name}"`;
  }

  execute(data: SkeletonData): void {
    const slot = data.slots.find((s) => s.name === this.name);
    if (!slot) throw new Error(`Slot "${this.name}" does not exist.`);
    if (this.patch.bone !== undefined && !data.bones.some((b) => b.name === this.patch.bone)) {
      throw new Error(`Bone "${this.patch.bone}" does not exist.`);
    }
    if (this.patch.color !== undefined && !/^[0-9a-fA-F]{8}$/.test(this.patch.color)) {
      throw new Error('Slot color must be 8-digit rgba hex, e.g. "ff8800ff".');
    }
    if (
      this.patch.dark !== undefined &&
      this.patch.dark !== null &&
      !/^[0-9a-fA-F]{6}$/.test(this.patch.dark)
    ) {
      throw new Error('Dark color must be 6-digit rgb hex, e.g. "332211" (or null to disable).');
    }
    this.previous = {};
    for (const key of Object.keys(this.patch) as (keyof SlotPatch)[]) {
      (this.previous as Record<string, unknown>)[key] = slot[key];
      (slot as unknown as Record<string, unknown>)[key] = this.patch[key];
    }
  }

  undo(data: SkeletonData): void {
    const slot = data.slots.find((s) => s.name === this.name);
    if (!slot) return;
    Object.assign(slot, this.previous);
  }
}
