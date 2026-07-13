/**
 * Structural commands: bone re-parenting, slot draw-order, skin attachments.
 */

import type { BoneData, SkeletonData, SlotData } from '../model/types.js';
import type { SpineAttachment, SpineAttachmentTimelines, SpineSkin } from '../spine-json/types.js';
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

/** Creates a skin, optionally deep-copying another skin's attachments. */
export class CreateSkin implements Command {
  readonly label: string;

  constructor(
    private readonly name: string,
    private readonly copyFrom?: string,
  ) {
    this.label = `Create skin "${name}"`;
  }

  execute(data: SkeletonData): void {
    if (data.skins.some((s) => s.name === this.name)) {
      throw new Error(`Skin "${this.name}" already exists.`);
    }
    const skin: SpineSkin = { name: this.name };
    if (this.copyFrom !== undefined) {
      const source = requireSkin(data, this.copyFrom);
      if (source.attachments) skin.attachments = structuredClone(source.attachments);
    }
    data.skins.push(skin);
  }

  undo(data: SkeletonData): void {
    const idx = data.skins.findIndex((s) => s.name === this.name);
    if (idx >= 0) data.skins.splice(idx, 1);
  }
}

export class RemoveSkin implements Command {
  readonly label: string;
  private removed: SpineSkin | undefined;
  private removedIndex = -1;

  constructor(private readonly name: string) {
    this.label = `Remove skin "${name}"`;
  }

  execute(data: SkeletonData): void {
    if (this.name === 'default') throw new Error('The default skin cannot be removed.');
    const idx = data.skins.findIndex((s) => s.name === this.name);
    if (idx < 0) throw new Error(`Skin "${this.name}" does not exist.`);
    this.removed = data.skins[idx];
    this.removedIndex = idx;
    data.skins.splice(idx, 1);
  }

  undo(data: SkeletonData): void {
    if (this.removed) data.skins.splice(this.removedIndex, 0, this.removed);
  }
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

/**
 * Patches x/y/rotation/scaleX/scaleY on a region attachment, or x/y/rotation
 * on a point attachment — the only two attachment types with transform
 * fields in the data model (mesh/linkedmesh/boundingbox/clipping/path have
 * none; their shape comes from `vertices`, edited via SetAttachmentVertices).
 */
export class SetAttachmentTransform implements Command {
  readonly label: string;
  private before: SpineSkin | undefined;

  private static readonly ALLOWED: Record<string, readonly string[]> = {
    region: ['x', 'y', 'rotation', 'scaleX', 'scaleY'],
    point: ['x', 'y', 'rotation'],
  };

  constructor(
    private readonly skinName: string,
    private readonly slotName: string,
    private readonly attachmentName: string,
    private readonly patch: {
      x?: number;
      y?: number;
      rotation?: number;
      scaleX?: number;
      scaleY?: number;
    },
  ) {
    this.label = `Transform attachment "${attachmentName}"`;
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
    const allowed = SetAttachmentTransform.ALLOWED[att.type ?? 'region'];
    if (!allowed) throw new Error(`Attachment type "${att.type}" has no transform fields.`);
    for (const key of Object.keys(this.patch)) {
      if (!allowed.includes(key)) {
        throw new Error(`Attachment type "${att.type ?? 'region'}" has no "${key}" field.`);
      }
    }
    this.before = structuredClone(skin);
    Object.assign(att, this.patch);
  }

  undo(data: SkeletonData): void {
    if (!this.before) return;
    const idx = data.skins.findIndex((s) => s.name === this.skinName);
    if (idx >= 0) data.skins[idx] = this.before;
  }
}

export interface MeshGeometry {
  vertices: number[];
  uvs: number[];
  triangles: number[];
  hull: number;
}

/**
 * Replaces a mesh attachment's full geometry (vertices/uvs/triangles/hull).
 * Changing the vertex count invalidates deform keys, so every deform/sequence
 * timeline for this attachment is removed in the same undo step (Spine warns
 * and does the same).
 */
export class SetMeshGeometry implements Command {
  readonly label: string;
  private beforeSkin: SpineSkin | undefined;
  private beforeTimelines: Record<string, SpineAttachmentTimelines> | undefined;

  constructor(
    private readonly skinName: string,
    private readonly slotName: string,
    private readonly attachmentName: string,
    private readonly geometry: MeshGeometry,
  ) {
    this.label = `Edit mesh geometry of "${attachmentName}"`;
  }

  execute(data: SkeletonData): void {
    const skin = data.skins.find((s) => s.name === this.skinName);
    if (!skin) throw new Error(`Skin "${this.skinName}" does not exist.`);
    const att = skin.attachments?.[this.slotName]?.[this.attachmentName];
    if (!att || att.type !== 'mesh') {
      throw new Error(`Attachment "${this.attachmentName}" is not a mesh.`);
    }
    const g = this.geometry;
    const count = g.uvs.length / 2;
    if (!Number.isInteger(count) || count < 3) throw new Error('Mesh needs at least 3 vertices.');
    if (g.vertices.length !== count * 2) {
      let vi = 0;
      let seen = 0;
      while (vi < g.vertices.length) {
        const n = g.vertices[vi];
        if (typeof n !== 'number' || n < 1 || !Number.isInteger(n)) break;
        vi += 1 + n * 4;
        seen++;
      }
      if (vi !== g.vertices.length || seen !== count) {
        throw new Error(`Vertex array does not match ${count} vertices.`);
      }
    }
    if (
      g.triangles.length === 0 ||
      g.triangles.length % 3 !== 0 ||
      g.triangles.some((t) => !Number.isInteger(t) || t < 0 || t >= count)
    ) {
      throw new Error('Triangles reference missing vertices.');
    }
    if (!Number.isInteger(g.hull) || g.hull < 3 || g.hull > count) {
      throw new Error(`Hull must be between 3 and ${count}.`);
    }
    this.beforeSkin = structuredClone(skin);
    this.beforeTimelines = {};
    for (const [animName, anim] of Object.entries(data.animations)) {
      const bySkin = anim.attachments?.[this.skinName];
      const timelines = bySkin?.[this.slotName]?.[this.attachmentName];
      if (!timelines) continue;
      this.beforeTimelines[animName] = structuredClone(timelines);
      delete bySkin![this.slotName]![this.attachmentName];
      if (Object.keys(bySkin![this.slotName]!).length === 0) delete bySkin![this.slotName];
      if (Object.keys(bySkin!).length === 0) delete anim.attachments![this.skinName];
      if (Object.keys(anim.attachments!).length === 0) delete anim.attachments;
    }
    att.vertices = [...g.vertices];
    att.uvs = [...g.uvs];
    att.triangles = [...g.triangles];
    att.hull = g.hull;
  }

  undo(data: SkeletonData): void {
    if (this.beforeSkin) {
      const idx = data.skins.findIndex((s) => s.name === this.skinName);
      if (idx >= 0) data.skins[idx] = this.beforeSkin;
    }
    for (const [animName, timelines] of Object.entries(this.beforeTimelines ?? {})) {
      const anim = data.animations[animName];
      if (!anim) continue;
      anim.attachments ??= {};
      anim.attachments[this.skinName] ??= {};
      anim.attachments[this.skinName]![this.slotName] ??= {};
      anim.attachments[this.skinName]![this.slotName]![this.attachmentName] = timelines;
    }
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
