/**
 * Structural commands: bone re-parenting, slot draw-order, skin attachments.
 */

import type { BoneData, SkeletonData, SlotData } from '../model/types.js';
import type { SpineAttachment, SpineSkin } from '../spine-json/types.js';
import type { Command } from './history.js';

/** Stable topological sort keeping parents before children. */
function sortBonesParentsFirst(bones: BoneData[]): BoneData[] {
  const placed = new Set<string>();
  const out: BoneData[] = [];
  const remaining = [...bones];
  while (remaining.length > 0) {
    let progressed = false;
    for (let i = 0; i < remaining.length; i++) {
      const bone = remaining[i];
      if (bone && (bone.parent === null || placed.has(bone.parent))) {
        out.push(bone);
        placed.add(bone.name);
        remaining.splice(i, 1);
        progressed = true;
        i--;
      }
    }
    if (!progressed) {
      out.push(...remaining);
      break;
    }
  }
  return out;
}

export class ReparentBone implements Command {
  readonly label: string;
  private previousParent: string | null = null;
  private previousOrder: BoneData[] | undefined;

  constructor(
    private readonly name: string,
    private readonly newParent: string,
  ) {
    this.label = `Reparent bone "${name}" under "${newParent}"`;
  }

  execute(data: SkeletonData): void {
    if (this.name === this.newParent) throw new Error('Cannot parent a bone to itself.');
    const bone = data.bones.find((b) => b.name === this.name);
    if (!bone) throw new Error(`Bone "${this.name}" does not exist.`);
    if (bone.parent === null) throw new Error('Cannot reparent the root bone.');
    const parent = data.bones.find((b) => b.name === this.newParent);
    if (!parent) throw new Error(`Bone "${this.newParent}" does not exist.`);
    for (let p: BoneData | undefined = parent; p;) {
      if (p.name === this.name) {
        throw new Error(`Cannot parent "${this.name}" to its own descendant "${this.newParent}".`);
      }
      p = p.parent !== null ? data.bones.find((b) => b.name === p?.parent) : undefined;
    }
    this.previousParent = bone.parent;
    this.previousOrder = [...data.bones];
    bone.parent = this.newParent;
    data.bones = sortBonesParentsFirst(data.bones);
  }

  undo(data: SkeletonData): void {
    const bone = data.bones.find((b) => b.name === this.name);
    if (bone) bone.parent = this.previousParent;
    if (this.previousOrder) data.bones = this.previousOrder;
  }
}

/** Moves a slot to a new index in the draw order (0 = drawn first/behind). */
export class ReorderSlot implements Command {
  readonly label: string;
  private previousIndex = -1;

  constructor(
    private readonly name: string,
    private readonly toIndex: number,
  ) {
    this.label = `Reorder slot "${name}"`;
  }

  execute(data: SkeletonData): void {
    const from = data.slots.findIndex((s) => s.name === this.name);
    if (from < 0) throw new Error(`Slot "${this.name}" does not exist.`);
    if (this.toIndex < 0 || this.toIndex >= data.slots.length) {
      throw new Error(`Slot index ${this.toIndex} out of range.`);
    }
    this.previousIndex = from;
    const [slot] = data.slots.splice(from, 1);
    if (slot) data.slots.splice(this.toIndex, 0, slot);
  }

  undo(data: SkeletonData): void {
    const idx = data.slots.findIndex((s) => s.name === this.name);
    if (idx < 0) return;
    const [slot] = data.slots.splice(idx, 1);
    if (slot) data.slots.splice(this.previousIndex, 0, slot);
  }
}

function requireSkin(data: SkeletonData, name: string): SpineSkin {
  const skin = data.skins.find((s) => s.name === name);
  if (!skin) throw new Error(`Skin "${name}" does not exist.`);
  return skin;
}

export class AddSkinAttachment implements Command {
  readonly label: string;
  private before: SpineSkin | undefined;

  constructor(
    private readonly skinName: string,
    private readonly slotName: string,
    private readonly attachmentName: string,
    private readonly attachment: SpineAttachment,
    private readonly allowReplace = false,
  ) {
    this.label = `Add attachment "${attachmentName}" to slot "${slotName}"`;
  }

  execute(data: SkeletonData): void {
    const skin = requireSkin(data, this.skinName);
    if (!data.slots.some((s) => s.name === this.slotName)) {
      throw new Error(`Slot "${this.slotName}" does not exist.`);
    }
    const existing = skin.attachments?.[this.slotName]?.[this.attachmentName];
    if (existing && !this.allowReplace) {
      throw new Error(
        `Attachment "${this.attachmentName}" already exists on slot "${this.slotName}" in skin "${this.skinName}".`,
      );
    }
    this.before = structuredClone(skin);
    const attachments = (skin.attachments ??= {});
    const bySlot = (attachments[this.slotName] ??= {});
    bySlot[this.attachmentName] = structuredClone(this.attachment);
  }

  undo(data: SkeletonData): void {
    if (!this.before) return;
    const idx = data.skins.findIndex((s) => s.name === this.skinName);
    if (idx >= 0) data.skins[idx] = this.before;
  }
}

/**
 * Replaces the vertex array of a vertex-based attachment (mesh, boundingbox,
 * clipping, path). Accepts either the unweighted layout (x,y pairs matching
 * the attachment's vertex count) or the weighted layout (bone count +
 * boneIndex,x,y,weight per influence).
 */
export class SetAttachmentVertices implements Command {
  readonly label: string;
  private before: SpineSkin | undefined;

  constructor(
    private readonly skinName: string,
    private readonly slotName: string,
    private readonly attachmentName: string,
    private readonly vertices: number[],
  ) {
    this.label = `Edit vertices of "${attachmentName}"`;
  }

  execute(data: SkeletonData): void {
    const skin = data.skins.find((s) => s.name === this.skinName);
    if (!skin) throw new Error(`Skin "${this.skinName}" does not exist.`);
    const att = skin.attachments?.[this.slotName]?.[this.attachmentName];
    if (!att) {
      throw new Error(
        `Attachment "${this.attachmentName}" does not exist on slot "${this.slotName}" in skin "${this.skinName}".`,
      );
    }
    let count: number;
    if (att.type === 'mesh') count = att.uvs.length / 2;
    else if (att.type === 'boundingbox' || att.type === 'clipping' || att.type === 'path') {
      count = att.vertexCount;
    } else {
      throw new Error(
        `Attachment "${this.attachmentName}" (${att.type ?? 'region'}) has no vertices.`,
      );
    }
    if (this.vertices.length !== count * 2) {
      // Weighted layout: walk bone-count blocks and check vertex tally.
      let vi = 0;
      let seen = 0;
      while (vi < this.vertices.length) {
        const n = this.vertices[vi];
        if (typeof n !== 'number' || n < 1 || !Number.isInteger(n)) break;
        vi += 1 + n * 4;
        seen++;
      }
      if (vi !== this.vertices.length || seen !== count) {
        throw new Error(
          `Vertex array does not match ${count} vertices (unweighted x,y pairs or weighted layout).`,
        );
      }
    }
    this.before = structuredClone(skin);
    att.vertices = [...this.vertices];
  }

  undo(data: SkeletonData): void {
    if (!this.before) return;
    const idx = data.skins.findIndex((s) => s.name === this.skinName);
    if (idx >= 0) data.skins[idx] = this.before;
  }
}

export class RemoveSkinAttachment implements Command {
  readonly label: string;
  private before: SpineSkin | undefined;
  private previousSetup: SlotData['attachment'] = null;

  constructor(
    private readonly skinName: string,
    private readonly slotName: string,
    private readonly attachmentName: string,
  ) {
    this.label = `Remove attachment "${attachmentName}" from slot "${slotName}"`;
  }

  execute(data: SkeletonData): void {
    const skin = requireSkin(data, this.skinName);
    const bySlot = skin.attachments?.[this.slotName];
    if (!bySlot || !(this.attachmentName in bySlot)) {
      throw new Error(
        `Attachment "${this.attachmentName}" does not exist on slot "${this.slotName}" in skin "${this.skinName}".`,
      );
    }
    this.before = structuredClone(skin);
    delete bySlot[this.attachmentName];
    if (Object.keys(bySlot).length === 0 && skin.attachments) {
      delete skin.attachments[this.slotName];
      if (Object.keys(skin.attachments).length === 0) delete skin.attachments;
    }
    const slot = data.slots.find((s) => s.name === this.slotName);
    this.previousSetup = slot?.attachment ?? null;
    if (slot && slot.attachment === this.attachmentName) slot.attachment = null;
  }

  undo(data: SkeletonData): void {
    if (!this.before) return;
    const idx = data.skins.findIndex((s) => s.name === this.skinName);
    if (idx >= 0) data.skins[idx] = this.before;
    const slot = data.slots.find((s) => s.name === this.slotName);
    if (slot) slot.attachment = this.previousSetup;
  }
}
