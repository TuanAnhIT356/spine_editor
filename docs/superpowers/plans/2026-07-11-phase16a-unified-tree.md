# Phase 16a — Unified TreePanel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Spine-style tree panel on the right (bones nesting slots nesting attachments + Constraints/Skins/Events/Animations/Images sections, per-item visibility dots, colored type icons, search) with a selection-driven properties dock at its bottom — replacing HierarchyPanel and PropertiesPanel.

**Architecture:** Store gains extended selection kinds + editor-only hidden lists; the renderer skips hidden bones/slots. The new `TreePanel` hosts `TreeRows` (tree + sections, ported from HierarchyPanel with visibility dots/icons/attachment rows added) above a dock that renders the MOVED BoneProperties/SlotProperties forms (`BoneDock`/`SlotDock`) or a read-only `InfoDock` for other kinds. Old panels are deleted in the same task the replacement lands, together with any e2e selector fixes, so every commit stays green.

**Tech Stack:** React + zustand, PixiJS renderer flags, hand-drawn SVG icons, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-11-phase16a-unified-tree-design.md`

## Global Constraints

- Branch `claude/phase16a-unified-tree`. All pnpm from `client/` (shim PATH `/private/tmp/claude-501/-Users-tuananh-Projects-you-spine-editor/6b990f26-97bc-4e20-b105-3db5aab338c5/scratchpad/bin`, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`).
- Hidden state is **editor-only and session-only** — never serialized; pose math unaffected (only drawing/hit-test skip).
- Keep e2e-critical classes: `.tree`, `.row.bone`, `.row.slot`, `.assets`; keep the search placeholder `Search bones/slots…`; keep `button:has-text("Attach")` inside `.assets`.
- Migration components move **verbatim** (same logic, same commands); only file location + wrapper names change. Own SVG icons only.
- No core changes in 16a. Every commit ends with the repo trailer.
- Editor has no unit tests: per-task cycle = `pnpm typecheck && pnpm --filter @spine-editor/editor build`; e2e in Task 4.

---

### Task 1: Store — selection kinds, hidden lists, panel keys

**Files:**

- Modify: `client/packages/editor/src/state/store.ts`
- Modify: `client/packages/editor/src/components/Toolbar.tsx` (Views items)
- Modify: `client/packages/editor/src/App.tsx` (gate keys)

**Interfaces (Produces):**

```ts
export type SelectionItem = {
  kind: 'bone' | 'slot' | 'ik' | 'transform' | 'path' | 'physics' | 'event' | 'animation';
  name: string;
};
// EditorState additions:
hiddenBones: string[];
hiddenSlots: string[];
toggleBoneHidden(name: string): void;
toggleSlotHidden(name: string): void;
panelVisibility: { tree: boolean; timeline: boolean };
togglePanel(panel: 'tree' | 'timeline'): void;
```

- [ ] **Step 1: store.ts** — widen `SelectionItem.kind` to the union above (line ~41). Replace `panelVisibility` type + default `{ hierarchy, properties, timeline }` with `{ tree: true, timeline: true }` and `togglePanel(panel: 'tree' | 'timeline')`. Add after `savedRevision: 0,`:

```ts
  hiddenBones: [],
  hiddenSlots: [],
```

interface entries + implementations after `markSaved`:

```ts
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
```

- [ ] **Step 2: Toolbar Views dropdown** — replace the `(['hierarchy', 'properties', 'timeline'] as const)` map with `(['tree', 'timeline'] as const)`; label: `p === 'tree' ? 'Tree' : 'Timeline'`; keep the timeline-disabled-in-setup logic.

- [ ] **Step 3: App.tsx** — until Task 3 swaps panels, gate BOTH old panels on the new key: `{panels.tree && (<><HierarchyPanel />…</>)}` and `{panels.tree && (<>…<PropertiesPanel /></>)}` (timeline block: `panels.timeline` unchanged).

- [ ] **Step 4: verify + commit**

```bash
pnpm typecheck && pnpm --filter @spine-editor/editor build && pnpm lint && pnpm format:check
git add client/packages/editor/src && git commit -m "P16a: selection kinds, hidden lists, tree/timeline panel keys"
```

---

### Task 2: Renderer + Viewport honor hidden bones/slots

**Files:**

- Modify: `client/packages/editor/src/viewport/renderer.ts`
- Modify: `client/packages/editor/src/components/Viewport.tsx`

**Interfaces:** `RenderInput` gains `hiddenBones?: Set<string>; hiddenSlots?: Set<string>` — renderer stores them per-render; `hitTest` skips hidden bones.

- [ ] **Step 1: renderer.ts** — add to `RenderInput` interface the two optional sets. In `render()`, first lines: `this.hiddenBones = input.hiddenBones ?? null; this.hiddenSlots = input.hiddenSlots ?? null;` (new private fields, both `Set<string> | null = null`). Apply:
  - slot draw loop (the per-slot attachment loop feeding `addDrawable`): `if (this.hiddenSlots?.has(slot.name)) { endClipAfter(slot.name); continue; }` at the top of the loop body (keep the clip bookkeeping call so clip ranges still terminate).
  - `drawBones(...)`: skip a bone when `this.hiddenBones?.has(bone.name)`.
  - `updateLabels(...)`: same two skips.
  - `hitTest(...)`: inside the `for (const [name, m] of this.lastPose)` loop add `if (this.hiddenBones?.has(name)) continue;`.

- [ ] **Step 2: Viewport.tsx** — in `buildRenderInput()` add:

```ts
      hiddenBones: state.hiddenBones.length ? new Set(state.hiddenBones) : undefined,
      hiddenSlots: state.hiddenSlots.length ? new Set(state.hiddenSlots) : undefined,
```

Subscribe for redraw: `const hiddenBones = useEditor((s) => s.hiddenBones); const hiddenSlots = useEditor((s) => s.hiddenSlots);` and append both to the `useEffect(redraw, […])` dependency list.

- [ ] **Step 3: verify + commit**

```bash
pnpm typecheck && pnpm --filter @spine-editor/editor build
git add client/packages/editor/src && git commit -m "P16a: renderer + hit-test skip hidden bones/slots"
```

---

### Task 3: TreePanel (tree + sections + dock), migrate forms, delete old panels

**Files:**

- Modify: `client/packages/editor/src/components/icons.tsx` (add 15 icons)
- Create: `client/packages/editor/src/components/TreePanel.tsx`
- Create: `client/packages/editor/src/components/tree/TreeRows.tsx`
- Create: `client/packages/editor/src/components/tree/dock/fields.tsx` (moved `NumField`)
- Create: `client/packages/editor/src/components/tree/dock/BoneDock.tsx` (moved `BoneProperties`)
- Create: `client/packages/editor/src/components/tree/dock/SlotDock.tsx` (moved `SlotProperties` + `AttachmentsSection` + `WeightsSection` + `influenceBoneIndices`)
- Create: `client/packages/editor/src/components/tree/dock/InfoDock.tsx`
- Modify: `client/packages/editor/src/App.tsx` (swap panels)
- Delete: `client/packages/editor/src/components/HierarchyPanel.tsx`, `client/packages/editor/src/components/PropertiesPanel.tsx`
- Modify: `client/packages/editor/src/styles.css`

**Interfaces:**

- Consumes: Task 1 selection kinds/hidden toggles; existing commands (`ReparentBone`, `ReorderSlot`, `UpsertDrawOrderKeyframe`, `computeAnimatedDrawOrder`, `computeDrawOrderOffsets`, `CreateSkin`, `RemoveSkin`); Task 2 hidden rendering.
- Produces: `<TreePanel />` (self-contained); `InfoDock({ item }: { item: SelectionItem })`.

- [ ] **Step 1: icons.tsx** — append (same `svg()` helper):

```tsx
export const BoneIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M4 12 12 4M3 13a1.6 1.6 0 1 0 2-2m6-6a1.6 1.6 0 1 0 2-2" />);
export const SlotIcon = ({ size }: { size?: number }) =>
  svg(size, <rect x="3" y="3" width="10" height="10" rx="1.5" />);
export const ImageIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="m3 11 3-3 3 3 2-2 2 2" />
      <circle cx="6" cy="6" r="1" />
    </>,
  );
export const MeshIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M3 3h10v10H3z" />
      <path d="M3 8h10M8 3v10M3 3l10 10" />
    </>,
  );
export const BBoxIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M3 3h3M10 3h3M3 3v3M3 10v3M3 13h3M10 13h3M13 3v3M13 10v3" />);
export const PointIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14" />
    </>,
  );
export const ClipIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="4.5" cy="11.5" r="1.6" />
      <circle cx="4.5" cy="4.5" r="1.6" />
      <path d="m6 10 8-6.5M6 6l8 6.5" />
    </>,
  );
export const PathIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M2 12c4 0 3-8 7-8 2.5 0 3 2 5 2" />);
export const IkIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M3 13 8 8l4-1" />
      <circle cx="12.5" cy="6.5" r="1.6" />
      <circle cx="3" cy="13" r="1" />
    </>,
  );
export const TransformIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <rect x="2.5" y="2.5" width="7" height="7" />
      <rect x="6.5" y="6.5" width="7" height="7" />
    </>,
  );
export const PhysicsIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <path d="M3 3c0 3 2 3 2 6s-2 3-2 4m5-13c0 3 2 3 2 6s-2 3-2 4m5-13c0 3 2 3 2 6s-2 3-2 4" />,
  );
export const EventIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M4 2h8l-2 4 2 0-6 8 1.5-6H4z" />);
export const AnimationIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="m6.5 5.5 4 2.5-4 2.5z" />
    </>,
  );
export const SkeletonIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="8" cy="3" r="1.6" />
      <path d="M8 5v4M8 9l-3 4M8 9l3 4M4 6.5 8 8l4-1.5" />
    </>,
  );
export const SkinIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M5 3 3 5v3h2v5h6V8h2V5l-2-2-2 1.5h-2z" />);
```

- [ ] **Step 2: `tree/dock/fields.tsx`** — MOVE `NumField` (PropertiesPanel.tsx lines ~26–56) verbatim, `export`ed. Update its former imports.

- [ ] **Step 3: `tree/dock/BoneDock.tsx`** — MOVE `BoneProperties` (PropertiesPanel ~57–125) verbatim as `export function BoneDock({ name }: { name: string })` (only the function name changes; body identical; import `NumField` from `./fields.js`).

- [ ] **Step 4: `tree/dock/SlotDock.tsx`** — MOVE `influenceBoneIndices`, `WeightsSection`, `AttachmentsSection`, and the slot form section of PropertiesPanel (the component that renders slot name/bone/blend/attachment + those sections — find the `SlotProperties`-equivalent inside PropertiesPanel's main export; extract it as `export function SlotDock({ name }: { name: string })` keeping the exact JSX + handlers). All imports carried over.

- [ ] **Step 5: `tree/dock/InfoDock.tsx`** (new, full code):

```tsx
import { useEditor, type SelectionItem } from '../../../state/store.js';
import {
  AnimationIcon,
  EventIcon,
  IkIcon,
  PathIcon,
  PhysicsIcon,
  TransformIcon,
} from '../../icons.js';

const ICONS: Record<string, (p: { size?: number }) => React.JSX.Element> = {
  ik: IkIcon,
  transform: TransformIcon,
  path: PathIcon,
  physics: PhysicsIcon,
  event: EventIcon,
  animation: AnimationIcon,
};

/** Read-only summary for kinds whose full editors arrive in Phase 16b. */
export function InfoDock({ item }: { item: SelectionItem }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const data = useEditor.getState().doc.data;
  const Icon = ICONS[item.kind] ?? IkIcon;
  let summary = '';
  if (item.kind === 'ik') {
    const c = data.ik.find((c) => c.name === item.name);
    if (c) summary = `target ${c.target} · bones ${c.bones.join(', ')} · mix ${c.mix}`;
  } else if (item.kind === 'transform') {
    const c = data.transform.find((c) => c.name === item.name);
    if (c) summary = `target ${c.target} · bones ${c.bones.join(', ')}`;
  } else if (item.kind === 'path') {
    const c = data.path.find((c) => c.name === item.name);
    if (c) summary = `target ${c.target} · bones ${c.bones.join(', ')}`;
  } else if (item.kind === 'physics') {
    const c = data.physics.find((c) => c.name === item.name);
    if (c) summary = `bone ${c.bone}`;
  } else if (item.kind === 'event') {
    const e = data.events[item.name];
    if (e) summary = [e.string, e.audio].filter(Boolean).join(' · ') || 'event';
  } else if (item.kind === 'animation') {
    const a = data.animations[item.name];
    if (a) summary = `${Object.keys(a.bones ?? {}).length} bone tracks`;
  }
  return (
    <div className="info-dock">
      <div className="info-dock-head">
        <Icon size={16} /> <b>{item.name}</b>
        <span className="info-kind">{item.kind}</span>
      </div>
      <div className="info-summary">{summary}</div>
      <div className="empty">Full editing for this type arrives in Phase 16b.</div>
    </div>
  );
}
```

(Check `data.events` value shape when writing the summary — adjust field names to the real `SpineEventDef`.)

- [ ] **Step 6: `tree/TreeRows.tsx`** — port from HierarchyPanel with additions. Full component (adapt only where the source differs):

```tsx
import { ReparentBone } from '@spine-editor/core';
import { isSelected, useEditor, type SelectionItem } from '../../state/store.js';
import {
  BBoxIcon,
  BoneIcon,
  ClipIcon,
  ImageIcon,
  IkIcon,
  MeshIcon,
  PathIcon,
  PhysicsIcon,
  PointIcon,
  SlotIcon,
  TransformIcon,
} from '../icons.js';
import { clickSelect, moveSlotInDrawOrder } from './tree-actions.js';

const ATT_ICONS: Record<string, (p: { size?: number }) => React.JSX.Element> = {
  region: ImageIcon,
  mesh: MeshIcon,
  boundingbox: BBoxIcon,
  point: PointIcon,
  clipping: ClipIcon,
  path: PathIcon,
};

function VisDot({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      className={`vis-dot ${hidden ? 'off' : ''}`}
      title={hidden ? 'Show in viewport' : 'Hide in viewport'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    />
  );
}

export function TreeRows({
  query,
  show,
}: {
  query: string;
  show: { slots: boolean; attachments: boolean; constraints: boolean };
}) {
  // subscribe: revision, doc, selection, hiddenBones, hiddenSlots (useEditor selectors)
  // bones/slots/childrenOf/roots identical to HierarchyPanel
  // BoneRow: [VisDot(bone)] [BoneIcon tinted by bone.color] name  — drag/drop verbatim
  //   slots nested (paddingLeft +14): [VisDot(slot)] [SlotIcon] name [↑↓ when selected]
  //     attachments of slot from DEFAULT skin: rows (paddingLeft +14 more) with
  //     ATT_ICONS[att.type ?? 'region'] + attachment name; onClick selects the SLOT.
  //   children bones recurse.
  // query branch: matchedBones/matchedSlots flat rows (verbatim from HierarchyPanel).
  // show.slots=false hides slot+attachment rows; show.attachments=false hides
  // attachment rows only.
}
```

Write it as REAL code by transplanting HierarchyPanel's `BoneRow`/search JSX (the source is in the repo — `git show HEAD:client/.../HierarchyPanel.tsx` if already deleted) and inserting: `VisDot` before each icon (bones: `useEditor.getState().toggleBoneHidden(name)`, hidden from `hiddenBones.includes(name)`); tinted `<BoneIcon />` via `<span className="type-icon" style={{ color: bone.color ? '#' + bone.color.slice(0, 6) : 'var(--warn)' }}>`; attachment rows built from `doc.data.skins.find((s) => s.name === 'default')?.attachments?.[slot.name] ?? {}` mapping `[attName, att]` → icon by `(att as { type?: string }).type ?? 'region'`. Move `clickSelect` + `moveSlotInDrawOrder` into `tree/tree-actions.ts` (verbatim; exported).

- [ ] **Step 7: `TreePanel.tsx`** (full code):

```tsx
import { useState } from 'react';
import { primarySelection, useEditor } from '../state/store.js';
import { useServer } from '../server/api.js';
import { Resizer } from './Resizer.js';
import { TreeRows } from './tree/TreeRows.js';
import { BoneDock } from './tree/dock/BoneDock.js';
import { SlotDock } from './tree/dock/SlotDock.js';
import { InfoDock } from './tree/dock/InfoDock.js';
import {
  AnimationIcon,
  EventIcon,
  IkIcon,
  PathIcon,
  PhysicsIcon,
  SkeletonIcon,
  SkinIcon,
  TransformIcon,
} from './icons.js';
// plus the moved SkinsSection + Images section JSX (from HierarchyPanel, verbatim)

export function TreePanel() {
  const layout = useEditor((s) => s.layout);
  const selection = useEditor((s) => s.selection);
  const revision = useEditor((s) => s.revision);
  void revision;
  const [filter, setFilter] = useState('');
  const [show, setShow] = useState({ slots: true, attachments: true, constraints: true });
  const [dockHeight, setDockHeight] = useState(260);
  const primary = primarySelection(selection);
  const doc = useEditor.getState().doc;
  const projectName = useServer((s) => s.projectName) || 'untitled';

  return (
    <div className="panel tree-panel" style={{ width: layout.propertiesWidth }}>
      <input
        className="tree-filter"
        placeholder="Search bones/slots…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="tree-chips">
        {(['slots', 'attachments', 'constraints'] as const).map((k) => (
          <button
            key={k}
            className={show[k] ? 'chip on' : 'chip'}
            onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
          >
            {k[0]!.toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <div className="tree">
        <div className="row skeleton-row">
          <SkeletonIcon /> {projectName}
        </div>
        <TreeRows query={filter.trim().toLowerCase()} show={show} />
        {show.constraints && <ConstraintsSection />}
        <SkinsSection />
        <EventsSection />
        <AnimationsSection />
        <ImagesSection />
      </div>
      <Resizer
        axis="y"
        onResize={(d) => setDockHeight((h) => Math.max(120, Math.min(600, h - d)))}
      />
      <div className="tree-dock" style={{ height: dockHeight }}>
        {!primary && <div className="empty">Select a bone or slot to edit its properties.</div>}
        {primary?.kind === 'bone' && <BoneDock name={primary.name} />}
        {primary?.kind === 'slot' && <SlotDock name={primary.name} />}
        {primary && primary.kind !== 'bone' && primary.kind !== 'slot' && (
          <InfoDock item={primary} />
        )}
      </div>
    </div>
  );
}
```

Section components (same file, below): `ConstraintsSection` lists the four arrays with icons `IkIcon/TransformIcon/PathIcon/PhysicsIcon` and `clickSelect(e, { kind, name })`; `SkinsSection` + `ImagesSection` are the HierarchyPanel blocks moved VERBATIM (Images keeps `.assets`); `EventsSection` maps `Object.keys(doc.data.events)` → rows with `EventIcon`, select `{kind:'event'}`; `AnimationsSection` maps `Object.keys(doc.data.animations)` → rows with `AnimationIcon`, select `{kind:'animation'}`, `onDoubleClick={() => { useEditor.getState().setAnimation(name); useEditor.getState().setMode('animate'); }}`.

- [ ] **Step 8: App swap + delete** — App renders `{panels.tree && (<><Resizer axis="x" onResize={(d) => useEditor.getState().resizeProperties(d)} /><TreePanel /></>)}` after `<Viewport />`; remove HierarchyPanel/PropertiesPanel imports + JSX; `git rm` both old files. Sweep leftover imports (`grep -rn "HierarchyPanel\|PropertiesPanel" client/packages/editor/src`).

- [ ] **Step 9: styles.css** — append:

```css
/* ---- unified tree panel ---- */
.tree-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tree-panel .tree {
  flex: 1;
  overflow-y: auto;
}
.tree-chips {
  display: flex;
  gap: 4px;
  padding: 4px 8px;
}
.chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  opacity: 0.5;
}
.chip.on {
  opacity: 1;
  background: var(--accent-soft);
}
.vis-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  padding: 0;
  margin-right: 4px;
  border: 1px solid var(--text-dim);
  background: var(--text-dim);
  flex: none;
}
.vis-dot.off {
  background: transparent;
}
.type-icon {
  display: inline-flex;
  margin-right: 4px;
}
.row.attachment {
  opacity: 0.85;
}
.skeleton-row {
  font-weight: 600;
}
.tree-dock {
  overflow-y: auto;
  border-top: 1px solid var(--border);
  padding: 6px 8px;
}
.info-dock-head {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.info-kind {
  color: var(--text-dim);
  font-size: 11px;
  margin-left: auto;
}
.info-summary {
  font-size: 12px;
  margin-bottom: 8px;
}
```

Row base styles (`.row`, `.row.selected`, `.panel-title`, `.assets`) already exist — reuse.

- [ ] **Step 10: quick smoke + commit**

```bash
pnpm typecheck && pnpm --filter @spine-editor/editor build && pnpm lint && pnpm format:check
# vite preview + smoke.mjs once here to catch selector fallout early (full battery in Task 4)
git add -A client/packages/editor/src && git commit -m "P16a: unified TreePanel with sections, visibility dots, bone/slot dock (replaces Hierarchy+Properties)"
```

---

### Task 4: e2e battery + screenshot + docs

**Files:** e2e fixes if needed; `CLAUDE.md`; `PLAN.md`

- [ ] **Step 1:** run smoke/anim/bridge/chat exactly as the Phase 15 Task 6 recipe (vite preview :4173; kill stale 4173/8017/8100; chat needs server with `SPINE_SERVER_CHAT_FAKE=1 SPINE_SERVER_SEGMENT_FAKE=1` + fresh data dir). Fix only selector drift in smoke/anim.
- [ ] **Step 2:** READ a smoke screenshot: tree on the right with nested bones→slots→attachments, dots, sections, dock at bottom (compare Spine screenshot #1 layout).
- [ ] **Step 3:** suites (`pnpm lint/format:check/typecheck/test`; server pytest+ruff untouched-green). Docs: CLAUDE.md — replace the Phase 15 status tail `Next: PLAN.md §8 …` with `Phase 16a done: unified right-side TreePanel (bones▸slots▸attachments nesting, Constraints/Skins/Events/Animations/Images sections, per-item visibility dots, colored type icons, search) with bone/slot properties dock at its bottom — HierarchyPanel/PropertiesPanel removed. Next: Phase 16b (constraint/event/animation editors, context menu, inline rename), then §8 phases 17–22.` PLAN.md §8 Phase 16 row: append `✅ 16a (07/2026), 16b còn lại`.
- [ ] **Step 4: commit**

```bash
git add client/packages/editor/e2e CLAUDE.md PLAN.md
git commit -m "P16a: e2e green on the unified tree + docs"
```

---

### Final acceptance (spec §7)

- [ ] Suites + build green; pytest untouched (§7.1)
- [ ] 4 e2e green (§7.2)
- [ ] Screenshot: nesting + sections + dots + dock match Spine layout (§7.3)
- [ ] Dots hide bone gizmo / slot sprite without touching export (§7.4 — verify via export JSON in console or smoke assertions)
- [ ] Animation double-click opens animate mode (§7.5 — manual/dev-server check)
