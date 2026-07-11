# Phase 15 — UI Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor opens looking like Spine: dark-gray theme, compact titlebar with a file menu, SETUP/ANIMATE banner inside the viewport, a floating bottom tool cluster (6 tools + live Rotate/Translate/Scale/Shear numeric boxes + Local/Parent/World axes + selection-filter matrix + Auto Key), a bone breadcrumb, and a zoom slider — without touching Hierarchy/Properties/Timeline internals (U2/U3).

**Architecture:** All shell pieces are new small components overlaid on the existing Viewport/App; state additions live in the zustand store (`axesMode`, `viewFilters`, `autoKey`, `panelVisibility`, `savedRevision`). Numeric edits reuse the exact auto-key semantics the viewport drags already use (offsets vs setup pose; scale = factors), extracted into one shared helper. Every commit stays green — old toolbar groups are removed in the same task that lands their replacement, together with the e2e selector updates.

**Tech Stack:** React + zustand + PixiJS renderer hooks, hand-drawn inline SVG icons, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-11-spine-parity-roadmap-and-ui-shell-design.md` §3

## Global Constraints

- Branch `claude/phase15-ui-shell` (spec committed). All pnpm from `client/` (shim PATH: `/private/tmp/claude-501/-Users-tuananh-Projects-you-spine-editor/6b990f26-97bc-4e20-b105-3db5aab338c5/scratchpad/bin`).
- **Own SVG icons only** — never copy Esoteric assets. `currentColor` strokes, 14–16 px.
- Keep e2e-critical button texts unique: tool buttons keep visible text (`Create`, `Translate`, `Rotate`, …); numeric-box labels are `<span>`, NOT buttons (so `button:has-text("Rotate")` still matches only the tool).
- Editor has no unit tests — the test cycle per task is `pnpm typecheck && pnpm build` + the four e2e in Task 6 (smoke/anim updated there; bridge/chat must pass untouched).
- Keyframe semantics (core invariant): rotate/translate/shear keys are OFFSETS from setup; scale keys are FACTORS (key.x = local.scaleX / setup.scaleX).
- Every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Store fields + theme tokens

**Files:**

- Modify: `client/packages/editor/src/state/store.ts` (state + actions)
- Modify: `client/packages/editor/src/styles.css` (`:root` tokens + hex sweep)

**Interfaces (Produces):**

```ts
export type AxesMode = 'local' | 'parent' | 'world';
export interface GroupFilter { select: boolean; visible: boolean; labels: boolean }
export interface ViewFilters { bones: GroupFilter; images: GroupFilter; others: GroupFilter }
// EditorState additions:
axesMode: AxesMode;                 // default 'local'
viewFilters: ViewFilters;           // default select+visible true, labels false
autoKey: boolean;                   // default true
panelVisibility: { hierarchy: boolean; properties: boolean; timeline: boolean }; // all true
savedRevision: number;              // dirty = revision !== savedRevision
setAxesMode(mode: AxesMode): void;
toggleViewFilter(group: keyof ViewFilters, key: keyof GroupFilter): void;
setAutoKey(on: boolean): void;
togglePanel(panel: 'hierarchy' | 'properties' | 'timeline'): void;
markSaved(): void;                  // savedRevision = revision
```

- [ ] **Step 1: store.ts** — add the fields to `interface EditorState` (after `anim`) and the five actions (after `setGhost`). Implementation in the `create` body:

```ts
  axesMode: 'local',
  viewFilters: {
    bones: { select: true, visible: true, labels: false },
    images: { select: true, visible: true, labels: false },
    others: { select: true, visible: true, labels: false },
  },
  autoKey: true,
  panelVisibility: { hierarchy: true, properties: true, timeline: true },
  savedRevision: 0,
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
    set((s) => ({ panelVisibility: { ...s.panelVisibility, [panel]: !s.panelVisibility[panel] } })),
  markSaved: () => set((s) => ({ savedRevision: s.revision })),
```

Also: in `replaceProject(...)` implementation add `savedRevision` reset — find its `set({...})`/end and append `get().markSaved();` after the project is replaced. Export the three new types (`AxesMode`, `GroupFilter`, `ViewFilters`).

- [ ] **Step 2: mark saves** — `client/packages/editor/src/state/actions.ts`: in `saveProjectFile` (after the download succeeds) call `useEditor.getState().markSaved();`.

- [ ] **Step 3: theme tokens** — at the very top of `styles.css` (after the `*` reset), add:

```css
:root {
  --bg: #2b2b2e;
  --panel: #3a3d40;
  --panel-2: #323538;
  --border: #27292b;
  --text: #d8d8d8;
  --text-dim: #9a9a9a;
  --accent: #3875b7;
  --accent-soft: #31527d;
  --warn: #e8a13c;
}
```

Then sweep the existing hexes to tokens (exact pairs, `perl -i -pe` per pair over styles.css):

| old                             | new                  |
| ------------------------------- | -------------------- |
| `#1b1b1f`                       | `var(--bg)`          |
| `#26262b`                       | `var(--panel-2)`     |
| `#2b2f35`, `#2e2e34`, `#2e333a` | `var(--panel-2)`     |
| `#23262b`                       | `var(--panel-2)`     |
| `#333339`, `#38383f`, `#3a3f46` | `var(--border)`      |
| `#d6d6dc`                       | `var(--text)`        |
| `#31527d`                       | `var(--accent-soft)` |
| `#e8a13c`                       | `var(--warn)`        |

Then bump the two anchor surfaces to the Spine-gray look: `body { background: var(--bg) }` stays; panels (`.toolbar`, panel containers) get `background: var(--panel)` where they used `--panel-2` and looked too dark — adjust ONLY `.toolbar` and `.chat-header` to `var(--panel)`. (The point of this task is tokens + slightly lighter gray chrome; per-component styling lands with each component.)

- [ ] **Step 4: verify + commit**

```bash
pnpm typecheck && pnpm build && pnpm lint && pnpm format:check
git add packages/editor/src/state/store.ts packages/editor/src/state/actions.ts packages/editor/src/styles.css
git commit -m "P15: theme tokens + shell state (axes, filters, autoKey, panels, dirty)"
```

---

### Task 2: icons + titlebar (menu ☰, icon buttons, project name, Views ▾)

**Files:**

- Create: `client/packages/editor/src/components/icons.tsx`
- Modify: `client/packages/editor/src/components/Toolbar.tsx`
- Modify: `client/packages/editor/src/App.tsx` (panelVisibility gating)
- Modify: `client/packages/editor/src/styles.css` (titlebar + dropdown styles)

**Interfaces:**

- Consumes: Task 1 `panelVisibility`/`togglePanel`/`savedRevision`; existing Toolbar handlers (`onNewProject`, `saveProjectFile`, `onExportJson`, `onExportAtlas`, hidden inputs `imagesInput`/`projectInput`/`spineJsonInput`/`atlasInput`).
- Produces: `Icon` components: `MenuIcon, OpenIcon, SaveIcon, UndoIcon, RedoIcon, SelectIcon, TranslateIcon, RotateIcon, ScaleIcon, ShearIcon, CreateIcon, SetupIcon, AnimateIcon, EyeIcon, TagIcon, CursorIcon, KeyIcon` (all `(props: {size?: number}) => JSX`); `.titlebar-menu` dropdown pattern (open state local, closes on outside click).

- [ ] **Step 1: `icons.tsx`** — one file, every icon a small function returning inline SVG. Full code:

```tsx
/** Hand-drawn icon set (no third-party assets). Single-color strokes. */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function svg(size: number | undefined, children: React.ReactNode) {
  return (
    <svg width={size ?? 15} height={size ?? 15} viewBox="0 0 16 16" {...S}>
      {children}
    </svg>
  );
}

export const MenuIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M2 4h12" />
      <path d="M2 8h12" />
      <path d="M2 12h12" />
    </>,
  );
export const OpenIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M2 13V4h4l1.5 2H14v7z" />);
export const SaveIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M3 3h8l2 2v8H3z" />
      <path d="M5 3v4h5V3" />
      <path d="M5 13v-4h6v4" />
    </>,
  );
export const UndoIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M6 4 3 7l3 3" />
      <path d="M3 7h7a3 3 0 0 1 0 6H8" />
    </>,
  );
export const RedoIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="m10 4 3 3-3 3" />
      <path d="M13 7H6a3 3 0 0 0 0 6h2" />
    </>,
  );
export const SelectIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M4 2l8 7-3.5.5L10 13l-2 1-1.5-3.5L4 12z" />);
export const TranslateIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M8 2v12M2 8h12" />
      <path d="m8 2-1.5 2M8 2l1.5 2M8 14l-1.5-2m1.5 2 1.5-2M2 8l2-1.5M2 8l2 1.5M14 8l-2-1.5m2 1.5-2 1.5" />
    </>,
  );
export const RotateIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M13 8a5 5 0 1 1-2-4" />
      <path d="M11 1v3h3" />
    </>,
  );
export const ScaleIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <rect x="2" y="7" width="7" height="7" />
      <path d="M9 7h5V2H7v5" />
      <path d="m10 6 3-3" />
    </>,
  );
export const ShearIcon = ({ size }: { size?: number }) => svg(size, <path d="M5 3h9l-3 10H2z" />);
export const CreateIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="4" cy="12" r="1.6" />
      <path d="m5 11 7-7" />
      <path d="M12 4l2-2" />
    </>,
  );
export const SetupIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="8" cy="3.2" r="1.7" />
      <path d="M8 5v5M8 10l-2.5 4M8 10l2.5 4M8 6.5 4.5 8M8 6.5l3.5 1.5" />
    </>,
  );
export const AnimateIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="10" cy="3.2" r="1.7" />
      <path d="M10 5 7 8l-3 1M7 8l1 3-2 3M8 11l4 1 1.5 2M10 5l3 2" />
    </>,
  );
export const EyeIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </>,
  );
export const TagIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M2 2h5l7 7-5 5-7-7z" />
      <circle cx="5.5" cy="5.5" r="1" />
    </>,
  );
export const CursorIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M5 2l7 6-3 .5L11 12l-1.7 1L7.5 9.6 5 11z" />);
export const KeyIcon = ({ size }: { size?: number }) => svg(size, <path d="M8 3l4 5-4 5-4-5z" />);
```

Add `import type React from 'react';` if the JSX transform needs it (match neighboring components).

- [ ] **Step 2: Toolbar rewrite (render part only)** — keep ALL existing handlers/state/hidden inputs; replace the returned JSX groups:

```tsx
const dirty = useEditor((s) => s.revision !== s.savedRevision);
const panels = useEditor((s) => s.panelVisibility);
const [showMenu, setShowMenu] = useState(false);
const [showViews, setShowViews] = useState(false);
const projectName = useServer((s) => s.projectName) || 'untitled';
```

```tsx
return (
  <div className="toolbar titlebar">
    <span className="brand">spine editor</span>
    <div className="menu-wrap">
      <button className="icon-btn" title="Menu" onClick={() => setShowMenu((v) => !v)}>
        <MenuIcon />
      </button>
      {showMenu && (
        <div className="dropdown" onClick={() => setShowMenu(false)}>
          <button onClick={onNewProject}>New</button>
          <button onClick={() => projectInput.current?.click()}>Open Project</button>
          <button
            onClick={() => {
              saveProjectFile();
              useEditor.getState().markSaved();
            }}
          >
            Save Project
          </button>
          <hr />
          <button onClick={() => imagesInput.current?.click()}>Import Images</button>
          <button onClick={() => spineJsonInput.current?.click()}>Import JSON</button>
          <button onClick={() => atlasInput.current?.click()}>Import Atlas</button>
          <hr />
          <button onClick={onExportJson}>Export JSON</button>
          <button onClick={() => void onExportAtlas()}>Export Atlas</button>
        </div>
      )}
    </div>
    <button
      className="icon-btn"
      title="Open Project (Ctrl+O)"
      onClick={() => projectInput.current?.click()}
    >
      <OpenIcon />
    </button>
    <button
      className="icon-btn"
      title="Save Project (Ctrl+S)"
      onClick={() => {
        saveProjectFile();
        useEditor.getState().markSaved();
      }}
    >
      <SaveIcon />
    </button>
    <button
      className="icon-btn"
      disabled={!doc.history.canUndo}
      title="Undo (Ctrl+Z)"
      onClick={() => useEditor.getState().undo()}
    >
      <UndoIcon />
    </button>
    <button
      className="icon-btn"
      disabled={!doc.history.canRedo}
      title="Redo (Ctrl+Shift+Z)"
      onClick={() => useEditor.getState().redo()}
    >
      <RedoIcon />
    </button>
    <span className="project-name">
      {dirty ? '*' : ''}
      {projectName}
    </span>
    <div className="spacer" />
    <div className="group">
      {/* Server / Projects / Generate / Segment / Chat buttons — UNCHANGED from current file */}
    </div>
    <div className="menu-wrap">
      <button className="icon-btn views-btn" onClick={() => setShowViews((v) => !v)}>
        Views ▾
      </button>
      {showViews && (
        <div className="dropdown">
          {(['hierarchy', 'properties', 'timeline'] as const).map((p) => (
            <label key={p} className="views-item">
              <input
                type="checkbox"
                checked={panels[p]}
                disabled={p === 'timeline' && mode === 'setup'}
                onChange={() => useEditor.getState().togglePanel(p)}
              />
              {p === 'hierarchy' ? 'Tree' : p[0]!.toUpperCase() + p.slice(1)}
            </label>
          ))}
        </div>
      )}
    </div>
    {/* hidden file inputs + modals — UNCHANGED */}
  </div>
);
```

Notes: KEEP the `TOOLS` group and the `.modes` group in the JSX for now (they are removed in Task 3 together with their replacements + e2e updates). Place them between the project name and the spacer so nothing breaks. Keep the imports for the new icons.

- [ ] **Step 3: App.tsx** — gate panels:

```tsx
const panels = useEditor((s) => s.panelVisibility);
...
{panels.hierarchy && <HierarchyPanel />}
{panels.hierarchy && <Resizer axis="x" ... />}
<Viewport />
{panels.properties && <Resizer axis="x" ... />}
{panels.properties && <PropertiesPanel />}
...
{mode === 'animate' && panels.timeline && (<>...Timeline block...</>)}
```

- [ ] **Step 4: styles** — append to styles.css:

```css
/* ---- titlebar ---- */
.titlebar {
  gap: 4px;
}
.titlebar .brand {
  font-weight: 700;
  letter-spacing: 0.5px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
}
.project-name {
  margin-left: 8px;
  color: var(--text-dim);
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.menu-wrap {
  position: relative;
}
.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 40;
  min-width: 160px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  padding: 4px;
}
.dropdown button {
  text-align: left;
}
.dropdown hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 4px 0;
}
.views-item {
  display: flex;
  gap: 6px;
  padding: 4px 6px;
  align-items: center;
}
```

- [ ] **Step 5: verify + commit** — `pnpm typecheck && pnpm build && pnpm lint && pnpm format:check`; manual: open dev server, menu opens/closes, dirty star appears after an edit and clears on Save.

```bash
git add packages/editor/src/components/icons.tsx packages/editor/src/components/Toolbar.tsx packages/editor/src/App.tsx packages/editor/src/styles.css
git commit -m "P15: titlebar with file menu, icon actions, dirty star, Views dropdown"
```

---

### Task 3: mode banner + tool cluster (numeric boxes, Scale/Shear tools, Auto Key) + e2e updates

**Files:**

- Create: `client/packages/editor/src/state/bone-edit.ts`
- Create: `client/packages/editor/src/components/ModeBanner.tsx`
- Create: `client/packages/editor/src/components/ToolCluster.tsx`
- Modify: `client/packages/editor/src/components/Viewport.tsx` (overlay mount + scale/shear drags + autoKey gate)
- Modify: `client/packages/editor/src/state/store.ts` (`Tool` union + shortcuts)
- Modify: `client/packages/editor/src/shortcuts.ts` (keys 5/6)
- Modify: `client/packages/editor/src/components/Toolbar.tsx` (remove TOOLS + .modes groups)
- Modify: `client/packages/editor/e2e/anim.mjs` (`.modes` → `.mode-banner`)
- Modify: `client/packages/editor/src/styles.css`

**Interfaces:**

- Consumes: Task 1 `autoKey`; existing `SetBoneTransform`, `UpsertBoneKeyframe`, `Composite`, `makeKey`/`round2` patterns from Viewport (lines ~604–650).
- Produces: `applyBoneEdit(boneName: string, patch: BonePatch): boolean` where `BonePatch = { rotation?, x?, y?, scaleX?, scaleY?, shearX?, shearY? }` (absolute LOCAL values; helper converts to offsets/factors for animate auto-key); `Tool` union gains `'scale' | 'shear'`; `.mode-banner`, `.tool-cluster` DOM.

- [ ] **Step 1: `bone-edit.ts`** (full code):

```ts
/**
 * One write path for bone transform edits (numeric boxes now, more later):
 * setup mode patches the setup pose; animate mode with Auto Key writes
 * keyframes with the same offset/factor semantics the viewport drags use.
 */

import {
  Composite,
  SetBoneTransform,
  UpsertBoneKeyframe,
  type BoneTransformPatch,
  type SpineBoneKey,
} from '@spine-editor/core';
import { useEditor } from './store.js';

export type BonePatch = Partial<
  Record<'rotation' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY', number>
>;

const r2 = (v: number) => Math.round(v * 100) / 100;

function key(time: number, fields: Partial<SpineBoneKey>): SpineBoneKey {
  const k: SpineBoneKey = {};
  if (time > 0) k.time = time;
  Object.assign(k, fields);
  return k;
}

/** Applies ABSOLUTE local values. Returns false when blocked (Auto Key off in animate). */
export function applyBoneEdit(boneName: string, patch: BonePatch): boolean {
  const s = useEditor.getState();
  const setup = s.doc.findBone(boneName);
  if (!setup) return false;
  const animating = s.mode === 'animate' && s.anim.current;
  if (!animating) {
    const p: BoneTransformPatch = {};
    for (const [k, v] of Object.entries(patch)) p[k as keyof BoneTransformPatch] = r2(v!);
    return s.execute(new SetBoneTransform(boneName, p));
  }
  if (!s.autoKey) {
    s.setError('Auto Key is off — enable it to key changes in animate mode.');
    return false;
  }
  const anim = s.anim.current!;
  const t = s.anim.time;
  const cmds = [];
  if (patch.rotation !== undefined) {
    cmds.push(
      new UpsertBoneKeyframe(
        anim,
        boneName,
        'rotate',
        key(t, { value: r2(patch.rotation - setup.rotation) }),
      ),
    );
  }
  if (patch.x !== undefined || patch.y !== undefined) {
    cmds.push(
      new UpsertBoneKeyframe(
        anim,
        boneName,
        'translate',
        key(t, {
          x: r2((patch.x ?? setup.x) - setup.x),
          y: r2((patch.y ?? setup.y) - setup.y),
        }),
      ),
    );
  }
  if (patch.scaleX !== undefined || patch.scaleY !== undefined) {
    cmds.push(
      new UpsertBoneKeyframe(
        anim,
        boneName,
        'scale',
        key(t, {
          x: r2((patch.scaleX ?? setup.scaleX) / (setup.scaleX || 1)),
          y: r2((patch.scaleY ?? setup.scaleY) / (setup.scaleY || 1)),
        }),
      ),
    );
  }
  if (patch.shearX !== undefined || patch.shearY !== undefined) {
    cmds.push(
      new UpsertBoneKeyframe(
        anim,
        boneName,
        'shear',
        key(t, {
          x: r2((patch.shearX ?? setup.shearX) - setup.shearX),
          y: r2((patch.shearY ?? setup.shearY) - setup.shearY),
        }),
      ),
    );
  }
  if (cmds.length === 0) return true;
  if (cmds.length === 1) return s.execute(cmds[0]!);
  return s.execute(new Composite(`Edit ${boneName}`, cmds));
}

/** Parses Spine-style numeric entry: "12", "+5" (add), "*2" (multiply), "/2" (divide). */
export function parseNumeric(input: string, current: number): number | null {
  const t = input.trim();
  const m = /^([+*/])?(-?\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[2]);
  if (m[1] === '+') return current + v;
  if (m[1] === '*') return current * v;
  if (m[1] === '/') return v === 0 ? null : current / v;
  return v;
}
```

Check `setup.shearX`/`shearY` exist on `BoneData` (they do — `set_bone_transform` op patches them). If `findBone` has a different name (e.g. `doc.findBone` vs `doc.data.bones.find`), match Viewport's usage at line ~611.

- [ ] **Step 2: `ModeBanner.tsx`** (full code):

```tsx
import { useEditor } from '../state/store.js';
import { AnimateIcon, SetupIcon } from './icons.js';

/** Spine-style mode label in the viewport's top-left; click toggles mode. */
export function ModeBanner() {
  const mode = useEditor((s) => s.mode);
  return (
    <button
      className="mode-banner"
      title="Switch mode"
      onClick={() => useEditor.getState().setMode(mode === 'setup' ? 'animate' : 'setup')}
    >
      {mode === 'setup' ? <SetupIcon size={28} /> : <AnimateIcon size={28} />}
      <span>{mode === 'setup' ? 'SETUP' : 'ANIMATE'}</span>
    </button>
  );
}
```

- [ ] **Step 3: `ToolCluster.tsx`** (full code):

```tsx
import { useState } from 'react';
import { computeAnimatedLocals } from '@spine-editor/core';
import { primarySelection, useEditor, type Tool } from '../state/store.js';
import { applyBoneEdit, parseNumeric, type BonePatch } from '../state/bone-edit.js';
import {
  CreateIcon,
  CursorIcon,
  EyeIcon,
  KeyIcon,
  RotateIcon,
  ScaleIcon,
  SelectIcon,
  ShearIcon,
  TagIcon,
  TranslateIcon,
} from './icons.js';

const TOOLS: { id: Tool; label: string; icon: () => JSX.Element; setupOnly?: boolean }[] = [
  { id: 'select', label: 'Select', icon: () => <SelectIcon /> },
  { id: 'translate', label: 'Translate', icon: () => <TranslateIcon /> },
  { id: 'rotate', label: 'Rotate', icon: () => <RotateIcon /> },
  { id: 'scale', label: 'Scale', icon: () => <ScaleIcon /> },
  { id: 'shear', label: 'Shear', icon: () => <ShearIcon /> },
  { id: 'create', label: 'Create', icon: () => <CreateIcon />, setupOnly: true },
];

/** One numeric field; commits on Enter/blur with +,*,/ prefixes. */
function NumBox({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="num-box"
      value={text ?? value.toFixed(2)}
      onFocus={(e) => {
        setText(value.toFixed(2));
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        if (text !== null) {
          const v = parseNumeric(text, value);
          if (v !== null && Math.abs(v - value) > 1e-9) onCommit(v);
        }
        setText(null);
      }}
    />
  );
}

export function ToolCluster() {
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.mode);
  const axes = useEditor((s) => s.axesMode);
  const filters = useEditor((s) => s.viewFilters);
  const autoKey = useEditor((s) => s.autoKey);
  const selection = useEditor((s) => s.selection);
  const revision = useEditor((s) => s.revision);
  const anim = useEditor((s) => s.anim);
  void revision;
  void anim.time; // re-render on doc/time changes

  const primary = primarySelection(selection);
  const bone = primary?.kind === 'bone' ? useEditor.getState().doc.findBone(primary.name) : null;
  // In animate mode show the ANIMATED locals so boxes match the pose on screen.
  const shown = (() => {
    if (!bone) return null;
    if (mode !== 'animate' || !anim.current) return bone;
    const locals = computeAnimatedLocals(useEditor.getState().doc.data, anim.current, anim.time);
    return locals.find((b) => b.name === bone.name) ?? bone;
  })();

  function commit(patch: BonePatch) {
    if (!primary || primary.kind !== 'bone') return;
    applyBoneEdit(primary.name, patch);
  }

  return (
    <div className="tool-cluster">
      <div className="tc-tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'active' : ''}
            disabled={t.setupOnly && mode === 'animate'}
            title={t.label}
            onClick={() => useEditor.getState().setTool(t.id)}
          >
            {t.icon()} {t.label}
          </button>
        ))}
      </div>
      {shown && (
        <div className="tc-transform">
          <div className="tc-row">
            <span className="tc-label">
              <RotateIcon size={12} /> Rotate
            </span>
            <NumBox value={shown.rotation} onCommit={(v) => commit({ rotation: v })} />
            <button
              className="tc-key"
              title="Key current value at the playhead"
              disabled={mode !== 'animate'}
              onClick={() => commit({ rotation: shown.rotation })}
            >
              <KeyIcon size={10} />
            </button>
          </div>
          <div className="tc-row">
            <span className="tc-label">
              <TranslateIcon size={12} /> Translate
            </span>
            <NumBox value={shown.x} onCommit={(v) => commit({ x: v })} />
            <NumBox value={shown.y} onCommit={(v) => commit({ y: v })} />
          </div>
          <div className="tc-row">
            <span className="tc-label">
              <ScaleIcon size={12} /> Scale
            </span>
            <NumBox value={shown.scaleX} onCommit={(v) => commit({ scaleX: v })} />
            <NumBox value={shown.scaleY} onCommit={(v) => commit({ scaleY: v })} />
          </div>
          <div className="tc-row">
            <span className="tc-label">
              <ShearIcon size={12} /> Shear
            </span>
            <NumBox value={shown.shearX} onCommit={(v) => commit({ shearX: v })} />
            <NumBox value={shown.shearY} onCommit={(v) => commit({ shearY: v })} />
          </div>
        </div>
      )}
      <div className="tc-axes">
        {(['local', 'parent', 'world'] as const).map((m) => (
          <button
            key={m}
            className={axes === m ? 'active' : ''}
            onClick={() => useEditor.getState().setAxesMode(m)}
          >
            {m[0]!.toUpperCase() + m.slice(1)}
          </button>
        ))}
        {mode === 'animate' && (
          <button
            className={autoKey ? 'active tc-autokey' : 'tc-autokey'}
            title="Auto Key"
            onClick={() => useEditor.getState().setAutoKey(!autoKey)}
          >
            <KeyIcon /> Auto Key
          </button>
        )}
      </div>
      <div className="tc-filters">
        <div className="tc-filter-head">
          <span />
          <CursorIcon size={11} />
          <EyeIcon size={11} />
          <TagIcon size={11} />
        </div>
        {(['bones', 'images', 'others'] as const).map((g) => (
          <div key={g} className="tc-filter-row">
            <span>{g[0]!.toUpperCase() + g.slice(1)}</span>
            {(['select', 'visible', 'labels'] as const).map((k) => (
              <button
                key={k}
                className={filters[g][k] ? 'dot on' : 'dot'}
                title={`${g} ${k}`}
                onClick={() => useEditor.getState().toggleViewFilter(g, k)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

At execution, check how animated locals are read elsewhere (PropertiesPanel or Viewport use `computeAnimatedLocals(doc.data, anim.current, anim.time)` from core) and use that exact call instead of the `doc.computeLocals?.` guess — the boxes must show animated values in animate mode and setup values in setup mode.

- [ ] **Step 4: Tool union + shortcuts + Viewport wiring**

- `store.ts`: `export type Tool = 'select' | 'translate' | 'rotate' | 'scale' | 'shear' | 'create';` (find the current union and extend).
- `shortcuts.ts`: keys `'5'` → `setTool('scale')`, `'6'` → `setTool('shear')` (mirror the existing 1–4 cases).
- `Viewport.tsx`:
  - Render overlays inside the viewport container root: `<ModeBanner />` and `<ToolCluster />` (absolute positioning via CSS; the container has `position: relative` — verify, add if missing).
  - Scale/shear drags: follow the rotate drag pattern exactly (drag kind `'scale' | 'shear'` storing `bones`, start pointer, start locals). During move, update the pose override: scale — `factorX = 1 + (dx / 120)`, `factorY = 1 + (-dy / 120)` applied to start scale (`override.scaleX = start.scaleX * factorX` etc., Shift = uniform, use factorX for both); shear — `override.shearX = start.shearX + dx / 2`, `override.shearY = start.shearY - dy / 2`. On pointerup mirror the rotate commit branch (lines ~628–650) but for `'scale'` keys write FACTORS: `makeKey(t, { x: round2(b.scaleX / setup.scaleX), y: round2(b.scaleY / setup.scaleY) })`; for `'shear'` offsets: `makeKey(t, { x: round2(b.shearX - setup.shearX), y: round2(b.shearY - setup.shearY) })`; setup mode → `SetBoneTransform` with absolute values.
  - Auto Key gate: at the top of the pointerup commit branches for translate/rotate/scale/shear AND deform (line ~547), when `state.mode === 'animate' && !state.autoKey` → `state.setError('Auto Key is off — enable it to key changes.'); return;` (before building commands).
- Toolbar.tsx: DELETE the `TOOLS` group and the `.modes` group (and the now-unused `TOOLS` array/import if any).
- `anim.mjs`: replace `await page.click('.modes button:has-text("Animate")');` with `await page.click('.mode-banner');` (banner toggles setup→animate). The `button:has-text("Create")` / `("Rotate")` / `("Translate")` clicks now hit the cluster buttons — still unique.

- [ ] **Step 5: styles** — append:

```css
/* ---- viewport shell overlays ---- */
.mode-banner {
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  opacity: 0.55;
}
.mode-banner:hover {
  opacity: 1;
}
.tool-cluster {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.tool-cluster > div {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
}
.tc-tools {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tc-tools button {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-start;
}
.tc-transform {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tc-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.tc-label {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  width: 84px;
  font-size: 11px;
}
.num-box {
  width: 64px;
  text-align: right;
  font-size: 11px;
}
.tc-key {
  opacity: 0.5;
}
.tc-axes {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tc-filters {
  font-size: 11px;
}
.tc-filter-head,
.tc-filter-row {
  display: grid;
  grid-template-columns: 52px 16px 16px 16px;
  align-items: center;
  gap: 2px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  padding: 0;
  border: 1px solid var(--border);
  background: transparent;
}
.dot.on {
  background: var(--text-dim);
}
button.active {
  background: var(--accent-soft);
}
```

- [ ] **Step 6: verify + commit** — `pnpm typecheck && pnpm build`; manual dev-server check (banner toggles, numeric box `+10` rotates, scale drag works, Auto Key off blocks with hint), then:

```bash
git add packages/editor/src packages/editor/e2e/anim.mjs
git commit -m "P15: mode banner + viewport tool cluster (numeric edits, scale/shear tools, auto-key gate)"
```

---

### Task 4: axes modes + filter matrix wiring + bone labels

**Files:**

- Modify: `client/packages/editor/src/components/Viewport.tsx` (hit-test + translate axes)
- Modify: `client/packages/editor/src/viewport/renderer.ts` (visibility filters + labels)

**Interfaces:**

- Consumes: `axesMode`, `viewFilters` from store.
- Produces: renderer method `setViewFilters(f: ViewFilters): void` (re-applied every render); translate drags respect `axesMode`.

- [ ] **Step 1: axes** — locate the translate MOVE handler in Viewport (the branch updating the override from pointer world delta, around lines 461–533). Introduce:

```ts
/** Rotates a world-space delta into the frame chosen by axesMode. */
function deltaForAxes(dx: number, dy: number, boneName: string): { dx: number; dy: number } {
  const s = useEditor.getState();
  if (s.axesMode === 'world') return { dx, dy };
  const r = rendererRef.current;
  const target = s.axesMode === 'local' ? boneName : (s.doc.findBone(boneName)?.parent ?? null);
  const w = target ? r?.getBoneWorld(target) : null;
  if (!w) return { dx, dy };
  const rot = -(w.rotation * Math.PI) / 180;
  return {
    dx: dx * Math.cos(rot) - dy * Math.sin(rot),
    dy: dx * Math.sin(rot) + dy * Math.cos(rot),
  };
}
```

At execution, inspect `getBoneWorld`'s return shape (Task 3 used `w.tx/w.ty` in the marquee code; check whether it exposes world rotation — if it returns a matrix, derive rotation via `Math.atan2(m.b, m.a)`). Apply `deltaForAxes` to the translate delta before it is converted into parent-local coordinates; when the existing conversion already goes world→parent-local, `parent` mode equals current behavior and only `local`/`world` need the extra rotation (document which after reading — behavior contract: World = screen axes, Parent = today's behavior, Local = along the bone's own axes).

- [ ] **Step 2: hit-test filters** — in the Viewport click/pick path, skip candidates by group: bones when `!viewFilters.bones.select`; region/mesh attachment picks when `!viewFilters.images.select`; bbox/point/clipping/path when `!viewFilters.others.select` (find the pick function; add early `continue`s).

- [ ] **Step 3: renderer filters + labels** — `renderer.ts`:

```ts
import { Text } from 'pixi.js'; // match existing pixi import style

viewFilters: ViewFilters | null = null;
setViewFilters(f: ViewFilters): void { this.viewFilters = f; }
private labelPool = new Map<string, Text>();
```

In the draw pass: skip bone gizmos when `viewFilters?.bones.visible === false`; skip region/mesh sprites when `images.visible === false`; skip bbox/point/clipping/path outlines when `others.visible === false`. Labels: when `bones.labels` is true, for each drawn bone upsert a `Text(bone.name, { fontSize: 11, fill: 0xd8d8d8 })` at the bone origin (screen-transformed), pooled in `labelPool`, removed when off. Images/others labels: attachment name at attachment origin, same pattern (keep it simple — one Text per named thing, only when its group's `labels` is on).

Viewport render effect: call `rendererRef.current?.setViewFilters(useEditor.getState().viewFilters)` before each redraw (add `viewFilters` to the store-subscription that triggers redraws).

- [ ] **Step 4: verify + commit** — typecheck/build; manual: toggle eye dots hides bones/images; labels show names; axes Local vs World visibly differ when dragging a rotated bone's child.

```bash
git add packages/editor/src/components/Viewport.tsx packages/editor/src/viewport/renderer.ts
git commit -m "P15: axes modes, selection/visibility/label filters"
```

---

### Task 5: breadcrumb + zoom control

**Files:**

- Create: `client/packages/editor/src/components/Breadcrumb.tsx`
- Create: `client/packages/editor/src/components/ZoomControl.tsx`
- Modify: `client/packages/editor/src/components/Viewport.tsx` (mount both)
- Modify: `client/packages/editor/src/viewport/renderer.ts` (`setZoomCenter` + `onZoomChange`)
- Modify: `client/packages/editor/src/styles.css`

- [ ] **Step 1: `Breadcrumb.tsx`** (full code):

```tsx
import { primarySelection, useEditor } from '../state/store.js';

/** root ▸ hip ▸ tail1 ▸ … chain of the primary selected bone; click = select. */
export function Breadcrumb() {
  const selection = useEditor((s) => s.selection);
  const revision = useEditor((s) => s.revision);
  void revision;
  const primary = primarySelection(selection);
  if (!primary || primary.kind !== 'bone') return null;
  const bones = useEditor.getState().doc.data.bones;
  const byName = new Map(bones.map((b) => [b.name, b]));
  const chain: string[] = [];
  for (let b = byName.get(primary.name); b; b = b.parent ? byName.get(b.parent) : undefined) {
    chain.unshift(b.name);
  }
  return (
    <div className="breadcrumb">
      {chain.map((name, i) => (
        <span key={name}>
          {i > 0 && <span className="crumb-sep">▸</span>}
          <button onClick={() => useEditor.getState().select({ kind: 'bone', name })}>
            {name}
          </button>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: renderer zoom API** — add to renderer:

```ts
onZoomChange: ((zoom: number) => void) | null = null;
setZoomCenter(zoom: number): void {
  const clamped = Math.min(20, Math.max(0.05, zoom));
  const cx = this.width / 2, cy = this.height / 2;   // match existing size fields
  this.zoomAt(cx, cy, clamped / this.zoom);
}
```

and call `this.onZoomChange?.(this.zoom)` at the end of `zoomAt`.

- [ ] **Step 3: `ZoomControl.tsx`** (full code; prop = renderer ref getter):

```tsx
import { useEffect, useState } from 'react';
import type { ViewportRenderer } from '../viewport/renderer.js';

export function ZoomControl({ getRenderer }: { getRenderer: () => ViewportRenderer | null }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const r = getRenderer();
    if (!r) return;
    setZoom(r.zoom);
    r.onZoomChange = setZoom;
    return () => {
      if (r.onZoomChange === setZoom) r.onZoomChange = null;
    };
  }, [getRenderer]);
  const apply = (z: number) => getRenderer()?.setZoomCenter(z);
  return (
    <div className="zoom-control">
      <button onClick={() => apply(zoom * 1.25)}>+</button>
      <input
        type="range"
        min={-3}
        max={3}
        step={0.01}
        value={Math.log2(zoom)}
        onChange={(e) => apply(2 ** Number(e.target.value))}
      />
      <button onClick={() => apply(zoom / 1.25)}>−</button>
      <button title="Reset zoom" onClick={() => apply(1)}>
        1:1
      </button>
    </div>
  );
}
```

(Use the renderer class's real exported name; slider is vertical via CSS `writing-mode`/`appearance` — see styles.)

- [ ] **Step 4: mount + styles** — Viewport renders `<Breadcrumb />` (above the cluster) and `<ZoomControl getRenderer={() => rendererRef.current} />`; styles:

```css
.breadcrumb {
  position: absolute;
  bottom: 190px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  display: flex;
  gap: 2px;
}
.breadcrumb button {
  background: none;
  border: none;
  color: var(--text);
  padding: 2px 3px;
}
.crumb-sep {
  color: var(--text-dim);
  margin: 0 2px;
}
.zoom-control {
  position: absolute;
  bottom: 12px;
  left: 10px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.zoom-control input[type='range'] {
  writing-mode: vertical-lr;
  direction: rtl;
  height: 110px;
}
```

- [ ] **Step 5: verify + commit**

```bash
pnpm typecheck && pnpm build
git add packages/editor/src packages/editor/src/styles.css
git commit -m "P15: bone breadcrumb + viewport zoom control"
```

---

### Task 6: e2e run + docs

**Files:**

- Modify (if needed after runs): `client/packages/editor/e2e/smoke.mjs`, `anim.mjs`
- Modify: `CLAUDE.md` (one status line)

- [ ] **Step 1: run all four e2e** — build editor, vite preview :4173 (kill stale 4173/8017/8100 first):

```bash
cd client && pnpm --filter @spine-editor/editor build
(cd packages/editor && nohup npx vite preview --port 4173 --strictPort &)
CHR="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
CHROMIUM_PATH="$CHR" node packages/editor/e2e/smoke.mjs /tmp-out/smoke
CHROMIUM_PATH="$CHR" node packages/editor/e2e/anim.mjs /tmp-out/anim
(cd packages/mcp-server && CHROMIUM_PATH="$CHR" node e2e/bridge.mjs)      # expect toolCount 55, flags unchanged
# chat: start server with SPINE_SERVER_CHAT_FAKE=1 SPINE_SERVER_SEGMENT_FAKE=1 + fresh data dir, then
CHROMIUM_PATH="$CHR" node packages/editor/e2e/chat.mjs                    # expect chatRigWorks true
```

Fix selector fallout in smoke/anim only (tool buttons kept their text; mode uses `.mode-banner` from Task 3). READ the smoke/anim screenshots (banner visible top-left, cluster bottom-center, breadcrumb above it, zoom bottom-left) — this is the §3.7 layout acceptance.

- [ ] **Step 2: suites + docs**

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
(cd ../server && uv run pytest -q && uv run ruff check .)
```

CLAUDE.md: in the Project status text append after the Phase-14 sentence: `Phase 15 (Spine-parity U1) done: Spine-style shell — theme tokens, titlebar file menu, in-viewport SETUP/ANIMATE banner, bottom tool cluster (numeric transforms, scale/shear tools, Local/Parent/World axes, selection/visibility/label filters, Auto Key toggle), breadcrumb, zoom slider (PLAN.md §8).`

- [ ] **Step 3: commit**

```bash
git add client/packages/editor/e2e CLAUDE.md
git commit -m "P15: e2e selector updates + docs (UI shell done)"
```

---

### Final acceptance (spec §3.7)

- [ ] 4 e2e green from the new shell (smoke/anim selectors updated; bridge/chat untouched)
- [ ] Screenshot shows banner + cluster + breadcrumb + zoom in Spine positions
- [ ] Numeric round-trip: type `45` into Rotate → bone at 45°, one undo step; `+10`/`*2` prefixes work
- [ ] Auto Key off blocks animate edits with the hint; on restores today's behavior
- [ ] Suites + pytest green
