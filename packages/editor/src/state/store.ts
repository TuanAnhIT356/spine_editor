import {
  AddSkinAttachment,
  AddSlot,
  Composite,
  RemoveSkinAttachment,
  RemoveSlot,
  SpineDocument,
  createSlot,
  parseSpineJson,
  type Command,
  type SpineJson,
  type ValidationIssue,
} from '@spine-editor/core';
import { create } from 'zustand';

export interface ImageAsset {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

export type Tool = 'select' | 'translate' | 'rotate' | 'create';
export type Selection = { kind: 'bone' | 'slot'; name: string } | null;

interface EditorState {
  doc: SpineDocument;
  /** Bumped after every document mutation so React re-renders. */
  revision: number;
  tool: Tool;
  mode: 'setup' | 'animate';
  selection: Selection;
  assets: Record<string, ImageAsset>;
  error: string | null;

  setTool(tool: Tool): void;
  setMode(mode: 'setup' | 'animate'): void;
  select(selection: Selection): void;
  setError(message: string | null): void;
  execute(command: Command): boolean;
  undo(): void;
  redo(): void;
  addAssets(assets: ImageAsset[]): void;
  attachAsset(assetName: string, boneName: string): void;
  removeSlotCascade(slotName: string): void;
  replaceProject(json: SpineJson, assets: ImageAsset[]): ValidationIssue[];
}

export function uniqueName(base: string, exists: (name: string) => boolean): string {
  if (!exists(base)) return base;
  for (let i = 2; ; i++) {
    const name = `${base}${i}`;
    if (!exists(name)) return name;
  }
}

export const useEditor = create<EditorState>()((set, get) => ({
  doc: new SpineDocument(),
  revision: 0,
  tool: 'select',
  mode: 'setup',
  selection: null,
  assets: {},
  error: null,

  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode }),
  select: (selection) => set({ selection }),
  setError: (error) => set({ error }),

  execute: (command) => {
    const { doc } = get();
    try {
      doc.execute(command);
      set((s) => ({ revision: s.revision + 1, error: null }));
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  undo: () => {
    if (get().doc.undo()) set((s) => ({ revision: s.revision + 1 }));
  },

  redo: () => {
    if (get().doc.redo()) set((s) => ({ revision: s.revision + 1 }));
  },

  addAssets: (assets) =>
    set((s) => {
      const next = { ...s.assets };
      for (const asset of assets) next[asset.name] = asset;
      return { assets: next };
    }),

  attachAsset: (assetName, boneName) => {
    const { doc, assets, execute } = get();
    const asset = assets[assetName];
    if (!asset) return;
    const slotName = uniqueName(asset.name, (n) => doc.data.slots.some((s) => s.name === n));
    const ok = execute(
      new Composite(`Attach "${asset.name}"`, [
        new AddSlot(createSlot(slotName, boneName, { attachment: asset.name })),
        new AddSkinAttachment('default', slotName, asset.name, {
          width: asset.width,
          height: asset.height,
        }),
      ]),
    );
    if (ok) set({ selection: { kind: 'slot', name: slotName } });
  },

  removeSlotCascade: (slotName) => {
    const { doc, execute } = get();
    const commands: Command[] = [];
    for (const skin of doc.data.skins) {
      for (const att of Object.keys(skin.attachments?.[slotName] ?? {})) {
        commands.push(new RemoveSkinAttachment(skin.name, slotName, att));
      }
    }
    commands.push(new RemoveSlot(slotName));
    if (execute(new Composite(`Remove slot "${slotName}"`, commands))) set({ selection: null });
  },

  replaceProject: (json, assets) => {
    const { data, issues } = parseSpineJson(json);
    set((s) => ({
      doc: new SpineDocument(data),
      assets: Object.fromEntries(assets.map((a) => [a.name, a])),
      selection: null,
      error: null,
      revision: s.revision + 1,
    }));
    return issues;
  },
}));

declare global {
  interface Window {
    /** Exposed for e2e tests and (later) the MCP bridge. */
    __spineEditor?: typeof useEditor;
  }
}
