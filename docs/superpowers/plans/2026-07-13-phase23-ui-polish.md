# Phase 23 — UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish 6 areas of the editor UI to match Spine's reference look: tree expand/collapse, bone rendering (color/shape/selection), slot/attachment selection + hover preview, viewport ruler + fit-to-content, and — the largest piece — an interactive Rotate/Translate/Scale/Shear gizmo with axis-locked handles for both bones and region/point attachments.

**Architecture:** Small, independent UI changes (tree, bone/slot rendering, toolbar) land first as isolated tasks. The gizmo is built bottom-up: a pure, framework-free math module (`viewport/gizmo.ts`) with real unit tests, then a new core command (`SetAttachmentTransform`) with unit tests, then two integration tasks that wire the tested pure logic into `renderer.ts` (drawing) and `Viewport.tsx` (pointer hit-test + drag + commit) — reusing the *existing* `translate`/`rotate`/`scale`/`shear` drag-state kinds and their existing commit path (`SetBoneTransform` / `UpsertBoneKeyframe`) for bones, and a new `attachment` drag-state kind for attachments.

**Tech Stack:** React 18 + Zustand store (`state/store.ts`), PixiJS scene renderer (`viewport/renderer.ts`), Vitest for unit tests, existing Playwright e2e scripts (`e2e/smoke.mjs`, `e2e/anim.mjs`, `e2e/bridge.mjs`, `e2e/chat.mjs`) for full-stack verification.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-phase23-ui-polish-design.md`. 1 PR, no new MCP tools (`toolCount` stays **65**).
- Accent blue for all new selection indicators (bone-selected, slot bounding box): **`0x3875b7`** (hex of the existing `--accent` CSS variable — chosen for palette consistency, not because any existing selection UI already uses it: the tree's `.selected` row highlight is gold `#ffcc33` today and is **out of scope**, not touched by this phase).
- **Test strategy** (matches existing convention — `client/packages/editor` has **zero** unit tests today; no jsdom/React Testing Library installed): pure, framework-free logic (core commands, `viewport/gizmo.ts`, `viewport/bounds.ts`'s `computeSkeletonBounds`) gets real Vitest unit tests. Everything touching React components, the Zustand store's `localStorage` calls, PixiJS `Graphics`, or pointer events is verified by `pnpm typecheck` + `pnpm build` + the e2e battery + a manual walkthrough (Task 11) — do **not** invent fake component tests for these.
- Attachment transform (`SetAttachmentTransform`) only applies to `region` (x/y/rotation/scaleX/scaleY) and `point` (x/y/rotation, no scale) attachments — every other type (`mesh`/`linkedmesh`/`boundingbox`/`clipping`/`path`) has no such fields in the data model; its shape comes from `vertices`, edited via the existing vertex tools (Phase 8/19), not this gizmo.
- Attachment gizmo only shows in **Setup mode** (region/point x/y/rotation/scale is a setup-only property in the Spine format — there is no animatable timeline for it, unlike bone transforms which already support Animate-mode auto-key).
- Gizmo hit-testing takes priority over the *existing* bone-body / attachment-body hit-test, but never replaces it: when no handle is hit, every existing drag behavior (free bone translate/rotate/scale/shear, Shift-constrain) continues to work byte-for-byte as today.
- All new Pixi drawing (bone shape, selection outlines, rulers, gizmo) lives in world-space coordinates with lengths divided by `this.zoom`, matching the existing convention in `drawBones`/`drawOverlays`/`hitTest`.

---

## Task 1: Tree panel — expand/collapse

**Files:**

- Modify: `client/packages/editor/src/state/store.ts`
- Modify: `client/packages/editor/src/components/tree/TreeRows.tsx`
- Modify: `client/packages/editor/src/components/icons.tsx`

**Interfaces:**

- Produces: `useEditor.getState().collapsedNodes: Set<string>`, `useEditor.getState().toggleCollapsed(id: string): void`, `ChevronIcon({size, collapsed}: {size?: number; collapsed: boolean})` in `icons.tsx`.

- [ ] **Step 1: Add `collapsedNodes` state + `toggleCollapsed` action to the store**

In `client/packages/editor/src/state/store.ts`, add near the top (after the existing `loadLayout`/`saveLayout` functions, i.e. right after line 178's `}` closing `saveLayout`):

```ts
const TREE_COLLAPSED_KEY = 'spine-editor:tree-collapsed';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(TREE_COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsed(collapsed: Set<string>): void {
  try {
    localStorage.setItem(TREE_COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Storage may be unavailable (private browsing); collapse state just won't persist.
  }
}
```

In the `EditorState` interface, add a field and action (right after the `hiddenSlots: string[];` field, i.e. after line 215):

```ts
  hiddenSlots: string[];
  /** Tree node ids currently collapsed ("bone:name" / "slot:name" / "att:slot/name"). */
  collapsedNodes: Set<string>;
```

and after the `toggleSlotHidden(name: string): void;` line in the actions list (line 250):

```ts
  toggleSlotHidden(name: string): void;
  toggleCollapsed(id: string): void;
```

In the initial state object (right after `hiddenBones` init — find where `hiddenBones: []` or similar sits in the `create<EditorState>()((set, get) => ({ ... }))` block; it is grouped with other editor-only fields around line 300-310), add:

```ts
  collapsedNodes: loadCollapsed(),
```

In the actions block, right after the existing `toggleSlotHidden` action (lines 445-450):

```ts
  toggleSlotHidden: (name) =>
    set((s) => ({
      hiddenSlots: s.hiddenSlots.includes(name)
        ? s.hiddenSlots.filter((n) => n !== name)
        : [...s.hiddenSlots, name],
    })),
  toggleCollapsed: (id) =>
    set((s) => {
      const next = new Set(s.collapsedNodes);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return { collapsedNodes: next };
    }),
```

- [ ] **Step 2: Add `ChevronIcon` to the icon set**

In `client/packages/editor/src/components/icons.tsx`, add at the end of the file (after `SkinIcon`):

```ts
export const ChevronIcon = ({ size, collapsed }: { size?: number; collapsed?: boolean }) =>
  svg(
    size,
    <path
      d={collapsed ? 'M6 3l5 5-5 5' : 'M3 6l5 5 5-5'}
      style={{ transition: 'none' }}
    />,
  );
```

- [ ] **Step 3: Render chevrons in `BoneRow` and gate the subtree on collapse state**

In `client/packages/editor/src/components/tree/TreeRows.tsx`, add the import:

```ts
import { BBoxIcon, BoneIcon, ChevronIcon, ClipIcon, CurveIcon, ImageIcon, MeshIcon, PointIcon, SlotIcon } from '../icons.js';
```

(replacing the existing `icons.js` import block at lines 5-14 — same names plus `ChevronIcon`, alphabetized.)

Read `collapsedNodes` from the store inside `TreeRows` (after the existing `const hiddenSlots = useEditor((s) => s.hiddenSlots);` at line 54):

```ts
  const hiddenSlots = useEditor((s) => s.hiddenSlots);
  const collapsedNodes = useEditor((s) => s.collapsedNodes);
```

Replace the `BoneRow` function (lines 134-246) with a version that renders a chevron when the bone has children (child bones or slots) and gates the subtree:

```ts
  function BoneRow({ name, depth }: { name: string; depth: number }) {
    const selected = isSelected(selection, 'bone', name);
    const boneSlots = slots
      .map((s, index) => ({ slot: s, index }))
      .filter(({ slot }) => slot.bone === name);
    const childBones = childrenOf(name);
    const hasChildren = show.slots ? boneSlots.length > 0 || childBones.length > 0 : childBones.length > 0;
    const nodeId = `bone:${name}`;
    const collapsed = collapsedNodes.has(nodeId);
    return (
      <>
        <div
          className={`row bone ${selected ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={name !== 'root' && renaming !== name}
          tabIndex={0}
          onClick={(e) => clickSelect(e, { kind: 'bone', name })}
          onDoubleClick={() => name !== 'root' && setRenaming(name)}
          onKeyDown={(e) => {
            if (e.key === 'F2' && name !== 'root') setRenaming(name);
          }}
          onContextMenu={(e) => openMenu(e, boneMenuItems(name))}
          onDragStart={(e) => e.dataTransfer.setData('text/bone', name)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const dragged = e.dataTransfer.getData('text/bone');
            if (dragged && dragged !== name) {
              useEditor.getState().execute(new ReparentBone(dragged, name));
            }
          }}
        >
          <VisDot
            hidden={hiddenBones.includes(name)}
            onToggle={() => useEditor.getState().toggleBoneHidden(name)}
          />
          {hasChildren ? (
            <button
              className="chevron"
              onClick={(e) => {
                e.stopPropagation();
                useEditor.getState().toggleCollapsed(nodeId);
              }}
            >
              <ChevronIcon size={10} collapsed={collapsed} />
            </button>
          ) : (
            <span className="chevron-spacer" />
          )}
          <span className="type-icon" style={{ color: boneTint(name) }}>
            <BoneIcon size={12} />
          </span>
          {renaming === name ? (
            <input
              className="rename-input"
              autoFocus
              defaultValue={name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => commitBoneRename(name, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            name
          )}
        </div>
        {!collapsed && show.slots &&
          boneSlots.map(({ slot, index }) => {
            const slotSelected = isSelected(selection, 'slot', slot.name);
            return (
              <div key={slot.name}>
                <div
                  className={`row slot ${slotSelected ? 'selected' : ''}`}
                  style={{ paddingLeft: 22 + depth * 14 }}
                  onClick={(e) => clickSelect(e, { kind: 'slot', name: slot.name })}
                  onContextMenu={(e) =>
                    openMenu(e, [
                      {
                        label: 'Delete Slot',
                        danger: true,
                        onClick: () => useEditor.getState().removeSlotCascade(slot.name),
                      },
                    ])
                  }
                >
                  <VisDot
                    hidden={hiddenSlots.includes(slot.name)}
                    onToggle={() => useEditor.getState().toggleSlotHidden(slot.name)}
                  />
                  <span className="type-icon">
                    <SlotIcon size={12} />
                  </span>
                  {slot.name}
                  {slotSelected && (
                    <span className="row-actions">
                      <button
                        title="Draw behind (earlier in draw order; keys draw order in animate mode)"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSlotInDrawOrder(slot.name, -1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        title="Draw in front (later in draw order; keys draw order in animate mode)"
                        disabled={index === slots.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSlotInDrawOrder(slot.name, 1);
                        }}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                </div>
                <AttachmentRows slotName={slot.name} depth={depth + 2.4} />
              </div>
            );
          })}
        {!collapsed &&
          childBones.map((child) => <BoneRow key={child.name} name={child.name} depth={depth + 1} />)}
      </>
    );
  }
```

Update `AttachmentRows` (lines 68-93) to render a chevron-spacer for visual alignment (attachments are leaves — no collapse needed, just keep the row layout consistent):

```ts
  function AttachmentRows({ slotName, depth }: { slotName: string; depth: number }) {
    if (!show.attachments) return null;
    const bySlot = defaultAtts[slotName] ?? {};
    return (
      <>
        {Object.entries(bySlot).map(([attName, att]) => {
          const type = (att as { type?: string }).type ?? 'region';
          const Icon = ATT_ICONS[type] ?? ImageIcon;
          return (
            <div
              key={attName}
              className="row attachment"
              style={{ paddingLeft: 8 + depth * 14 }}
              title={type}
              onClick={(e) => clickSelect(e, { kind: 'slot', name: slotName })}
            >
              <span className="chevron-spacer" />
              <span className="type-icon">
                <Icon size={12} />
              </span>
              {attName}
            </div>
          );
        })}
      </>
    );
  }
```

- [ ] **Step 4: Add CSS for the chevron button**

In `client/packages/editor/src/styles.css`, add after the `.tree .row .icon` block (after line 225):

```css
.tree .row .chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  color: var(--text-dim);
  flex-shrink: 0;
}

.tree .row .chevron-spacer {
  display: inline-block;
  width: 14px;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Verify**

Run `pnpm typecheck` (from `client/`) — expect no errors. Start the dev server (`pnpm --filter @spine-editor/editor dev`) and manually confirm: a bone with children shows a chevron; clicking it hides/shows the subtree without changing selection; a leaf bone/slot shows no chevron (spacer only); reloading the page after collapsing a node keeps it collapsed (localStorage `spine-editor:tree-collapsed`).

- [ ] **Step 6: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/state/store.ts packages/editor/src/components/tree/TreeRows.tsx packages/editor/src/components/icons.tsx packages/editor/src/styles.css
cd .. && git add client/packages/editor/src/state/store.ts client/packages/editor/src/components/tree/TreeRows.tsx client/packages/editor/src/components/icons.tsx client/packages/editor/src/styles.css
git commit -m "$(cat <<'EOF'
P23: tree panel expand/collapse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Bone rendering — color, shape, selection

**Files:**

- Modify: `client/packages/editor/src/viewport/renderer.ts`

**Interfaces:**

- Consumes: `BoneData.color?: string` (8-hex or 6-hex, already in the model — see `boneTint()` in `TreeRows.tsx` for the existing parse pattern).
- Produces: no new exports; `drawBones()` behavior changes only.

- [ ] **Step 1: Replace the hardcoded bone colors in `drawBones`**

In `client/packages/editor/src/viewport/renderer.ts`, replace the `drawBones` method (lines 743-778):

```ts
  private drawBones(bones: BoneData[], pose: Map<string, Mat2D>, selection: Selection): void {
    const g = this.boneLayer;
    g.clear();
    for (const bone of bones) {
      if (this.hiddenBones?.has(bone.name)) continue;
      const m = pose.get(bone.name);
      if (!m) continue;
      const selected = selection.some((s) => s.kind === 'bone' && s.name === bone.name);
      const defaultColor = bone.color ? parseInt(bone.color.slice(0, 6), 16) || 0x7fb2e5 : 0x7fb2e5;
      const color = selected ? 0x3875b7 : (this.weightTint?.get(bone.name) ?? defaultColor);
      const ox = m.tx;
      const oy = m.ty;
      if (bone.length > 0) {
        const tip = applyMat(m, bone.length, 0);
        const dx = tip.x - ox;
        const dy = tip.y - oy;
        const len = Math.hypot(dx, dy) || 1;
        const w = Math.min(len * 0.12, 6 / this.zoom);
        const nx = (-dy / len) * w;
        const ny = (dx / len) * w;
        g.poly([ox + nx, oy + ny, tip.x, tip.y, ox - nx, oy - ny]).fill({
          color,
          alpha: selected ? 1 : 0.6,
        });
      }
      const radius = (bone.parent === null ? 6 : 4.5) / this.zoom;
      g.circle(ox, oy, radius)
        .fill({ color, alpha: 0.95 })
        .stroke({ width: 1.2 / this.zoom, color: 0x1b1b1f, alpha: 0.8 });
    }
  }
```

(Changes from the original: `defaultColor` reads `bone.color` — same 6-hex slice pattern as `boneTint()` in `TreeRows.tsx`, falling back to the original `0x7fb2e5` when unset or unparseable; the selected color is `0x3875b7` (the `--accent` blue) instead of `0xffcc33`, and the extra outer selection ring (the old `if (selected) { g.circle(...).stroke(...) }` block with color `0xfff2c9`) is removed per the spec — selection is now conveyed by the fill color alone, matching a tighter dart taper (`0.12`/`6px` instead of `0.15`/`8px`) and a slightly smaller origin circle (radius 6/4.5 instead of 7/5) with a dark outline stroke, closer to the reference screenshot's proportions.)

- [ ] **Step 2: Verify**

Run `pnpm typecheck`. Manually: import an image, attach it to a bone, set `bone.color` via `set_bone_color`-style flow (or directly via the MCP/chat) to e.g. `ff8800ff` and confirm the unselected bone renders orange; select it and confirm it turns blue (`#3875b7`); a bone with no `color` set still renders the default blue-gray.

- [ ] **Step 3: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/viewport/renderer.ts
cd .. && git add client/packages/editor/src/viewport/renderer.ts
git commit -m "$(cat <<'EOF'
P23: bone rendering — color from bone.color, tighter dart shape, blue selection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Slot/attachment selection box

**Files:**

- Modify: `client/packages/editor/src/viewport/renderer.ts`

**Interfaces:**

- Consumes: `resolveAttachment`-independent lookup already used by `drawOverlays` (`data.skins.find(s => s.name === 'default')?.attachments?.[slot.name]`), `computeVertexWorldPositions` (already imported).
- Produces: no new exports; `drawOverlays()` behavior changes only (adds a selection outline branch; does not touch the existing type-colored overlays for non-selected attachments).

- [ ] **Step 1: Add a selection outline before the existing per-type overlay loop**

In `client/packages/editor/src/viewport/renderer.ts`, inside `drawOverlays` (starting line 544), the loop `for (const [name, att] of Object.entries(bySlot))` (line 551) already computes `isActive = slot.attachment === name`. Add a new check right after that line (after line 552, before the `if (att.type === 'point')` branch):

```ts
      for (const [name, att] of Object.entries(bySlot)) {
        const isActive = slot.attachment === name;
        const isSelected = isActive && input.selection.some((s) => s.kind === 'slot' && s.name === slot.name);
        if (isSelected) {
          this.drawSelectionBox(att, boneWorld, data.bones, pose);
        }
        if (att.type === 'point') {
```

- [ ] **Step 2: Add the `drawSelectionBox` helper method**

Add this new private method right before `drawBones` (i.e. right after the closing `}` of `drawPathSpline`, line 741, before `private drawBones(...)` at line 743):

```ts
  /** Blue bounding-box outline around the slot's active attachment when selected. */
  private drawSelectionBox(
    att: SpineAttachment,
    boneWorld: Mat2D,
    bones: BoneData[],
    pose: Map<string, Mat2D>,
  ): void {
    const g = this.overlayLayer;
    const color = 0x3875b7;
    const width = 1.5 / this.zoom;
    if (att.type === 'point') {
      const p = applyMat(boneWorld, att.x ?? 0, att.y ?? 0);
      const r = 10 / this.zoom;
      g.rect(p.x - r, p.y - r, r * 2, r * 2).stroke({ width, color, alpha: 0.9 });
      return;
    }
    if (att.type === 'mesh' || att.type === 'boundingbox' || att.type === 'clipping' || att.type === 'path') {
      const count = attachmentVertexCount(att);
      if (count === null) return;
      const verts = computeVertexWorldPositions(
        (att as { vertices: number[] }).vertices,
        count,
        boneWorld,
        bones,
        pose,
      );
      if (verts.length < 4) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < verts.length; i += 2) {
        const x = verts[i]!;
        const y = verts[i + 1]!;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      g.rect(minX, minY, maxX - minX, maxY - minY).stroke({ width, color, alpha: 0.9 });
      return;
    }
    if (att.type === undefined || att.type === 'region') {
      const region = att as SpineRegionAttachment;
      const rot = ((region.rotation ?? 0) * Math.PI) / 180;
      const hw = ((region.width ?? 0) / 2) * (region.scaleX ?? 1);
      const hh = ((region.height ?? 0) / 2) * (region.scaleY ?? 1);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const cx = region.x ?? 0;
      const cy = region.y ?? 0;
      const corners: [number, number][] = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ];
      const world = corners.map(([lx, ly]) =>
        applyMat(boneWorld, cx + lx * cos - ly * sin, cy + lx * sin + ly * cos),
      );
      g.poly(world.flatMap((p) => [p.x, p.y])).stroke({ width, color, alpha: 0.9 });
    }
  }
```

- [ ] **Step 2b: Verify the `attachmentVertexCount` reference resolves**

`attachmentVertexCount` is already defined and exported in this same file (line 75); `SpineAttachment`/`BoneData`/`SpineRegionAttachment` are already imported at the top of `renderer.ts` — no new imports needed for this task.

- [ ] **Step 3: Verify**

Run `pnpm typecheck`. Manually: select a slot with a region attachment in the tree — confirm a blue rectangle outline appears around it in the viewport (rotated/scaled correctly if the region has non-default rotation/scale); select a slot with a mesh/boundingbox/clipping attachment — confirm a blue axis-aligned bounding rectangle appears; select a slot with a point attachment — confirm a small blue square appears at the point; deselecting removes the box and existing type-colored overlays (clipping red / bbox cyan / path orange) still render unchanged for non-selected attachments.

- [ ] **Step 4: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/viewport/renderer.ts
cd .. && git add client/packages/editor/src/viewport/renderer.ts
git commit -m "$(cat <<'EOF'
P23: blue selection box around the active attachment of a selected slot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Hover preview tooltip in the tree

**Files:**

- Create: `client/packages/editor/src/components/tree/HoverPreview.tsx`
- Modify: `client/packages/editor/src/components/tree/TreeRows.tsx`
- Modify: `client/packages/editor/src/components/TreePanel.tsx`
- Modify: `client/packages/editor/src/styles.css`

**Interfaces:**

- Produces: `HoverPreview({x, y, asset}: {x: number; y: number; asset: ImageAsset})` component; `TreeRows` gains an `onHover: (info: {x: number; y: number; asset: ImageAsset} | null) => void` prop.

- [ ] **Step 1: Create `HoverPreview.tsx`**

```tsx
import type { ImageAsset } from '../../state/store.js';

/** Small floating thumbnail shown beside a tree row on hover. */
export function HoverPreview({
  x,
  y,
  asset,
}: {
  x: number;
  y: number;
  asset: ImageAsset;
}) {
  return (
    <div className="hover-preview" style={{ left: x, top: y }}>
      <img src={asset.dataUrl} alt={asset.name} />
      <div className="hover-preview-meta">
        {asset.name} · {asset.width}×{asset.height}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Thread hover state through `TreeRows`**

In `client/packages/editor/src/components/tree/TreeRows.tsx`, add an `ImageAsset` import and `assets`/`onHover` wiring. Change the import block (lines 1-15) to add the store import:

```ts
import { AddBone, RemoveBone, RenameBone, ReparentBone, createBone } from '@spine-editor/core';
import { useState } from 'react';
import { isSelected, uniqueName, useEditor, type ImageAsset } from '../../state/store.js';
import type { MenuItem } from './ContextMenu.js';
import {
  BBoxIcon,
  BoneIcon,
  ChevronIcon,
  ClipIcon,
  CurveIcon,
  ImageIcon,
  MeshIcon,
  PointIcon,
  SlotIcon,
} from '../icons.js';
import { clickSelect, moveSlotInDrawOrder } from './tree-actions.js';
```

Change the `TreeRows` function signature (line 40-48) to accept `onHover`:

```ts
export function TreeRows({
  query,
  show,
  openMenu,
  onHover,
}: {
  query: string;
  show: { slots: boolean; attachments: boolean; constraints: boolean };
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  onHover: (info: { x: number; y: number; asset: ImageAsset } | null) => void;
}) {
```

Read `assets` from the store (after the existing `const hiddenSlots = ...` / `const collapsedNodes = ...` lines added in Task 1):

```ts
  const assets = useEditor((s) => s.assets);
```

Update `AttachmentRows` (as written in Task 1's Step 3) to resolve the backing asset and attach hover handlers:

```ts
  function AttachmentRows({ slotName, depth }: { slotName: string; depth: number }) {
    if (!show.attachments) return null;
    const bySlot = defaultAtts[slotName] ?? {};
    return (
      <>
        {Object.entries(bySlot).map(([attName, att]) => {
          const type = (att as { type?: string }).type ?? 'region';
          const Icon = ATT_ICONS[type] ?? ImageIcon;
          const assetKey = (att as { path?: string; name?: string }).path ?? (att as { path?: string; name?: string }).name ?? attName;
          const asset = assets[assetKey];
          return (
            <div
              key={attName}
              className="row attachment"
              style={{ paddingLeft: 8 + depth * 14 }}
              title={type}
              onClick={(e) => clickSelect(e, { kind: 'slot', name: slotName })}
              onMouseEnter={
                asset
                  ? (e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      onHover({ x: rect.right + 8, y: rect.top, asset });
                    }
                  : undefined
              }
              onMouseLeave={asset ? () => onHover(null) : undefined}
            >
              <span className="chevron-spacer" />
              <span className="type-icon">
                <Icon size={12} />
              </span>
              {attName}
            </div>
          );
        })}
      </>
    );
  }
```

- [ ] **Step 3: Wire hover state + render `HoverPreview` in `TreePanel`**

In `client/packages/editor/src/components/TreePanel.tsx`, add the import:

```ts
import { HoverPreview } from './tree/HoverPreview.js';
import type { ImageAsset } from '../state/store.js';
```

(add these two lines next to the existing `import { TreeRows } from './tree/TreeRows.js';` import, e.g. right after it.)

In the `TreePanel` function body, add hover state (right after the existing `const [menu, setMenu] = useState<...>(null);` at line 377):

```ts
  const [hovered, setHovered] = useState<{ x: number; y: number; asset: ImageAsset } | null>(null);
```

Pass `onHover` to `<TreeRows .../>` (line 413) and render the preview near the end of the panel's JSX (right before the closing `{menu && <ContextMenu ... />}` line, i.e. after line 437's closing `</div>` of `.tree-dock`):

```tsx
        <TreeRows query={filter.trim().toLowerCase()} show={show} openMenu={openMenu} onHover={setHovered} />
```

```tsx
      </div>
      {hovered && <HoverPreview x={hovered.x} y={hovered.y} asset={hovered.asset} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: CSS for `.hover-preview`**

In `client/packages/editor/src/styles.css`, add near the `.dropdown` rule (after line 1094's closing brace):

```css
.hover-preview {
  position: fixed;
  z-index: 45;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.hover-preview img {
  display: block;
  max-width: 96px;
  max-height: 96px;
  object-fit: contain;
  background: #1b1b1f;
}

.hover-preview-meta {
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-dim);
  text-align: center;
  white-space: nowrap;
}
```

- [ ] **Step 5: Verify**

Run `pnpm typecheck`. Manually: hover a region-attachment row that has a matching imported asset — confirm a thumbnail + name + dimensions appears to the right of the row; hover a row without a matching asset (e.g. a boundingbox attachment) — confirm nothing appears; move the mouse away — confirm the tooltip disappears.

- [ ] **Step 6: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/components/tree/HoverPreview.tsx packages/editor/src/components/tree/TreeRows.tsx packages/editor/src/components/TreePanel.tsx packages/editor/src/styles.css
cd .. && git add client/packages/editor/src/components/tree/HoverPreview.tsx client/packages/editor/src/components/tree/TreeRows.tsx client/packages/editor/src/components/TreePanel.tsx client/packages/editor/src/styles.css
git commit -m "$(cat <<'EOF'
P23: hover thumbnail preview for slot/attachment rows in the tree

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Viewport ruler toggle

**Files:**

- Modify: `client/packages/editor/src/state/store.ts`
- Modify: `client/packages/editor/src/components/icons.tsx`
- Modify: `client/packages/editor/src/components/ZoomControl.tsx`
- Modify: `client/packages/editor/src/viewport/renderer.ts`
- Modify: `client/packages/editor/src/components/Viewport.tsx`
- Modify: `client/packages/editor/src/styles.css`

**Interfaces:**

- Produces: `EditorSettings.showRulers: boolean` (persisted via the existing `setSettings` action — no new store action needed), `RulerIcon`, `RenderInput.showRulers?: boolean`, `SceneRenderer`'s `render()` draws rulers when set.

- [ ] **Step 1: Add `showRulers` to `EditorSettings`**

In `client/packages/editor/src/state/store.ts`, change the `EditorSettings` interface (lines 51-55):

```ts
export interface EditorSettings {
  fps: 24 | 30 | 60;
  autosave: boolean;
  welcome: boolean;
  showRulers: boolean;
}
```

Change `loadSettings()` (lines 59-73):

```ts
function loadSettings(): EditorSettings {
  const defaults: EditorSettings = { fps: 30, autosave: true, welcome: true, showRulers: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<EditorSettings>;
    return {
      fps: parsed.fps === 24 || parsed.fps === 60 ? parsed.fps : 30,
      autosave: parsed.autosave !== false,
      welcome: parsed.welcome !== false,
      showRulers: parsed.showRulers === true,
    };
  } catch {
    return defaults;
  }
}
```

No action changes needed — `setSettings(patch: Partial<EditorSettings>)` already exists and persists to `localStorage` (lines 406-415).

- [ ] **Step 2: Add `RulerIcon`**

In `client/packages/editor/src/components/icons.tsx`, add after `ChevronIcon` (added in Task 1):

```ts
export const RulerIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <rect x="2" y="2" width="12" height="12" />
      <path d="M2 5h2M2 8h3M2 11h2M5 2h2M8 2h3M11 2h2" />
    </>,
  );
```

- [ ] **Step 3: Add the toggle button to `ZoomControl`**

Replace `client/packages/editor/src/components/ZoomControl.tsx` in full:

```tsx
import { useEffect, useState } from 'react';
import { useEditor } from '../state/store.js';
import { RulerIcon } from './icons.js';
import type { SceneRenderer } from '../viewport/renderer.js';

/** Spine-style zoom slider in the viewport's lower-left corner. */
export function ZoomControl({ getRenderer }: { getRenderer: () => SceneRenderer | null }) {
  const [zoom, setZoom] = useState(1);
  const showRulers = useEditor((s) => s.settings.showRulers);
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
      <button
        className={showRulers ? 'active' : ''}
        title="Toggle rulers"
        onClick={() =>
          useEditor.getState().setSettings({ showRulers: !useEditor.getState().settings.showRulers })
        }
      >
        <RulerIcon size={13} />
      </button>
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
      <button className="zoom-reset" title="Reset zoom" onClick={() => apply(1)}>
        1:1
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add `showRulers` to `RenderInput` and a `drawRulers` method**

In `client/packages/editor/src/viewport/renderer.ts`, add a field to `RenderInput` (right after `activeSkin?: string;` at line 58):

```ts
  /** Editor-only ruler overlay toggle (never serialized). */
  showRulers?: boolean;
```

Add a `rulerLayer` field to `SceneRenderer` (right after `private overlayLayer = new Graphics();` at line 192):

```ts
  private rulerLayer = new Graphics();
```

Add `this.rulerLayer` to the stage (rulers are screen-space, so they must be added to `this.app.stage` directly, not `this.world` which carries the zoom/pan matrix) — in `init()`, right after `this.app.stage.addChild(this.labelLayer);` (line 232):

```ts
    this.app.stage.addChild(this.labelLayer);
    this.app.stage.addChild(this.rulerLayer);
```

Add the `drawRulers` method right after `drawGrid` (after line 328's closing `}`):

```ts
  /** Screen-space ruler strips (top + left) with world-unit tick labels. */
  private drawRulers(): void {
    const g = this.rulerLayer;
    g.clear();
    if (!this.ready) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const band = 18;
    g.rect(0, 0, w, band).fill({ color: 0x1b1b1f, alpha: 0.85 });
    g.rect(0, 0, band, h).fill({ color: 0x1b1b1f, alpha: 0.85 });
    // Pick a "nice" world-unit step so ticks land roughly every 50-100 screen px.
    const rawStep = 70 / this.zoom;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const candidates = [1, 2, 5, 10].map((m) => m * magnitude);
    const step = candidates.find((c) => c >= rawStep) ?? candidates[candidates.length - 1]!;
    const topLeftWorld = this.screenToWorld(band, band);
    const bottomRightWorld = this.screenToWorld(w, h);
    const startX = Math.floor(topLeftWorld.x / step) * step;
    const endX = Math.ceil(bottomRightWorld.x / step) * step;
    for (let wx = startX; wx <= endX; wx += step) {
      const sx = this.worldToScreen(wx, 0).x;
      if (sx < band || sx > w) continue;
      g.moveTo(sx, band - 6).lineTo(sx, band).stroke({ width: 1, color: 0x8a8a92, pixelLine: true });
      const t = new Text({ text: String(Math.round(wx)), style: { fontSize: 9, fill: 0x9a9aa2 } });
      t.position.set(sx + 2, 2);
      this.rulerLayer.addChild(t);
      this.rulerGarbage.push(t);
    }
    const startY = Math.floor(bottomRightWorld.y / step) * step;
    const endY = Math.ceil(topLeftWorld.y / step) * step;
    for (let wy = startY; wy <= endY; wy += step) {
      const sy = this.worldToScreen(0, wy).y;
      if (sy < band || sy > h) continue;
      g.moveTo(band - 6, sy).lineTo(band, sy).stroke({ width: 1, color: 0x8a8a92, pixelLine: true });
      const t = new Text({ text: String(Math.round(wy)), style: { fontSize: 9, fill: 0x9a9aa2 } });
      t.position.set(2, sy + 2);
      this.rulerLayer.addChild(t);
      this.rulerGarbage.push(t);
    }
  }
```

Add a small garbage-collection array for the per-frame `Text` labels (rulers redraw every frame like the rest of the scene, so old label `Text` objects must be destroyed to avoid leaking) — add the field next to `rulerLayer`:

```ts
  private rulerLayer = new Graphics();
  private rulerGarbage: Text[] = [];
```

At the top of `drawRulers`, before `g.clear()`, destroy the previous frame's labels:

```ts
  private drawRulers(): void {
    for (const t of this.rulerGarbage) t.destroy();
    this.rulerGarbage = [];
    const g = this.rulerLayer;
    g.clear();
```

Finally, call `drawRulers()` from `render()` — add right after the existing `this.updateLabels(data, pose);` line (line 499):

```ts
    this.updateLabels(data, pose);
    this.rulerLayer.visible = input.showRulers === true;
    if (input.showRulers) this.drawRulers();
```

- [ ] **Step 5: Pass `showRulers` from `buildRenderInput` in `Viewport.tsx`**

In `client/packages/editor/src/components/Viewport.tsx`, in `buildRenderInput()` (the object returned starting line 203), add a field right after `activeSkin: state.activeSkin,` (line 234):

```ts
      activeSkin: state.activeSkin,
      showRulers: state.settings.showRulers,
```

Also add `state.settings.showRulers` (or `settings` as a whole) to the `useEditor` subscriptions so the viewport re-renders when the toggle flips — the component already has `const revision = useEditor((s) => s.revision);` etc. at the top; add:

```ts
  const showRulers = useEditor((s) => s.settings.showRulers);
```

right after `const posePreview = useEditor((s) => s.posePreview);` (line 152), and add `showRulers` to the `useEffect(redraw, [...])` dependency array (line 280-295):

```ts
  useEffect(redraw, [
    revision,
    selection,
    assets,
    mode,
    meshEdit,
    activeSkin,
    animCurrent,
    animTime,
    animGhost,
    ghostConfig,
    viewFilters,
    hiddenBones,
    hiddenSlots,
    posePreview,
    showRulers,
  ]);
```

- [ ] **Step 6: CSS for the active ruler-toggle button**

In `client/packages/editor/src/styles.css`, add after the `.zoom-control button` rule (after line 1289):

```css
.zoom-control button.active {
  background: var(--accent-soft);
}
```

- [ ] **Step 7: Verify**

Run `pnpm typecheck`. Manually: click the ruler icon button — confirm two dark strips with tick marks + numbers appear along the top and left edges of the viewport, updating as you zoom/pan; click again — confirm they disappear; reload the page — confirm the toggle state persists (it's part of `settings`, same persistence as `fps`/`autosave`).

- [ ] **Step 8: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/state/store.ts packages/editor/src/components/icons.tsx packages/editor/src/components/ZoomControl.tsx packages/editor/src/viewport/renderer.ts packages/editor/src/components/Viewport.tsx packages/editor/src/styles.css
cd .. && git add client/packages/editor/src/state/store.ts client/packages/editor/src/components/icons.tsx client/packages/editor/src/components/ZoomControl.tsx client/packages/editor/src/viewport/renderer.ts client/packages/editor/src/components/Viewport.tsx client/packages/editor/src/styles.css
git commit -m "$(cat <<'EOF'
P23: viewport ruler toggle with world-unit tick labels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Fit-to-content Center button

**Files:**

- Create: `client/packages/editor/src/viewport/bounds.ts`
- Create: `client/packages/editor/test/bounds.test.ts`
- Modify: `client/packages/editor/src/viewport/renderer.ts`
- Modify: `client/packages/editor/src/components/icons.tsx`
- Modify: `client/packages/editor/src/components/ZoomControl.tsx`

**Interfaces:**

- Consumes: `resolveAttachment`, `attachmentVertexCount` (both exported from `viewport/renderer.ts`).
- Produces: `computeSkeletonBounds(data, pose, hiddenBones?, hiddenSlots?, activeSkin?): {minX,minY,maxX,maxY} | null` in `viewport/bounds.ts`; `SceneRenderer.frameBounds(bounds, padding?)` and `SceneRenderer.getFullPose()` in `renderer.ts`; `FrameIcon`.

- [ ] **Step 1: Write the failing test for `computeSkeletonBounds`**

Create `client/packages/editor/test/bounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createBone, createEmptySkeleton, createSlot, computePose } from '@spine-editor/core';
import { computeSkeletonBounds } from '../src/viewport/bounds.js';

describe('computeSkeletonBounds', () => {
  it('returns null for an empty skeleton', () => {
    const data = createEmptySkeleton();
    const pose = computePose(data);
    expect(computeSkeletonBounds(data, pose)).toBeNull();
  });

  it('bounds a single bone by its origin and tip', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root', { x: 10, y: 0, length: 40 }));
    const pose = computePose(data);
    const b = computeSkeletonBounds(data, pose)!;
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxX).toBeCloseTo(50);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(0);
  });

  it('bounds a region attachment by its rotated corners', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root', { length: 0 }));
    data.slots.push(createSlot('s', 'a', { attachment: 'img' }));
    data.skins[0]!.attachments = {
      s: { img: { type: 'region', x: 0, y: 0, width: 20, height: 10 } },
    };
    const pose = computePose(data);
    const b = computeSkeletonBounds(data, pose)!;
    expect(b.minX).toBeCloseTo(-10);
    expect(b.maxX).toBeCloseTo(10);
    expect(b.minY).toBeCloseTo(-5);
    expect(b.maxY).toBeCloseTo(5);
  });

  it('excludes hidden bones', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root', { x: 500, length: 10 }));
    const pose = computePose(data);
    expect(computeSkeletonBounds(data, pose, new Set(['a', 'root']))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && pnpm --filter @spine-editor/editor test -- test/bounds.test.ts`
Expected: FAIL — `Cannot find module '../src/viewport/bounds.js'`.

- [ ] **Step 3: Implement `viewport/bounds.ts`**

```ts
import {
  applyMat,
  computeVertexWorldPositions,
  type BoneData,
  type Mat2D,
  type SkeletonData,
  type SpineRegionAttachment,
} from '@spine-editor/core';
import { attachmentVertexCount, resolveAttachment } from './renderer.js';

/**
 * World-space AABB covering every visible bone (origin + tip) and every
 * visible slot's active attachment shape. Returns null for an empty/fully
 * hidden skeleton (the caller should treat that as a no-op).
 */
export function computeSkeletonBounds(
  data: SkeletonData,
  pose: Map<string, Mat2D>,
  hiddenBones: ReadonlySet<string> = new Set(),
  hiddenSlots: ReadonlySet<string> = new Set(),
  activeSkin = 'default',
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const bone of data.bones) {
    if (hiddenBones.has(bone.name)) continue;
    const m = pose.get(bone.name);
    if (!m) continue;
    extend(m.tx, m.ty);
    if (bone.length > 0) {
      const tip = applyMat(m, bone.length, 0);
      extend(tip.x, tip.y);
    }
  }

  for (const slot of data.slots) {
    if (hiddenSlots.has(slot.name) || !slot.attachment) continue;
    const boneWorld = pose.get(slot.bone);
    if (!boneWorld) continue;
    const att = resolveAttachment(data, slot.name, slot.attachment, activeSkin);
    if (!att) continue;
    if (
      att.type === 'mesh' ||
      att.type === 'boundingbox' ||
      att.type === 'clipping' ||
      att.type === 'path'
    ) {
      const count = attachmentVertexCount(att);
      if (count === null) continue;
      const verts = computeVertexWorldPositions(
        (att as { vertices: number[] }).vertices,
        count,
        boneWorld,
        data.bones,
        pose,
      );
      for (let i = 0; i < verts.length; i += 2) extend(verts[i]!, verts[i + 1]!);
    } else if (att.type === undefined || att.type === 'region') {
      const region = att as SpineRegionAttachment;
      const rot = ((region.rotation ?? 0) * Math.PI) / 180;
      const hw = ((region.width ?? 0) / 2) * (region.scaleX ?? 1);
      const hh = ((region.height ?? 0) / 2) * (region.scaleY ?? 1);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const cx = region.x ?? 0;
      const cy = region.y ?? 0;
      const corners: [number, number][] = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ];
      for (const [lx, ly] of corners) {
        const p = applyMat(boneWorld, cx + lx * cos - ly * sin, cy + lx * sin + ly * cos);
        extend(p.x, p.y);
      }
    } else if (att.type === 'point') {
      const p = applyMat(boneWorld, att.x ?? 0, att.y ?? 0);
      extend(p.x, p.y);
    }
  }

  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** Unused import guard: keeps BoneData referenced for downstream callers' typing. */
export type { BoneData };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && pnpm --filter @spine-editor/editor test -- test/bounds.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `frameBounds` + `getFullPose` to `SceneRenderer`**

In `client/packages/editor/src/viewport/renderer.ts`, add both methods right after `setZoomCenter` (after line 272's closing `}`):

```ts
  /** Full bone-name → world-matrix map from the last render (for external bounds computation). */
  getFullPose(): Map<string, Mat2D> {
    return this.lastPose;
  }

  /** Zooms/pans so `bounds` fits the canvas with the given fractional padding on each side. */
  frameBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, padding = 0.1): void {
    const w = Math.max(1e-3, bounds.maxX - bounds.minX);
    const h = Math.max(1e-3, bounds.maxY - bounds.minY);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    this.zoom = Math.min(
      20,
      Math.max(0.05, Math.min(screenW / (w * (1 + padding * 2)), screenH / (h * (1 + padding * 2)))),
    );
    this.offsetX = screenW / 2 - cx * this.zoom;
    this.offsetY = screenH / 2 + cy * this.zoom;
    this.applyCamera();
    this.onZoomChange?.(this.zoom);
  }
```

- [ ] **Step 6: Add `FrameIcon`**

In `client/packages/editor/src/components/icons.tsx`, add after `RulerIcon` (added in Task 5):

```ts
export const FrameIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
    </>,
  );
```

- [ ] **Step 7: Add the Center button to `ZoomControl`**

In `client/packages/editor/src/components/ZoomControl.tsx`, add the imports:

```ts
import { computeSkeletonBounds } from '../viewport/bounds.js';
import { FrameIcon, RulerIcon } from './icons.js';
```

(replacing the single `import { RulerIcon } from './icons.js';` line from Task 5.)

Add an `onCenter` handler and button. Replace the full file:

```tsx
import { useEffect, useState } from 'react';
import { useEditor } from '../state/store.js';
import { computeSkeletonBounds } from '../viewport/bounds.js';
import { FrameIcon, RulerIcon } from './icons.js';
import type { SceneRenderer } from '../viewport/renderer.js';

/** Spine-style zoom slider in the viewport's lower-left corner. */
export function ZoomControl({ getRenderer }: { getRenderer: () => SceneRenderer | null }) {
  const [zoom, setZoom] = useState(1);
  const showRulers = useEditor((s) => s.settings.showRulers);
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
  function onCenter() {
    const r = getRenderer();
    if (!r) return;
    const state = useEditor.getState();
    const bounds = computeSkeletonBounds(
      state.doc.data,
      r.getFullPose(),
      state.hiddenBones.length ? new Set(state.hiddenBones) : undefined,
      state.hiddenSlots.length ? new Set(state.hiddenSlots) : undefined,
      state.activeSkin,
    );
    if (bounds) r.frameBounds(bounds);
  }
  return (
    <div className="zoom-control">
      <button
        className={showRulers ? 'active' : ''}
        title="Toggle rulers"
        onClick={() =>
          useEditor.getState().setSettings({ showRulers: !useEditor.getState().settings.showRulers })
        }
      >
        <RulerIcon size={13} />
      </button>
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
      <button className="zoom-reset" title="Reset zoom" onClick={() => apply(1)}>
        1:1
      </button>
      <button title="Center on skeleton" onClick={onCenter}>
        <FrameIcon size={13} />
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Verify**

Run `cd client && pnpm --filter @spine-editor/editor test -- test/bounds.test.ts` (still passing) and `pnpm typecheck`. Manually: zoom/pan far away from the skeleton, click the Center button — confirm the view snaps back to frame the whole skeleton with a small margin; on an empty project (no bones beyond root, no attachments) confirm clicking Center doesn't throw or zoom to an extreme value (no-op, per the null-bounds guard).

- [ ] **Step 9: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/viewport/bounds.ts packages/editor/test/bounds.test.ts packages/editor/src/viewport/renderer.ts packages/editor/src/components/icons.tsx packages/editor/src/components/ZoomControl.tsx
cd .. && git add client/packages/editor/src/viewport/bounds.ts client/packages/editor/test/bounds.test.ts client/packages/editor/src/viewport/renderer.ts client/packages/editor/src/components/icons.tsx client/packages/editor/src/components/ZoomControl.tsx
git commit -m "$(cat <<'EOF'
P23: fit-to-content Center button (computeSkeletonBounds + frameBounds)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Core command — `SetAttachmentTransform`

**Files:**

- Modify: `client/packages/core/src/commands/structure.ts`
- Modify: `client/packages/core/test/commands.test.ts` (or create `client/packages/core/test/attachment-transform.test.ts` if a dedicated file reads more cleanly — check the existing file first; if `commands.test.ts` doesn't exist, use a new file `client/packages/core/test/attachment-transform.test.ts`)

**Interfaces:**

- Consumes: `SkeletonData`, `SpineSkin` (already imported in `structure.ts`).
- Produces: `SetAttachmentTransform` class (exported automatically via the existing `export * from './commands/structure.js'` in `packages/core/src/index.ts` — no separate export edit needed).

- [ ] **Step 1: Check for an existing commands test file to extend**

Run: `ls client/packages/core/test/ | grep -i command`

If a suitable existing file (e.g. testing `SetAttachmentVertices`) exists, add the new tests there following its exact import style. Otherwise create `client/packages/core/test/attachment-transform.test.ts`.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { createBone, createEmptySkeleton, createSlot, SetAttachmentTransform } from '../src/index.js';

describe('SetAttachmentTransform', () => {
  function setupData() {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root'));
    data.slots.push(createSlot('s', 'a', { attachment: 'img' }));
    data.skins[0]!.attachments = {
      s: {
        img: { type: 'region', x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
        pt: { type: 'point', x: 3, y: 4, rotation: 0 },
        m: { type: 'mesh', uvs: [0, 0], triangles: [], vertices: [0, 0], hull: 1 },
      },
    };
    return data;
  }

  it('patches x/y/rotation/scaleX/scaleY on a region attachment', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'img', { x: 10, rotation: 45 });
    cmd.execute(data);
    const att = data.skins[0]!.attachments!.s!.img as { x?: number; y?: number; rotation?: number };
    expect(att.x).toBe(10);
    expect(att.rotation).toBe(45);
    expect(att.y).toBe(2); // untouched field kept
  });

  it('undoes back to the prior values', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'img', { x: 10 });
    cmd.execute(data);
    cmd.undo(data);
    const att = data.skins[0]!.attachments!.s!.img as { x?: number };
    expect(att.x).toBe(1);
  });

  it('patches x/y/rotation on a point attachment', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'pt', { x: 9 });
    cmd.execute(data);
    const att = data.skins[0]!.attachments!.s!.pt as { x?: number };
    expect(att.x).toBe(9);
  });

  it('throws when the patch includes a field the type does not support', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'pt', { scaleX: 2 });
    expect(() => cmd.execute(data)).toThrow(/no "scaleX" field/);
  });

  it('throws for a type with no transform fields at all', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'm', { x: 1 });
    expect(() => cmd.execute(data)).toThrow(/no transform fields/);
  });

  it('throws when the skin/slot/attachment does not exist', () => {
    const data = setupData();
    expect(() => new SetAttachmentTransform('nope', 's', 'img', { x: 1 }).execute(data)).toThrow(
      /Skin "nope"/,
    );
    expect(() => new SetAttachmentTransform('default', 'nope', 'img', { x: 1 }).execute(data)).toThrow(
      /does not exist/,
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd client && pnpm --filter @spine-editor/core test -- test/attachment-transform.test.ts`
Expected: FAIL — `SetAttachmentTransform` is not exported.

- [ ] **Step 4: Implement `SetAttachmentTransform`**

In `client/packages/core/src/commands/structure.ts`, add this class right after the closing `}` of `SetAttachmentVertices` (the class ends around line 260-ish — find the exact end by locating the next blank line after `SetAttachmentVertices`'s `undo` method):

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && pnpm --filter @spine-editor/core test -- test/attachment-transform.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full core suite to confirm no regressions**

Run: `cd client && pnpm --filter @spine-editor/core test`
Expected: all existing tests (176 previously) plus the 6 new ones pass.

- [ ] **Step 7: Commit**

```bash
cd client && pnpm exec prettier --write packages/core/src/commands/structure.ts packages/core/test/attachment-transform.test.ts
cd .. && git add client/packages/core/src/commands/structure.ts client/packages/core/test/attachment-transform.test.ts
git commit -m "$(cat <<'EOF'
P23: core command SetAttachmentTransform (region x/y/rotation/scale, point x/y/rotation)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Gizmo pure-math module

**Files:**

- Create: `client/packages/editor/src/viewport/gizmo.ts`
- Create: `client/packages/editor/test/gizmo.test.ts`

**Interfaces:**

- Produces: `GizmoFrame`, `computeFrame(axesMode, targetWorld, parentWorld): GizmoFrame`, `ScreenGizmo`, `frameToScreen(frame, worldToScreen): ScreenGizmo`, `GizmoHit`, `hitTestGizmo(tool, origin, axisX, axisY, handleLength, ringRadius, threshold, point): GizmoHit | null`, `projectWorld(dx, dy, frame, axis): {x,y}`, `projectScreen(dx, dy, axis): number`, constants `GIZMO_HANDLE_PX`, `GIZMO_RING_PX`, `GIZMO_HIT_PX`, `GIZMO_SCALE_BOX_PX`. Consumed by Task 9 (bone gizmo) and Task 10 (attachment gizmo).

**Coordinate convention** (critical — read before implementing): `Mat2D` follows `x' = a·x + b·y + tx, y' = c·x + d·y + ty`. Applying the linear part to the local unit vector `(1,0)` gives `(a, c)` — that is the **local +X axis's world-space direction** — and applying it to `(0,1)` gives `(b, d)`, the **local +Y axis's world-space direction**. (Note: this is *not* the same extraction the existing Shift-constrain code in `Viewport.tsx` uses for its dominant-axis heuristic — that code normalizes `(a,b)`/`(c,d)` instead of `(a,c)`/`(b,d)`, which is harmless there because it only ever projects and reconstructs along its own self-consistent axis, but would draw a visually wrong arrow direction for a rotated bone if reused here. `gizmo.ts` uses the geometrically correct `(a,c)`/`(b,d)` extraction so the drawn handle and the hit-tested/dragged axis always agree.)

- [ ] **Step 1: Write the failing tests**

Create `client/packages/editor/test/gizmo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { IDENTITY, type Mat2D } from '@spine-editor/core';
import {
  computeFrame,
  frameToScreen,
  hitTestGizmo,
  projectScreen,
  projectWorld,
} from '../src/viewport/gizmo.js';

const ROT90: Mat2D = { a: 0, b: -1, c: 1, d: 0, tx: 5, ty: 7 };

describe('computeFrame', () => {
  it('world mode always returns the fixed screen axes at the target origin', () => {
    const f = computeFrame('world', ROT90, undefined);
    expect(f.origin).toEqual({ x: 5, y: 7 });
    expect(f.axisX).toEqual({ x: 1, y: 0 });
    expect(f.axisY).toEqual({ x: 0, y: 1 });
  });

  it('local mode extracts the target matrix columns as world-space axis directions', () => {
    const f = computeFrame('local', ROT90, undefined);
    expect(f.axisX.x).toBeCloseTo(0);
    expect(f.axisX.y).toBeCloseTo(1);
    expect(f.axisY.x).toBeCloseTo(-1);
    expect(f.axisY.y).toBeCloseTo(0);
  });

  it('parent mode uses the parent matrix, falling back to target if absent', () => {
    const f1 = computeFrame('parent', ROT90, IDENTITY);
    expect(f1.axisX).toEqual({ x: 1, y: 0 });
    expect(f1.axisY).toEqual({ x: 0, y: 1 });
    const f2 = computeFrame('parent', ROT90, undefined);
    expect(f2.axisX.y).toBeCloseTo(1);
  });
});

describe('projectWorld / projectScreen', () => {
  it('projects a delta onto one frame axis, zeroing the other component', () => {
    const f = computeFrame('world', IDENTITY, undefined);
    const p = projectWorld(3, 4, f, 'x');
    expect(p).toEqual({ x: 3, y: 0 });
    const q = projectWorld(3, 4, f, 'y');
    expect(q).toEqual({ x: 0, y: 4 });
  });

  it('projectScreen returns a signed scalar along a unit axis', () => {
    expect(projectScreen(10, 0, { x: 1, y: 0 })).toBeCloseTo(10);
    expect(projectScreen(10, 0, { x: -1, y: 0 })).toBeCloseTo(-10);
    expect(projectScreen(0, 5, { x: 0, y: -1 })).toBeCloseTo(-5);
  });
});

describe('frameToScreen', () => {
  it('flips the Y axis to match a Y-down worldToScreen', () => {
    const f = computeFrame('world', IDENTITY, undefined);
    const worldToScreen = (x: number, y: number) => ({ x, y: -y });
    const screen = frameToScreen(f, worldToScreen);
    expect(screen.origin).toEqual({ x: 0, y: 0 });
    expect(screen.axisX).toEqual({ x: 1, y: 0 });
    expect(screen.axisY).toEqual({ x: 0, y: -1 });
  });
});

describe('hitTestGizmo', () => {
  const origin = { x: 100, y: 100 };
  const axisX = { x: 1, y: 0 };
  const axisY = { x: 0, y: -1 };

  it('hits the rotate ring within threshold, misses outside it', () => {
    expect(hitTestGizmo('rotate', origin, axisX, axisY, 40, 28, 8, { x: 128, y: 100 })).toEqual({
      tool: 'rotate',
    });
    expect(hitTestGizmo('rotate', origin, axisX, axisY, 40, 28, 8, { x: 100, y: 100 })).toBeNull();
  });

  it('hits the X handle segment and the Y handle segment', () => {
    expect(hitTestGizmo('translate', origin, axisX, axisY, 40, 28, 8, { x: 120, y: 102 })).toEqual({
      tool: 'axis',
      axis: 'x',
    });
    expect(hitTestGizmo('translate', origin, axisX, axisY, 40, 28, 8, { x: 102, y: 80 })).toEqual({
      tool: 'axis',
      axis: 'y',
    });
  });

  it('misses when the point is far from both handles and the ring', () => {
    expect(hitTestGizmo('scale', origin, axisX, axisY, 40, 28, 8, { x: 300, y: 300 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && pnpm --filter @spine-editor/editor test -- test/gizmo.test.ts`
Expected: FAIL — `Cannot find module '../src/viewport/gizmo.js'`.

- [ ] **Step 3: Implement `viewport/gizmo.ts`**

```ts
import type { Mat2D } from '@spine-editor/core';
import type { AxesMode } from '../state/store.js';

export const GIZMO_HANDLE_PX = 40;
export const GIZMO_RING_PX = 28;
export const GIZMO_HIT_PX = 8;
export const GIZMO_SCALE_BOX_PX = 6;

/** World-space reference frame a gizmo's handles are drawn/dragged along. */
export interface GizmoFrame {
  origin: { x: number; y: number };
  /** Unit vector: world-space direction of the frame's +X axis. */
  axisX: { x: number; y: number };
  /** Unit vector: world-space direction of the frame's +Y axis. */
  axisY: { x: number; y: number };
}

/**
 * Frame per `axesMode` (Spine-style Local/Parent/World), matching the
 * `Mat2D` convention `x' = a·x + b·y + tx, y' = c·x + d·y + ty`: the local
 * +X direction in world space is `(a, c)` and +Y is `(b, d)`.
 */
export function computeFrame(
  axesMode: AxesMode,
  targetWorld: Mat2D,
  parentWorld: Mat2D | undefined,
): GizmoFrame {
  const origin = { x: targetWorld.tx, y: targetWorld.ty };
  if (axesMode === 'world') {
    return { origin, axisX: { x: 1, y: 0 }, axisY: { x: 0, y: 1 } };
  }
  const ref = axesMode === 'local' ? targetWorld : (parentWorld ?? targetWorld);
  const lx = Math.hypot(ref.a, ref.c) || 1;
  const ly = Math.hypot(ref.b, ref.d) || 1;
  return {
    origin,
    axisX: { x: ref.a / lx, y: ref.c / lx },
    axisY: { x: ref.b / ly, y: ref.d / ly },
  };
}

/** A `GizmoFrame` re-expressed in screen-space (unit axis directions, for hit-testing). */
export interface ScreenGizmo {
  origin: { x: number; y: number };
  axisX: { x: number; y: number };
  axisY: { x: number; y: number };
}

export function frameToScreen(
  frame: GizmoFrame,
  worldToScreen: (x: number, y: number) => { x: number; y: number },
): ScreenGizmo {
  const origin = worldToScreen(frame.origin.x, frame.origin.y);
  const px = worldToScreen(frame.origin.x + frame.axisX.x, frame.origin.y + frame.axisX.y);
  const py = worldToScreen(frame.origin.x + frame.axisY.x, frame.origin.y + frame.axisY.y);
  const normalize = (v: { x: number; y: number }) => {
    const len = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / len, y: v.y / len };
  };
  return {
    origin,
    axisX: normalize({ x: px.x - origin.x, y: px.y - origin.y }),
    axisY: normalize({ x: py.x - origin.x, y: py.y - origin.y }),
  };
}

export type GizmoHit = { tool: 'rotate' } | { tool: 'axis'; axis: 'x' | 'y' };

/**
 * Hit-tests a SCREEN-space `point` against the gizmo for `tool`. `origin`/
 * `axisX`/`axisY` are screen-space (from `frameToScreen`); `handleLength`/
 * `ringRadius`/`threshold` are screen pixels.
 */
export function hitTestGizmo(
  tool: 'rotate' | 'translate' | 'scale' | 'shear',
  origin: { x: number; y: number },
  axisX: { x: number; y: number },
  axisY: { x: number; y: number },
  handleLength: number,
  ringRadius: number,
  threshold: number,
  point: { x: number; y: number },
): GizmoHit | null {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (tool === 'rotate') {
    return Math.abs(Math.hypot(dx, dy) - ringRadius) <= threshold ? { tool: 'rotate' } : null;
  }
  const distToHandle = (axis: { x: number; y: number }): number => {
    const t = Math.max(0, Math.min(handleLength, dx * axis.x + dy * axis.y));
    return Math.hypot(dx - axis.x * t, dy - axis.y * t);
  };
  const dX = distToHandle(axisX);
  const dY = distToHandle(axisY);
  if (dX > threshold && dY > threshold) return null;
  return { tool: 'axis', axis: dX <= dY ? 'x' : 'y' };
}

/** World-space displacement of `(dx,dy)` projected onto one frame axis. */
export function projectWorld(
  dx: number,
  dy: number,
  frame: GizmoFrame,
  axis: 'x' | 'y',
): { x: number; y: number } {
  const v = axis === 'x' ? frame.axisX : frame.axisY;
  const amount = dx * v.x + dy * v.y;
  return { x: v.x * amount, y: v.y * amount };
}

/** Signed scalar: `(dx,dy)` projected onto a unit axis vector. */
export function projectScreen(dx: number, dy: number, axis: { x: number; y: number }): number {
  return dx * axis.x + dy * axis.y;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && pnpm --filter @spine-editor/editor test -- test/gizmo.test.ts`
Expected: PASS (11 tests). This is the first Vitest suite in the editor package — confirm the command runs at all (not just `--passWithNoTests`).

- [ ] **Step 5: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/viewport/gizmo.ts packages/editor/test/gizmo.test.ts
cd .. && git add client/packages/editor/src/viewport/gizmo.ts client/packages/editor/test/gizmo.test.ts
git commit -m "$(cat <<'EOF'
P23: gizmo.ts — pure frame/hit-test/axis-projection math for the transform gizmo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Bone gizmo — draw + hit-test + drag + commit

**Files:**

- Modify: `client/packages/editor/src/viewport/renderer.ts`
- Modify: `client/packages/editor/src/components/Viewport.tsx`

**Interfaces:**

- Consumes: everything from Task 8's `gizmo.ts` (`computeFrame`, `frameToScreen`, `hitTestGizmo`, `projectWorld`, `projectScreen`, the `GIZMO_*` constants).
- Produces: `RenderInput.gizmo?: {tool, frame}` (drives drawing); extends the existing `translate`/`scale`/`shear` `DragState` variants with optional `axisLock`/`frame` fields (consumed by Task 10's parallel attachment variant for a consistent pattern, though Task 10 adds its own separate variant).

- [ ] **Step 1: Add a `gizmo` field to `RenderInput` and a `drawGizmo` method**

In `client/packages/editor/src/viewport/renderer.ts`, add the import for `gizmo.ts`'s exports at the top (alongside the existing `@spine-editor/core` import block):

```ts
import { GIZMO_HANDLE_PX, GIZMO_RING_PX, GIZMO_SCALE_BOX_PX, type GizmoFrame } from './gizmo.js';
```

Add a field to `RenderInput` (right after the `showRulers?: boolean;` field added in Task 5):

```ts
  /** Transform gizmo to draw at a bone/attachment origin (setup or animate mode for bones; setup-only for attachments — the caller decides). */
  gizmo?: { tool: 'translate' | 'rotate' | 'scale' | 'shear'; frame: GizmoFrame };
```

Add the `drawGizmo` method right after `drawSelectionBox` (added in Task 3, before `drawBones`):

```ts
  /** Draws the active transform gizmo's handles at `input.gizmo.frame.origin`. */
  private drawGizmo(gizmo: NonNullable<RenderInput['gizmo']>): void {
    const g = this.overlayLayer;
    const { tool, frame } = gizmo;
    const handleLen = GIZMO_HANDLE_PX / this.zoom;
    const ringR = GIZMO_RING_PX / this.zoom;
    const RED = 0xe0524a;
    const GREEN = 0x5ac25a;
    const o = frame.origin;
    if (tool === 'rotate') {
      g.circle(o.x, o.y, ringR).stroke({ width: 2 / this.zoom, color: RED, alpha: 0.9 });
      return;
    }
    const drawAxis = (axis: { x: number; y: number }, color: number) => {
      const ex = o.x + axis.x * handleLen;
      const ey = o.y + axis.y * handleLen;
      g.moveTo(o.x, o.y).lineTo(ex, ey).stroke({ width: 2 / this.zoom, color, alpha: 0.9 });
      if (tool === 'scale') {
        const box = GIZMO_SCALE_BOX_PX / this.zoom;
        g.rect(ex - box / 2, ey - box / 2, box, box).fill({ color, alpha: 0.9 });
      } else {
        // Simple arrowhead: two short strokes back from the tip.
        const backX = o.x + axis.x * (handleLen - 8 / this.zoom);
        const backY = o.y + axis.y * (handleLen - 8 / this.zoom);
        const nx = -axis.y * (4 / this.zoom);
        const ny = axis.x * (4 / this.zoom);
        g.poly([ex, ey, backX + nx, backY + ny, backX - nx, backY - ny]).fill({ color, alpha: 0.9 });
      }
    };
    if (tool === 'translate' || tool === 'scale') {
      drawAxis(frame.axisX, RED);
      drawAxis(frame.axisY, GREEN);
    } else {
      // Shear: a plain Y arrow plus an X line skewed by the bone's own shear (visual hint only).
      drawAxis(frame.axisY, GREEN);
      const ex = o.x + frame.axisX.x * handleLen;
      const ey = o.y + frame.axisX.y * handleLen;
      g.moveTo(o.x, o.y).lineTo(ex, ey).stroke({ width: 2 / this.zoom, color: RED, alpha: 0.9 });
    }
  }
```

Call it from `render()`, right after the `if (input.showRulers) this.drawRulers();` line added in Task 5:

```ts
    if (input.showRulers) this.drawRulers();
    if (input.gizmo) this.drawGizmo(input.gizmo);
```

- [ ] **Step 2: Extend the `translate`/`scale`/`shear` `DragState` variants with `axisLock`/`frame`**

In `client/packages/editor/src/components/Viewport.tsx`, add the import from `gizmo.ts`:

```ts
import {
  GIZMO_HANDLE_PX,
  GIZMO_HIT_PX,
  GIZMO_RING_PX,
  computeFrame,
  frameToScreen,
  hitTestGizmo,
  projectScreen,
  projectWorld,
  type GizmoFrame,
} from '../viewport/gizmo.js';
```

Change the `DragState` type (lines 74-119) — add `axisLock`/`frame` to `translate`, `scale`, `shear`:

```ts
type DragState =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'vertex'; index: number }
  | { kind: 'paint' }
  | {
      kind: 'marquee';
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      additive: boolean;
    }
  | {
      kind: 'translate';
      bones: string[];
      startWorld: { x: number; y: number };
      startLocals: Map<string, { x: number; y: number }>;
      invParents: Map<string, Mat2D>;
      /** Set when a gizmo handle (not the bone body) was grabbed — locks the delta to one frame axis. */
      axisLock?: 'x' | 'y';
      frame?: GizmoFrame;
    }
  | {
      kind: 'rotate';
      bones: string[];
      origin: { x: number; y: number };
      startAngle: number;
      startRotations: Map<string, number>;
    }
  | {
      kind: 'scale';
      bones: string[];
      startX: number;
      startY: number;
      startScales: Map<string, { x: number; y: number }>;
      axisLock?: 'x' | 'y';
      frame?: GizmoFrame;
    }
  | {
      kind: 'shear';
      bones: string[];
      startX: number;
      startY: number;
      startShears: Map<string, { x: number; y: number }>;
      axisLock?: 'x' | 'y';
      frame?: GizmoFrame;
    }
  | {
      kind: 'create';
      invParent: Mat2D;
      start: { x: number; y: number };
      temp: BoneData;
    }
  | {
      kind: 'attachment';
      slotName: string;
      attachmentName: string;
      tool: 'translate' | 'rotate' | 'scale';
      axisLock?: 'x' | 'y';
      frame: GizmoFrame;
      startAtt: { x: number; y: number; rotation: number; scaleX: number; scaleY: number };
      startWorld: { x: number; y: number };
      startScreen: { x: number; y: number };
      startAngle: number;
    };
```

(The `attachment` variant is introduced here for type completeness but only *constructed* in Task 10 — leaving it unused until then is fine since it's behind a discriminated union the compiler won't require handling yet outside of exhaustive switches; Task 10 adds the `onPointerDown`/`onPointerMove`/`onPointerUp` branches that construct/consume it.)

- [ ] **Step 3: Hit-test the bone gizmo before the existing bone-body hit-test**

In `onPointerDown`, inside the `case 'translate': case 'rotate': case 'scale': case 'shear':` block (starting at the original line 529), insert a new branch **before** the existing `const name = hit ?? (primary?.kind === 'bone' ? primary.name : null);` line:

```ts
      case 'translate':
      case 'rotate':
      case 'scale':
      case 'shear': {
        // Gizmo handles take priority over the generic bone-body hit-test: if
        // the primary selection already shows a gizmo for this tool, grabbing
        // a handle locks the drag to that handle instead of picking whichever
        // bone happens to be under the cursor.
        if (primary?.kind === 'bone') {
          const m = r.getBoneWorld(primary.name);
          if (m) {
            const parentName = state.doc.findBone(primary.name)?.parent ?? null;
            const parentWorld = parentName ? r.getBoneWorld(parentName) : undefined;
            const frame = computeFrame(state.axesMode, m, parentWorld);
            const screen = frameToScreen(frame, (x, y) => r.worldToScreen(x, y));
            const gizmoHit = hitTestGizmo(
              state.tool,
              screen.origin,
              screen.axisX,
              screen.axisY,
              GIZMO_HANDLE_PX,
              GIZMO_RING_PX,
              GIZMO_HIT_PX,
              p,
            );
            if (gizmoHit) {
              const activeBones = state.selection
                .filter((s): s is SelectionItem & { kind: 'bone' } => s.kind === 'bone')
                .map((s) => s.name);
              const bones = activeBones.length > 0 ? activeBones : [primary.name];
              if (state.tool === 'translate' && gizmoHit.tool === 'axis') {
                const startLocals = new Map<string, { x: number; y: number }>();
                const invParents = new Map<string, Mat2D>();
                for (const boneName of bones) {
                  const bone = base.find((b) => b.name === boneName);
                  if (!bone) continue;
                  const pw = bone.parent !== null ? r.getBoneWorld(bone.parent) : undefined;
                  startLocals.set(boneName, { x: bone.x, y: bone.y });
                  invParents.set(boneName, invertMat(pw ?? IDENTITY));
                }
                dragRef.current = {
                  kind: 'translate',
                  bones: [...startLocals.keys()],
                  startWorld: world,
                  startLocals,
                  invParents,
                  axisLock: gizmoHit.axis,
                  frame,
                };
                return;
              }
              if (state.tool === 'scale' && gizmoHit.tool === 'axis') {
                const startScales = new Map<string, { x: number; y: number }>();
                for (const boneName of bones) {
                  const bone = base.find((b) => b.name === boneName);
                  if (bone) startScales.set(boneName, { x: bone.scaleX, y: bone.scaleY });
                }
                dragRef.current = {
                  kind: 'scale',
                  bones: [...startScales.keys()],
                  startX: p.x,
                  startY: p.y,
                  startScales,
                  axisLock: gizmoHit.axis,
                  frame,
                };
                return;
              }
              if (state.tool === 'shear' && gizmoHit.tool === 'axis') {
                const startShears = new Map<string, { x: number; y: number }>();
                for (const boneName of bones) {
                  const bone = base.find((b) => b.name === boneName);
                  if (bone) startShears.set(boneName, { x: bone.shearX, y: bone.shearY });
                }
                dragRef.current = {
                  kind: 'shear',
                  bones: [...startShears.keys()],
                  startX: p.x,
                  startY: p.y,
                  startShears,
                  axisLock: gizmoHit.axis,
                  frame,
                };
                return;
              }
              if (state.tool === 'rotate' && gizmoHit.tool === 'rotate') {
                const startRotations = new Map<string, number>();
                for (const boneName of bones) {
                  const bone = base.find((b) => b.name === boneName);
                  if (bone) startRotations.set(boneName, bone.rotation);
                }
                dragRef.current = {
                  kind: 'rotate',
                  bones: [...startRotations.keys()],
                  origin: frame.origin,
                  startAngle: Math.atan2(world.y - frame.origin.y, world.x - frame.origin.x),
                  startRotations,
                };
                return;
              }
            }
          }
        }

        const name = hit ?? (primary?.kind === 'bone' ? primary.name : null);
        if (!name) return;
```

(Everything from `const name = hit ?? ...` onward through the end of this `case` block stays **exactly as it is today** — this insertion only adds a new early-return path above the existing code, it does not modify it.)

- [ ] **Step 4: Apply the axis lock in `onPointerMove`**

In `onPointerMove`, the `translate`/`scale`/`shear` branches (originally lines 672-733) change as follows. Replace the `if (drag.kind === 'translate') { ... }` block:

```ts
    if (drag.kind === 'translate') {
      let wx = world.x - drag.startWorld.x;
      let wy = world.y - drag.startWorld.y;
      if (drag.axisLock && drag.frame) {
        const proj = projectWorld(wx, wy, drag.frame, drag.axisLock);
        wx = proj.x;
        wy = proj.y;
      } else if (e.shiftKey) {
        // Shift constrains the drag to the dominant axis of the chosen frame
        // (Local = bone axes, Parent = parent axes, World = screen axes).
        const s = useEditor.getState();
        let ax = { x: 1, y: 0 };
        let ay = { x: 0, y: 1 };
        if (s.axesMode !== 'world') {
          const ref =
            s.axesMode === 'local'
              ? drag.bones[0]!
              : (s.doc.findBone(drag.bones[0]!)?.parent ?? null);
          const m = ref ? r.getBoneWorld(ref) : undefined;
          if (m) {
            const lx = Math.hypot(m.a, m.b) || 1;
            const ly = Math.hypot(m.c, m.d) || 1;
            ax = { x: m.a / lx, y: m.b / lx };
            ay = { x: m.c / ly, y: m.d / ly };
          }
        }
        const dot = (v: { x: number; y: number }) => wx * v.x + wy * v.y;
        const px = dot(ax);
        const py = dot(ay);
        if (Math.abs(px) >= Math.abs(py)) {
          wx = ax.x * px;
          wy = ax.y * px;
        } else {
          wx = ay.x * py;
          wy = ay.y * py;
        }
      }
      overrideRef.current = base.map((b) => {
        const start = drag.startLocals.get(b.name);
        const inv = drag.invParents.get(b.name);
        if (!start || !inv) return b;
        const d = applyLinear(inv, wx, wy);
        return { ...b, x: start.x + d.x, y: start.y + d.y };
      });
    } else if (drag.kind === 'rotate') {
```

(The Shift-constrain branch is **untouched** — it's simply now the `else if` case when no `axisLock` is set, preserving byte-identical behavior for non-gizmo drags.)

Replace the `else if (drag.kind === 'scale') { ... }` block:

```ts
    } else if (drag.kind === 'scale') {
      // Horizontal drag scales X, vertical scales Y (up = grow); 120px = ×2.
      let fx = 1 + (p.x - drag.startX) / 120;
      let fy = 1 + (drag.startY - p.y) / 120;
      if (drag.axisLock && drag.frame) {
        const screen = frameToScreen(drag.frame, (x, y) => r.worldToScreen(x, y));
        const axis = drag.axisLock === 'x' ? screen.axisX : screen.axisY;
        const amount = projectScreen(p.x - drag.startX, p.y - drag.startY, axis);
        const f = 1 + amount / 120;
        fx = drag.axisLock === 'x' ? f : 1;
        fy = drag.axisLock === 'y' ? f : 1;
      }
      overrideRef.current = base.map((b) => {
        const s0 = drag.startScales.get(b.name);
        return s0 ? { ...b, scaleX: s0.x * fx, scaleY: s0.y * fy } : b;
      });
    } else if (drag.kind === 'shear') {
```

Replace the `else if (drag.kind === 'shear') { ... }` block:

```ts
    } else if (drag.kind === 'shear') {
      let dx = (p.x - drag.startX) / 2;
      let dy = (drag.startY - p.y) / 2;
      if (drag.axisLock && drag.frame) {
        const screen = frameToScreen(drag.frame, (x, y) => r.worldToScreen(x, y));
        const axis = drag.axisLock === 'x' ? screen.axisX : screen.axisY;
        const amount = projectScreen(p.x - drag.startX, p.y - drag.startY, axis) / 2;
        dx = drag.axisLock === 'x' ? amount : 0;
        dy = drag.axisLock === 'y' ? amount : 0;
      }
      overrideRef.current = base.map((b) => {
        const s0 = drag.startShears.get(b.name);
        return s0 ? { ...b, shearX: s0.x + dx, shearY: s0.y + dy } : b;
      });
    } else {
```

- [ ] **Step 5: Feed the gizmo into `buildRenderInput`**

In `buildRenderInput()`, add a computed `gizmo` field. Add this helper function right before `buildRenderInput` (after `weightColorMap`, before `type DragState`... actually place it as a local function inside the component, right after `editWorldPositions` — anywhere before `buildRenderInput`'s definition works; simplest is directly above `function buildRenderInput()`):

```ts
  /** Gizmo to draw for the current primary selection + tool, or undefined. */
  function currentGizmo(): RenderInput['gizmo'] {
    const state = useEditor.getState();
    const r = rendererRef.current;
    if (!r) return undefined;
    if (!(state.tool === 'translate' || state.tool === 'rotate' || state.tool === 'scale' || state.tool === 'shear')) {
      return undefined;
    }
    const primary = primarySelection(state.selection);
    if (primary?.kind !== 'bone') return undefined;
    const m = r.getBoneWorld(primary.name);
    if (!m) return undefined;
    const parentName = state.doc.findBone(primary.name)?.parent ?? null;
    const parentWorld = parentName ? r.getBoneWorld(parentName) : undefined;
    return { tool: state.tool, frame: computeFrame(state.axesMode, m, parentWorld) };
  }
```

In `buildRenderInput()`'s returned object, add (right after `hiddenSlots: ...` at the end, before the closing `};`):

```ts
      hiddenSlots: state.hiddenSlots.length ? new Set(state.hiddenSlots) : undefined,
      gizmo: currentGizmo(),
    };
  }
```

- [ ] **Step 6: Add `axesMode`/`tool` to the redraw dependency list**

The `useEffect(redraw, [...])` array (from Task 5) needs `tool` added so the gizmo redraws when the active tool changes (bone selection is already covered by `selection`, and `axesMode` changes are rare enough that a manual redraw trigger isn't critical — but `tool` changes on every click of the tool cluster, so it must be tracked):

```ts
  const tool = useEditor((s) => s.tool);
```

Add this near the other `useEditor((s) => s...)` reads (e.g. right after `const selection = useEditor((s) => s.selection);`), and add `tool` to the dependency array from Task 5:

```ts
  useEffect(redraw, [
    revision,
    selection,
    assets,
    mode,
    meshEdit,
    activeSkin,
    animCurrent,
    animTime,
    animGhost,
    ghostConfig,
    viewFilters,
    hiddenBones,
    hiddenSlots,
    posePreview,
    showRulers,
    tool,
  ]);
```

- [ ] **Step 7: Verify**

Run `pnpm typecheck` (both `core` — unaffected — and `editor`). Run `pnpm --filter @spine-editor/editor test` (gizmo.ts/bounds.ts tests still green). Start the dev server and manually walk through:
  - Select a bone, pick Translate — confirm a red (X) and green (Y) arrow appear at its origin.
  - Drag the red arrow — confirm the bone moves along its local X axis only (Y stays fixed); drag the green arrow — Y only.
  - Drag the bone body away from both arrows — confirm free 2-axis movement still works exactly as before.
  - Repeat for Rotate (ring — dragging anywhere still rotates freely, same as today), Scale (arrows with small square tips — locked-axis scale vs free 2-axis scale off-handle), Shear (green Y arrow + red X line).
  - Switch `axesMode` (hotkey X, per Phase 21) between local/parent/world and confirm the arrows visually re-orient (world = always screen-aligned; local = along the bone's own rotation; parent = along the parent bone's rotation).
  - Multi-select 2+ bones, grab a handle at the primary (last-selected) bone's gizmo — confirm both bones move/scale/shear together, same as the existing free-drag group behavior.
  - In Animate mode with Auto Key on, drag a handle — confirm a keyframe is created (existing auto-key path, unchanged); with Auto Key off, confirm transient posing (existing behavior, unchanged).

- [ ] **Step 8: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/viewport/renderer.ts packages/editor/src/components/Viewport.tsx
cd .. && git add client/packages/editor/src/viewport/renderer.ts client/packages/editor/src/components/Viewport.tsx
git commit -m "$(cat <<'EOF'
P23: interactive bone gizmo — axis-locked Translate/Scale/Shear handles + Rotate ring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Attachment gizmo — draw + hit-test + drag + commit

**Files:**

- Modify: `client/packages/editor/src/viewport/renderer.ts`
- Modify: `client/packages/editor/src/components/Viewport.tsx`

**Interfaces:**

- Consumes: `SetAttachmentTransform` (Task 7), `gizmo.ts` exports (Task 8), the `gizmo` `RenderInput` field + `drawGizmo` (Task 9).
- Produces: `RenderInput.attachmentOverride?: {slot, attachment, patch}` (live-preview during drag, mirroring `bonesOverride`); the `attachment` `DragState` variant (declared in Task 9, constructed here).

- [ ] **Step 1: Add `attachmentOverride` to `RenderInput` plus a shared `withOverride` helper**

In `client/packages/editor/src/viewport/renderer.ts`, add a field to `RenderInput` (right after the `gizmo?: ...` field from Task 9):

```ts
  /** Live-preview patch for a region/point attachment during a gizmo drag (setup mode only). */
  attachmentOverride?: {
    slot: string;
    attachment: string;
    patch: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number };
  };
```

Add a small helper method to `SceneRenderer`, right after `getFullPose`/`frameBounds` (added in Task 6):

```ts
  /** Applies a live gizmo-drag patch to one region/point attachment, for preview rendering. */
  private withOverride(
    att: SpineAttachment,
    slotName: string,
    attachmentName: string,
    override: RenderInput['attachmentOverride'],
  ): SpineAttachment {
    return override && override.slot === slotName && override.attachment === attachmentName
      ? ({ ...att, ...override.patch } as SpineAttachment)
      : att;
  }
```

In `render()`'s main sprite-drawing loop, the region branch currently reads (this is the code already in the file, unchanged by any earlier task):

```ts
      if (att.type !== undefined && att.type !== 'region') {
        endClipAfter(slot.name);
        continue;
      }
      const region = att as SpineRegionAttachment;
```

Replace it with:

```ts
      if (att.type !== undefined && att.type !== 'region') {
        endClipAfter(slot.name);
        continue;
      }
      const region = this.withOverride(
        att,
        slot.name,
        attachmentName,
        input.attachmentOverride,
      ) as SpineRegionAttachment;
```

(Nothing else in `render()`'s clipping/mesh branches changes — `SetAttachmentTransform`/the gizmo only ever patches `region`/`point` attachments, and points are never drawn as sprites in this loop, so no other branch here needs the override.)

- [ ] **Step 1b: Apply the same override in `drawOverlays` (point marker + selection box)**

In `drawOverlays` (extended by Task 3), the loop currently starts:

```ts
      for (const [name, att] of Object.entries(bySlot)) {
        const isActive = slot.attachment === name;
        const isSelected = isActive && input.selection.some((s) => s.kind === 'slot' && s.name === slot.name);
        if (isSelected) {
          this.drawSelectionBox(att, boneWorld, data.bones, pose);
        }
        if (att.type === 'point') {
```

Replace it with:

```ts
      for (const [name, rawAtt] of Object.entries(bySlot)) {
        const isActive = slot.attachment === name;
        const att = this.withOverride(rawAtt, slot.name, name, input.attachmentOverride);
        const isSelected = isActive && input.selection.some((s) => s.kind === 'slot' && s.name === slot.name);
        if (isSelected) {
          this.drawSelectionBox(att, boneWorld, data.bones, pose);
        }
        if (att.type === 'point') {
```

(This makes the point marker itself — and the Task 3 selection box — track the live drag preview for a point attachment, the same way the region sprite now does per Step 1. `rawAtt`/`att` afterward are used exactly as Task 3 already wrote them; only the loop header and the new `att =` line change.)

- [ ] **Step 2: Extend `drawGizmo`'s caller so attachment gizmos draw too**

The `input.gizmo` field (Task 9) already carries `{tool, frame}` generically — it doesn't need to know whether the frame came from a bone or an attachment. No changes needed to `drawGizmo` itself; Task 9's `RenderInput.gizmo` and `drawGizmo` are reused as-is. What changes is **who populates** `input.gizmo` — that's `Viewport.tsx`'s `currentGizmo()`, extended below.

- [ ] **Step 3: Extend `currentGizmo()` to cover a selected attachment, tracking the live drag**

In `client/packages/editor/src/components/Viewport.tsx`, replace `currentGizmo()` (from Task 9):

```ts
  /** Gizmo to draw for the current primary selection + tool, or undefined. */
  function currentGizmo(): RenderInput['gizmo'] {
    const state = useEditor.getState();
    const r = rendererRef.current;
    if (!r) return undefined;
    if (!(state.tool === 'translate' || state.tool === 'rotate' || state.tool === 'scale' || state.tool === 'shear')) {
      return undefined;
    }
    const primary = primarySelection(state.selection);
    if (primary?.kind === 'bone') {
      const m = r.getBoneWorld(primary.name);
      if (!m) return undefined;
      const parentName = state.doc.findBone(primary.name)?.parent ?? null;
      const parentWorld = parentName ? r.getBoneWorld(parentName) : undefined;
      return { tool: state.tool, frame: computeFrame(state.axesMode, m, parentWorld) };
    }
    if (primary?.kind === 'slot' && state.mode === 'setup' && state.tool !== 'shear') {
      const frame = attachmentFrame(state, r, primary.name);
      if (!frame) return undefined;
      if (state.tool === 'scale' && frame.attType !== 'region') return undefined;
      return { tool: state.tool, frame: frame.frame };
    }
    return undefined;
  }

  /**
   * World frame for a selected slot's active region/point attachment, or
   * null if unsupported. Reads `attachmentOverrideRef` (declared right after
   * this function) so the frame tracks the live drag instead of freezing at
   * the pre-drag position — the same way a bone gizmo's frame already
   * tracks `bonesOverride` via `r.getBoneWorld`/`lastPose`.
   */
  function attachmentFrame(
    state: ReturnType<typeof useEditor.getState>,
    r: SceneRenderer,
    slotName: string,
  ): { frame: GizmoFrame; attType: 'region' | 'point' } | null {
    const slot = state.doc.findSlot(slotName);
    if (!slot?.attachment) return null;
    const stored = state.doc.data.skins.find((s) => s.name === 'default')?.attachments?.[slotName]?.[
      slot.attachment
    ];
    if (!stored || (stored.type !== undefined && stored.type !== 'region' && stored.type !== 'point')) {
      return null;
    }
    const override = attachmentOverrideRef.current;
    const att =
      override && override.slot === slotName && override.attachment === slot.attachment
        ? { ...stored, ...override.patch }
        : stored;
    const boneWorld = r.getBoneWorld(slot.bone);
    if (!boneWorld) return null;
    const rot = ((att.rotation ?? 0) * Math.PI) / 180;
    const attLocal: Mat2D = {
      a: Math.cos(rot),
      b: -Math.sin(rot),
      c: Math.sin(rot),
      d: Math.cos(rot),
      tx: att.x ?? 0,
      ty: att.y ?? 0,
    };
    const attWorld = mulMat(boneWorld, attLocal);
    return {
      frame: computeFrame(state.axesMode, attWorld, boneWorld),
      attType: stored.type === 'point' ? 'point' : 'region',
    };
  }
```

Add the `attachmentOverrideRef` this function reads, right after the existing `const editVertsRef = useRef<number[] | null>(null);` line near the top of the component:

```ts
  /** Uncommitted region/point attachment transform patch during a gizmo drag. */
  const attachmentOverrideRef = useRef<RenderInput['attachmentOverride']>(undefined);
```

Add `mulMat` to the existing `@spine-editor/core` import list at the top of `Viewport.tsx` (it is not currently imported there — check the import block from lines 1-36 and add `mulMat` alongside `mulMat`'s siblings like `invertMat`/`applyMat`):

```ts
  invertMat,
  isWeightedVertices,
  meshVertexCount,
  mulMat,
  removeMeshVertex,
```

(insert `mulMat,` alphabetically between `meshVertexCount,` and `removeMeshVertex,`.)

- [ ] **Step 4: Hit-test the attachment gizmo in `onPointerDown`**

In the same `case 'translate': case 'rotate': case 'scale': case 'shear':` block from Task 9, add an `else if` branch after the `if (primary?.kind === 'bone') { ... }` block (which now falls through to the pre-existing `const name = hit ?? ...` line when no bone-gizmo handle was hit):

```ts
        } else if (primary?.kind === 'slot' && state.mode === 'setup' && state.tool !== 'shear') {
          const info = attachmentFrame(state, r, primary.name);
          if (info && !(state.tool === 'scale' && info.attType !== 'region')) {
            const screen = frameToScreen(info.frame, (x, y) => r.worldToScreen(x, y));
            const gizmoHit = hitTestGizmo(
              state.tool,
              screen.origin,
              screen.axisX,
              screen.axisY,
              GIZMO_HANDLE_PX,
              GIZMO_RING_PX,
              GIZMO_HIT_PX,
              p,
            );
            if (gizmoHit) {
              const slot = state.doc.findSlot(primary.name)!;
              const att = state.doc.data.skins.find((s) => s.name === 'default')?.attachments?.[
                primary.name
              ]?.[slot.attachment!] as {
                x?: number;
                y?: number;
                rotation?: number;
                scaleX?: number;
                scaleY?: number;
              };
              const startAtt = {
                x: att.x ?? 0,
                y: att.y ?? 0,
                rotation: att.rotation ?? 0,
                scaleX: att.scaleX ?? 1,
                scaleY: att.scaleY ?? 1,
              };
              if (state.tool === 'rotate' && gizmoHit.tool === 'rotate') {
                dragRef.current = {
                  kind: 'attachment',
                  slotName: primary.name,
                  attachmentName: slot.attachment!,
                  tool: 'rotate',
                  frame: info.frame,
                  startAtt,
                  startWorld: world,
                  startScreen: p,
                  startAngle: Math.atan2(world.y - info.frame.origin.y, world.x - info.frame.origin.x),
                };
                return;
              }
              if ((state.tool === 'translate' || state.tool === 'scale') && gizmoHit.tool === 'axis') {
                dragRef.current = {
                  kind: 'attachment',
                  slotName: primary.name,
                  attachmentName: slot.attachment!,
                  tool: state.tool,
                  axisLock: gizmoHit.axis,
                  frame: info.frame,
                  startAtt,
                  startWorld: world,
                  startScreen: p,
                  startAngle: 0,
                };
                return;
              }
            }
          }
        }
```

(Place this `else if` immediately after the closing `}` of the `if (primary?.kind === 'bone') { ... }` block added in Task 9, still before the pre-existing `const name = hit ?? ...` line.)

- [ ] **Step 5: Handle `onPointerMove` for `drag.kind === 'attachment'`**

Add a new branch in `onPointerMove`, right after the `else if (drag.kind === 'shear') { ... }` block from Task 9 (before its final `else { ... create ... }`):

```ts
    } else if (drag.kind === 'attachment') {
      const patch: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number } = {};
      if (drag.tool === 'rotate') {
        const angle = Math.atan2(world.y - drag.frame.origin.y, world.x - drag.frame.origin.x);
        patch.rotation = drag.startAtt.rotation + (angle - drag.startAngle) * RAD_DEG;
      } else if (drag.tool === 'translate') {
        let wx = world.x - drag.startWorld.x;
        let wy = world.y - drag.startWorld.y;
        if (drag.axisLock) {
          const proj = projectWorld(wx, wy, drag.frame, drag.axisLock);
          wx = proj.x;
          wy = proj.y;
        }
        patch.x = round2(drag.startAtt.x + wx);
        patch.y = round2(drag.startAtt.y + wy);
      } else {
        // scale
        const screen = frameToScreen(drag.frame, (x, y) => r.worldToScreen(x, y));
        const axis = drag.axisLock === 'x' ? screen.axisX : screen.axisY;
        const amount = drag.axisLock ? projectScreen(p.x - drag.startScreen.x, p.y - drag.startScreen.y, axis) : 0;
        const f = 1 + amount / 120;
        patch.scaleX = drag.axisLock === 'x' ? round2(drag.startAtt.scaleX * f) : drag.startAtt.scaleX;
        patch.scaleY = drag.axisLock === 'y' ? round2(drag.startAtt.scaleY * f) : drag.startAtt.scaleY;
      }
      attachmentOverrideRef.current = { slot: drag.slotName, attachment: drag.attachmentName, patch };
      redraw();
      return;
    } else {
```

(`attachmentOverrideRef` was already declared in Step 3, alongside `attachmentFrame` — no new ref needed here.)

Wire it into `buildRenderInput()` — add right after the `gizmo: currentGizmo(),` line from Task 9:

```ts
      gizmo: currentGizmo(),
      attachmentOverride: attachmentOverrideRef.current,
    };
  }
```

- [ ] **Step 6: Commit the attachment transform on `onPointerUp`**

In `onPointerUp`, the function starts by reading `drag`/`override` and clearing refs (original lines 745-749). Add `attachmentOverrideRef` to that same clear, and add a commit branch. Replace the top of `onPointerUp`:

```ts
  function onPointerUp() {
    const drag = dragRef.current;
    const override = overrideRef.current;
    const attachmentOverride = attachmentOverrideRef.current;
    dragRef.current = null;
    overrideRef.current = undefined;
    attachmentOverrideRef.current = undefined;
    if (!drag || drag.kind === 'pan') return;
    const state = useEditor.getState();
    if (drag.kind === 'attachment') {
      if (attachmentOverride) {
        state.execute(
          new SetAttachmentTransform(
            'default',
            attachmentOverride.slot,
            attachmentOverride.attachment,
            attachmentOverride.patch,
          ),
        );
      }
      redraw();
      return;
    }
    const animating = state.mode === 'animate' && state.anim.current !== null;
```

(Everything below the original `const animating = ...` line stays unchanged — this only adds the new `attachment` branch as an early return before the rest of `onPointerUp`'s existing logic runs.)

Add the `SetAttachmentTransform` import to `Viewport.tsx`'s `@spine-editor/core` import block (alongside `SetBoneTransform`):

```ts
  SetAttachmentTransform,
  SetAttachmentVertices,
  SetBoneTransform,
```

- [ ] **Step 7: Verify**

Run `pnpm typecheck`. Manually, in Setup mode:
  - Select a slot with a region attachment, pick Translate — confirm red/green arrows appear at the attachment's own origin (composed with its bone); drag the red arrow — confirm the region moves along its local X only, and the change persists after release (re-select the slot and check the Properties dock's x/y fields, or re-run `get_project_state`/`export_spine_json` and check the attachment's `x`).
  - Pick Rotate — confirm the ring appears and free-rotate works, committing the attachment's `rotation`.
  - Pick Scale — confirm handles appear (region only; select a point attachment and confirm Scale shows no handles since points have no scaleX/scaleY).
  - Pick Shear — confirm no gizmo appears for an attachment selection (shear is bone-only).
  - Switch to Animate mode — confirm the attachment gizmo disappears entirely (no handles drawn, no drag reacts) even with a slot selected and Translate/Rotate/Scale active.
  - Undo after each attachment gizmo commit — confirm the attachment's values return to their pre-drag state.

- [ ] **Step 8: Commit**

```bash
cd client && pnpm exec prettier --write packages/editor/src/viewport/renderer.ts packages/editor/src/components/Viewport.tsx
cd .. && git add client/packages/editor/src/viewport/renderer.ts client/packages/editor/src/components/Viewport.tsx
git commit -m "$(cat <<'EOF'
P23: interactive attachment gizmo (region/point x/y/rotation/scale, setup mode)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Full verify battery + docs

**Files:**

- Modify: `CLAUDE.md`
- Modify: `PLAN.md` (only if a natural anchor exists for a one-line "post-roadmap polish" note; otherwise CLAUDE.md alone is sufficient — see Step 3).

- [ ] **Step 1: Full local test suite**

From `client/`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all green. `pnpm test` now includes the editor package's first-ever suites (`gizmo.test.ts`, `bounds.test.ts`) alongside core's (176 + 6 new `SetAttachmentTransform` tests = 182) and the existing shared/mcp-server suites (unchanged — 65 tools, no new MCP tool this phase).

- [ ] **Step 2: E2E battery**

Follow the project's `verify` skill (`.claude/skills/verify/SKILL.md`) exactly: build, `vite preview` on :4173, run `e2e/smoke.mjs` and `e2e/anim.mjs` (expect `"issues": []` from both — these exercise Setup/Animate mode general flows and will incidentally exercise the new bone rendering/selection code paths), kill :8017, run `client/packages/mcp-server/e2e/bridge.mjs` (expect `toolCount: 65` — unchanged; all existing flags — `setIkWorks`, `meshEditWorks`, `audioWorks`, `slotColorWorks`, `psdImportWorks`, `skelExportWorks`, `rigFromPartsWorks`, `presetWalkWorks` — still `true`, confirming this phase didn't regress any prior-phase MCP flow), then `e2e/chat.mjs` against a server started with `SPINE_SERVER_CHAT_FAKE=1 SPINE_SERVER_SEGMENT_FAKE=1` (expect `chatRigWorks: true`), then `cd server && uv run pytest` (expect the same 60 passed, 2 skipped as before — this phase touches no server code).

Additionally, since this phase changes viewport rendering, take a manual screenshot via the MCP `screenshot_viewport` tool (or the browser directly) of a rigged character with a custom `bone.color` set, in each of the 4 transform tools, to visually sanity-check the gizmo renders as expected — this is the one piece genuinely new to this phase that the existing e2e scripts don't assert on structurally (they check data/state, not pixel appearance).

- [ ] **Step 3: Update CLAUDE.md**

Add a new paragraph after the existing `**Roadmap §8 (Spine parity) HOÀN TẤT — phases 15–22 done.**` line:

```markdown
**Phase 23 done** (post-roadmap UI polish): tree panel expand/collapse
(`collapsedNodes` + chevrons, localStorage-persisted); bone rendering reads
`bone.color` (was hardcoded) with a tighter dart shape and blue (`--accent`)
selection; slot/attachment selection now draws a blue bounding-box outline
(`viewport/renderer.ts` `drawSelectionBox`) plus a tree hover thumbnail
preview (`components/tree/HoverPreview.tsx`); viewport gains a ruler toggle
(`viewport/renderer.ts` `drawRulers`) and a fit-to-content Center button
(`viewport/bounds.ts` `computeSkeletonBounds` + `SceneRenderer.frameBounds`);
and — the core of this phase — a real interactive transform gizmo
(`viewport/gizmo.ts`, framework-free with its own unit tests) giving
Rotate/Translate/Scale/Shear axis-locked handles for both bones (reusing the
existing drag-commit path) and region/point attachments (new core command
`SetAttachmentTransform`, setup-mode only — no MCP tool added, **still 65
tools total**).
```

- [ ] **Step 4: Verify docs render cleanly**

Run `pnpm exec prettier --check CLAUDE.md` (or `--write` if it reformats) from the repo root's `client/` prettier config, or confirm no markdownlint warnings are introduced (avoid lines starting with `+`/`>` per this repo's known Prettier trap).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
P23: e2e verify + docs — UI polish phase complete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
