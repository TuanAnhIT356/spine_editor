import { History, type Command } from './commands/history.js';
import { createBone } from './model/factories.js';
import type { BoneData, SkeletonData, SlotData } from './model/types.js';
import { parseSpineJson } from './spine-json/parse.js';
import { serializeSpineJson, serializeSpineJsonString } from './spine-json/serialize.js';
import type { SpineAnimation, SpineJson } from './spine-json/types.js';
import { validateSkeleton, type ValidationIssue } from './validate.js';

/** Version string written into files this editor exports. */
export const SPINE_EXPORT_VERSION = '4.2.43';

export function createEmptySkeleton(): SkeletonData {
  return {
    meta: { spine: SPINE_EXPORT_VERSION, x: 0, y: 0, width: 0, height: 0, images: '', audio: '' },
    bones: [createBone('root', null)],
    slots: [],
    ik: [],
    transform: [],
    path: [],
    physics: [],
    skins: [{ name: 'default' }],
    events: {},
    animations: {},
  };
}

/**
 * A skeleton document plus its undo/redo history. All mutations must go
 * through {@link SpineDocument.execute} so they are undoable and identically
 * drivable by the editor UI and the MCP server.
 */
export class SpineDocument {
  readonly history: History;

  constructor(
    public data: SkeletonData = createEmptySkeleton(),
    historyLimit = 100,
  ) {
    this.history = new History(historyLimit);
  }

  static fromJson(json: SpineJson): { document: SpineDocument; issues: ValidationIssue[] } {
    const { data, issues } = parseSpineJson(json);
    return { document: new SpineDocument(data), issues };
  }

  toJson(): SpineJson {
    return serializeSpineJson(this.data);
  }

  toJsonString(space: string | number = '\t'): string {
    return serializeSpineJsonString(this.data, space);
  }

  validate(): ValidationIssue[] {
    return validateSkeleton(this.data);
  }

  execute(command: Command): void {
    this.history.execute(this.data, command);
  }

  undo(): boolean {
    return this.history.undo(this.data);
  }

  redo(): boolean {
    return this.history.redo(this.data);
  }

  findBone(name: string): BoneData | undefined {
    return this.data.bones.find((b) => b.name === name);
  }

  findSlot(name: string): SlotData | undefined {
    return this.data.slots.find((s) => s.name === name);
  }

  getAnimation(name: string): SpineAnimation | undefined {
    return this.data.animations[name];
  }
}
