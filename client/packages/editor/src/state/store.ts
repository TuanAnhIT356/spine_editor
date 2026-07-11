import {
  AddSkinAttachment,
  AddSlot,
  Composite,
  RemoveSkinAttachment,
  RemoveSlot,
  SpineDocument,
  createSlot,
  getAnimationDuration,
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
  /** Where this asset was cut from (segmentation): px, top-left origin. */
  origin?: { x: number; y: number; sourceWidth: number; sourceHeight: number };
}

export type Tool = 'select' | 'translate' | 'rotate' | 'scale' | 'shear' | 'create';

export type AxesMode = 'local' | 'parent' | 'world';

export interface GroupFilter {
  select: boolean;
  visible: boolean;
  labels: boolean;
}

/** Onion-skin ghosting configuration (frames before/after, spacing, opacity). */
export interface GhostConfig {
  before: number;
  after: number;
  spacingFrames: number;
  opacity: number;
}

export interface ViewFilters {
  bones: GroupFilter;
  images: GroupFilter;
  others: GroupFilter;
}
export type SelectionItem = {
  kind: 'bone' | 'slot' | 'ik' | 'transform' | 'path' | 'physics' | 'event' | 'animation';
  name: string;
};
/** Zero or more selected items; the last entry is the "primary" one shown in the properties panel. */
export type Selection = SelectionItem[];

export function isSelected(
  selection: Selection,
  kind: SelectionItem['kind'],
  name: string,
): boolean {
  return selection.some((s) => s.kind === kind && s.name === name);
}

export function primarySelection(selection: Selection): SelectionItem | null {
  return selection.length > 0 ? (selection[selection.length - 1] ?? null) : null;
}

export interface AnimationUiState {
  /** Currently edited animation, or null when none is selected. */
  current: string | null;
  time: number;
  playing: boolean;
  loop: boolean;
  /** Playback rate multiplier (1 = realtime). */
  speed: number;
  /** Onion-skin ghosting of nearby frames while animating. */
  ghost: boolean;
  /** Editor-only playback loop range (seconds); null = full duration. */
  loopStart: number | null;
  loopEnd: number | null;
}

export interface LayoutState {
  hierarchyWidth: number;
  propertiesWidth: number;
  timelineHeight: number;
}

/** Vertex-editing session for a mesh/clipping/boundingbox attachment. */
export interface MeshEditState {
  slot: string;
  attachment: string;
  mode: 'vertices' | 'create' | 'delete' | 'weights';
  /** Bone whose weights are shown/painted in weights mode. */
  paintBone: string | null;
  /** Weight-brush strength 0..1 and behavior. */
  paintAmount: number;
  paintMode: 'add' | 'replace';
}

const LAYOUT_STORAGE_KEY = 'spine-editor:layout';
const DEFAULT_LAYOUT: LayoutState = {
  hierarchyWidth: 250,
  propertiesWidth: 250,
  timelineHeight: 190,
};
const LAYOUT_LIMITS = {
  hierarchyWidth: [160, 520] as const,
  propertiesWidth: [200, 520] as const,
  timelineHeight: [120, 640] as const,
};

function clamp(v: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, v));
}

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      hierarchyWidth: clamp(
        parsed.hierarchyWidth ?? DEFAULT_LAYOUT.hierarchyWidth,
        LAYOUT_LIMITS.hierarchyWidth,
      ),
      propertiesWidth: clamp(
        parsed.propertiesWidth ?? DEFAULT_LAYOUT.propertiesWidth,
        LAYOUT_LIMITS.propertiesWidth,
      ),
      timelineHeight: clamp(
        parsed.timelineHeight ?? DEFAULT_LAYOUT.timelineHeight,
        LAYOUT_LIMITS.timelineHeight,
      ),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(layout: LayoutState): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage may be unavailable (private browsing); layout just won't persist.
  }
}

interface EditorState {
  doc: SpineDocument;
  /** Bumped after every document mutation so React re-renders. */
  revision: number;
  tool: Tool;
  mode: 'setup' | 'animate';
  selection: Selection;
  layout: LayoutState;
  meshEdit: MeshEditState | null;
  /** Skin used to resolve attachments in the viewport ('default' built-in). */
  activeSkin: string;
  assets: Record<string, ImageAsset>;
  error: string | null;
  anim: AnimationUiState;
  /** Onion-skin ghosting knobs (editor-only, never serialized). */
  ghostConfig: GhostConfig;
  /** Gizmo/drag space for transform tools (Spine-style Local/Parent/World). */
  axesMode: AxesMode;
  /** Per-group selectability / visibility / name-label toggles (tool cluster). */
  viewFilters: ViewFilters;
  /** When off, animate-mode edits are blocked instead of auto-keyed. */
  autoKey: boolean;
  panelVisibility: { tree: boolean; timeline: boolean };
  /** revision at the last save/open — dirty indicator = revision !== savedRevision. */
  savedRevision: number;
  /** Editor-only viewport hiding (never serialized): bone gizmos / slot sprites. */
  hiddenBones: string[];
  /** Transient pose overlay while Auto Key is off (editor-only, never serialized). */
  posePreview: Record<
    string,
    Partial<Record<'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY', number>>
  > | null;
  hiddenSlots: string[];

  setTool(tool: Tool): void;
  setMode(mode: 'setup' | 'animate'): void;
  select(item: SelectionItem | null): void;
  toggleSelection(item: SelectionItem): void;
  addToSelection(item: SelectionItem): void;
  selectAllBones(): void;
  startMeshEdit(slot: string, attachment: string): void;
  endMeshEdit(): void;
  setMeshEditMode(mode: MeshEditState['mode']): void;
  setPaintBone(bone: string | null): void;
  setPaintAmount(amount: number): void;
  setPaintMode(mode: 'add' | 'replace'): void;
  setActiveSkin(name: string): void;
  resizeHierarchy(deltaPx: number): void;
  resizeProperties(deltaPx: number): void;
  resizeTimeline(deltaPx: number): void;
  setError(message: string | null): void;
  setAnimation(name: string | null): void;
  setAnimTime(time: number): void;
  setPlaying(playing: boolean): void;
  setLoop(loop: boolean): void;
  setSpeed(speed: number): void;
  setGhost(ghost: boolean): void;
  setGhostConfig(patch: Partial<GhostConfig>): void;
  setAxesMode(mode: AxesMode): void;
  toggleViewFilter(group: keyof ViewFilters, key: keyof GroupFilter): void;
  setAutoKey(on: boolean): void;
  togglePanel(panel: 'tree' | 'timeline'): void;
  setLoopRange(start: number | null, end: number | null): void;
  setPosePreview(bone: string, patch: Record<string, number>): void;
  clearPosePreview(): void;
  toggleBoneHidden(name: string): void;
  toggleSlotHidden(name: string): void;
  /** Marks the current revision as saved (clears the dirty indicator). */
  markSaved(): void;
  /** Steps the playhead by `frames` at 30fps, clamped to [0, duration]. */
  stepFrame(frames: number): void;
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
  selection: [],
  layout: loadLayout(),
  meshEdit: null,
  activeSkin: 'default',
  assets: {},
  error: null,
  anim: {
    current: null,
    time: 0,
    playing: false,
    loop: true,
    speed: 1,
    ghost: false,
    loopStart: null,
    loopEnd: null,
  },
  ghostConfig: { before: 2, after: 2, spacingFrames: 4, opacity: 0.5 },
  axesMode: 'local',
  viewFilters: {
    bones: { select: true, visible: true, labels: false },
    images: { select: true, visible: true, labels: false },
    others: { select: true, visible: true, labels: false },
  },
  autoKey: true,
  panelVisibility: { tree: true, timeline: true },
  savedRevision: 0,
  hiddenBones: [],
  hiddenSlots: [],
  posePreview: null,

  setTool: (tool) => set({ tool }),
  setMode: (mode) =>
    set((s) => {
      // Entering animate mode with nothing selected: pick the first animation.
      const names = Object.keys(s.doc.data.animations);
      const current =
        mode === 'animate' && s.anim.current === null ? (names[0] ?? null) : s.anim.current;
      return { mode, anim: { ...s.anim, current, playing: false }, posePreview: null };
    }),
  select: (item) => set({ selection: item ? [item] : [] }),
  toggleSelection: (item) =>
    set((s) => {
      const exists = s.selection.some((sel) => sel.kind === item.kind && sel.name === item.name);
      return {
        selection: exists
          ? s.selection.filter((sel) => !(sel.kind === item.kind && sel.name === item.name))
          : [...s.selection, item],
      };
    }),
  addToSelection: (item) =>
    set((s) =>
      s.selection.some((sel) => sel.kind === item.kind && sel.name === item.name)
        ? s
        : { selection: [...s.selection, item] },
    ),
  selectAllBones: () =>
    set((s) => ({
      selection: s.doc.data.bones.map((b) => ({ kind: 'bone' as const, name: b.name })),
    })),
  startMeshEdit: (slot, attachment) =>
    set({
      meshEdit: {
        slot,
        attachment,
        mode: 'vertices',
        paintBone: null,
        paintAmount: 0.2,
        paintMode: 'add',
      },
      selection: [{ kind: 'slot', name: slot }],
    }),
  endMeshEdit: () => set({ meshEdit: null }),
  setMeshEditMode: (mode) => set((s) => (s.meshEdit ? { meshEdit: { ...s.meshEdit, mode } } : s)),
  setPaintBone: (bone) =>
    set((s) => (s.meshEdit ? { meshEdit: { ...s.meshEdit, paintBone: bone } } : s)),
  setPaintAmount: (paintAmount) =>
    set((s) => (s.meshEdit ? { meshEdit: { ...s.meshEdit, paintAmount } } : s)),
  setPaintMode: (paintMode) =>
    set((s) => (s.meshEdit ? { meshEdit: { ...s.meshEdit, paintMode } } : s)),
  setActiveSkin: (name) => set({ activeSkin: name }),
  resizeHierarchy: (deltaPx) =>
    set((s) => {
      const layout = {
        ...s.layout,
        hierarchyWidth: clamp(s.layout.hierarchyWidth + deltaPx, LAYOUT_LIMITS.hierarchyWidth),
      };
      saveLayout(layout);
      return { layout };
    }),
  resizeProperties: (deltaPx) =>
    set((s) => {
      const layout = {
        ...s.layout,
        propertiesWidth: clamp(s.layout.propertiesWidth - deltaPx, LAYOUT_LIMITS.propertiesWidth),
      };
      saveLayout(layout);
      return { layout };
    }),
  resizeTimeline: (deltaPx) =>
    set((s) => {
      const layout = {
        ...s.layout,
        timelineHeight: clamp(s.layout.timelineHeight - deltaPx, LAYOUT_LIMITS.timelineHeight),
      };
      saveLayout(layout);
      return { layout };
    }),
  setError: (error) => set({ error }),
  setAnimation: (name) =>
    set((s) => ({
      anim: { ...s.anim, current: name, time: 0, playing: false, loopStart: null, loopEnd: null },
      posePreview: null,
    })),
  setAnimTime: (time) =>
    set((s) => ({ anim: { ...s.anim, time: Math.max(0, time) }, posePreview: null })),
  setPlaying: (playing) => set((s) => ({ anim: { ...s.anim, playing } })),
  setLoop: (loop) => set((s) => ({ anim: { ...s.anim, loop } })),
  setSpeed: (speed) =>
    set((s) => ({ anim: { ...s.anim, speed: Math.min(4, Math.max(0.1, speed)) } })),
  setGhost: (ghost) => set((s) => ({ anim: { ...s.anim, ghost } })),
  setGhostConfig: (patch) => set((s) => ({ ghostConfig: { ...s.ghostConfig, ...patch } })),
  setAxesMode: (axesMode) => set({ axesMode }),
  toggleViewFilter: (group, key) =>
    set((s) => ({
      viewFilters: {
        ...s.viewFilters,
        [group]: { ...s.viewFilters[group], [key]: !s.viewFilters[group][key] },
      },
    })),
  setAutoKey: (autoKey) => set({ autoKey }),
  togglePanel: (panel) =>
    set((s) => ({
      panelVisibility: { ...s.panelVisibility, [panel]: !s.panelVisibility[panel] },
    })),
  setLoopRange: (start, end) =>
    set((s) => ({ anim: { ...s.anim, loopStart: start, loopEnd: end } })),
  setPosePreview: (bone, patch) =>
    set((s) => ({
      posePreview: {
        ...(s.posePreview ?? {}),
        [bone]: { ...(s.posePreview?.[bone] ?? {}), ...patch },
      },
    })),
  clearPosePreview: () => set({ posePreview: null }),
  toggleBoneHidden: (name) =>
    set((s) => ({
      hiddenBones: s.hiddenBones.includes(name)
        ? s.hiddenBones.filter((n) => n !== name)
        : [...s.hiddenBones, name],
    })),
  toggleSlotHidden: (name) =>
    set((s) => ({
      hiddenSlots: s.hiddenSlots.includes(name)
        ? s.hiddenSlots.filter((n) => n !== name)
        : [...s.hiddenSlots, name],
    })),
  markSaved: () => set((s) => ({ savedRevision: s.revision })),
  stepFrame: (frames) =>
    set((s) => {
      const anim = s.anim.current ? s.doc.getAnimation(s.anim.current) : undefined;
      if (!anim) return s;
      const duration = getAnimationDuration(anim);
      const step = 1 / 30;
      const time = Math.min(
        duration,
        Math.max(0, Math.round((s.anim.time + frames * step) / step) * step),
      );
      return { anim: { ...s.anim, time, playing: false } };
    }),

  execute: (command) => {
    const { doc } = get();
    try {
      doc.execute(command);
      set((s) => ({
        revision: s.revision + 1,
        error: null,
        // The command may have removed/renamed the current animation.
        anim:
          s.anim.current !== null && !(s.anim.current in doc.data.animations)
            ? { ...s.anim, current: null, playing: false }
            : s.anim,
      }));
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
    const { doc, assets, execute, activeSkin } = get();
    const asset = assets[assetName];
    if (!asset) return;
    // If a slot with a same-named attachment placeholder exists, add the image
    // to the ACTIVE skin for that slot (skin variants); otherwise create a new
    // slot with the attachment in the active skin.
    const skinName = doc.data.skins.some((s) => s.name === activeSkin) ? activeSkin : 'default';
    const slotName = uniqueName(asset.name, (n) => doc.data.slots.some((s) => s.name === n));
    const ok = execute(
      new Composite(`Attach "${asset.name}"`, [
        new AddSlot(createSlot(slotName, boneName, { attachment: asset.name })),
        new AddSkinAttachment(skinName, slotName, asset.name, {
          width: asset.width,
          height: asset.height,
        }),
      ]),
    );
    if (ok) set({ selection: [{ kind: 'slot', name: slotName }] });
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
    if (execute(new Composite(`Remove slot "${slotName}"`, commands))) {
      set((s) => ({
        selection: s.selection.filter((sel) => sel.name !== slotName),
        meshEdit: s.meshEdit?.slot === slotName ? null : s.meshEdit,
      }));
    }
  },

  replaceProject: (json, assets) => {
    const { data, issues } = parseSpineJson(json);
    set((s) => ({
      doc: new SpineDocument(data),
      assets: Object.fromEntries(assets.map((a) => [a.name, a])),
      selection: [],
      meshEdit: null,
      error: null,
      revision: s.revision + 1,
      savedRevision: s.revision + 1,
      anim: {
        current: null,
        time: 0,
        playing: false,
        loop: true,
        speed: 1,
        ghost: false,
        loopStart: null,
        loopEnd: null,
      },
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
