# Phase 17 — Animate Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The animate-mode bottom dock matches Spine: Graph/Dopesheet tabs with a Spine toolbar (Sync, Filter, Lock, Shift/Offset, Current/Loop Start/End), full transport, colored key ticks with interpolation connectors and summary diamonds, loop-range playback, and true transient posing when Auto Key is off.

**Architecture:** Everything lives in the editor package. Store gains `loopStart/loopEnd` (playback wrap) and `posePreview` (editor-only local overlay merged after `computeAnimatedLocals`). TimelinePanel is restructured: tab state replaces the embedded-graph toggle, one toolbar row hosts the new controls, track rendering gains color classes + per-bone/summary rows + an SVG connector layer. Viewport/bone-edit switch their Auto-Key-off gate to posePreview writes.

**Tech Stack:** React + zustand, SVG track connectors, existing core commands (`TransformBoneKeys` for Offset).

**Spec:** `docs/superpowers/specs/2026-07-11-phase17-animate-dock-design.md`

## Global Constraints

- Branch `claude/phase17-animate-dock`; pnpm from `client/` (shim PATH `/private/tmp/claude-501/-Users-tuananh-Projects-you-spine-editor/6b990f26-97bc-4e20-b105-3db5aab338c5/scratchpad/bin`).
- E2E-critical selectors stay: `.timeline-header button:has-text("New")`, `button:has-text("Play")`/`("Pause")` (keep the text labels), `.track .key`, `.ruler`.
- `loopStart/loopEnd`/`posePreview` are editor-only — never serialized; posePreview never mutates the document.
- Key tick colors: rotate `#7bd47b`, translate `#6fa8dc`, scale `#e06666`, shear `#d5a6bd`, color `#ffd966`, attachment `#e0e0e0`, deform `#b4a7d6`, draworder/event `#f0a252`; multi-type shared frame = white.
- No core changes. Every commit ends with the repo trailer. Per-task cycle: `pnpm typecheck && pnpm --filter @spine-editor/editor build`; e2e battery in the final task.

---

### Task 1: Store — loop range + posePreview

**Files:** Modify `client/packages/editor/src/state/store.ts`

**Interfaces (Produces):**

```ts
// AnimationUiState gains:
loopStart: number | null; // seconds
loopEnd: number | null;
// EditorState gains:
posePreview: Record<string, Partial<Record<'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY', number>>> | null;
setLoopRange(start: number | null, end: number | null): void;
setPosePreview(bone: string, patch: Record<string, number>): void; // merge per bone
clearPosePreview(): void;
```

- [ ] **Step 1:** `AnimationUiState` interface + every `anim: { … }` literal (initial state, `replaceProject`, `setAnimation` if it rebuilds the object) gains `loopStart: null, loopEnd: null`. Add `posePreview: null` to state.
- [ ] **Step 2:** actions:

```ts
  setLoopRange: (start, end) =>
    set((s) => ({ anim: { ...s.anim, loopStart: start, loopEnd: end } })),
  setPosePreview: (bone, patch) =>
    set((s) => ({
      posePreview: { ...(s.posePreview ?? {}), [bone]: { ...(s.posePreview?.[bone] ?? {}), ...patch } },
    })),
  clearPosePreview: () => set({ posePreview: null }),
```

Clear posePreview inside existing actions: `setAnimTime` (`posePreview: null` in its set), `setAnimation` (also reset loopStart/loopEnd to null), `setMode`, and `setAutoKey` when turning ON.

- [ ] **Step 3:** typecheck/build; commit `P17: loop range + posePreview state`.

---

### Task 2: Loop-range playback + Current/Loop fields + transport

**Files:** Modify `client/packages/editor/src/components/TimelinePanel.tsx` (+styles.css)

- [ ] **Step 1: playback wrap** — in the RAF tick effect (lines ~160–184), replace the wrap block:

```ts
const start = s.anim.loopStart ?? 0;
const end = s.anim.loopEnd ?? dur;
let t = s.anim.time + dt * s.anim.speed;
if (t > end) {
  if (s.anim.loop) t = start + ((t - start) % Math.max(end - start, 0.001));
  else {
    s.setAnimTime(end);
    s.setPlaying(false);
    return;
  }
}
```

(NOTE: `setAnimTime` now clears posePreview each frame during playback — that is fine, posePreview is for paused posing; but ensure `setAnimTime`'s clear doesn't allocate when already null: `posePreview: s.posePreview === null ? null : null` → just set null.)

- [ ] **Step 2: fields** — in the header after the time-display span, add:

```tsx
        <label className="tl-field">
          <span>Current</span>
          <input
            type="number"
            value={frame}
            onChange={(e) => useEditor.getState().setAnimTime(Number(e.target.value) / 30)}
          />
        </label>
        <label className="tl-field">
          <span>Loop Start</span>
          <input
            type="number"
            value={anim.loopStart !== null ? Math.round(anim.loopStart * 30) : ''}
            placeholder="—"
            onChange={(e) =>
              useEditor.getState().setLoopRange(
                e.target.value === '' ? null : Number(e.target.value) / 30,
                anim.loopEnd,
              )
            }
          />
        </label>
        <label className="tl-field">
          <span>End</span>
          <input
            type="number"
            value={anim.loopEnd !== null ? Math.round(anim.loopEnd * 30) : ''}
            placeholder="—"
            onChange={(e) =>
              useEditor.getState().setLoopRange(
                anim.loopStart,
                e.target.value === '' ? null : Number(e.target.value) / 30,
              )
            }
          />
        </label>
        {(anim.loopStart !== null || anim.loopEnd !== null) && (
          <button title="Clear loop range" onClick={() => useEditor.getState().setLoopRange(null, null)}>
            ✕
          </button>
        )}
```

- [ ] **Step 3: transport** — around the Play button add ⏮/prev-key/next-key/⏭ (keep Play/Pause + ⏴⏵ step-frame as is):

```tsx
        <button disabled={!anim.current} title="Go to start"
          onClick={() => useEditor.getState().setAnimTime(useEditor.getState().anim.loopStart ?? 0)}>
          ⏮
        </button>
        <button disabled={!anim.current} title="Previous key" onClick={() => jumpToKey(-1)}>◀|</button>
        {/* existing ⏴ Play/Pause ⏵ stay here */}
        <button disabled={!anim.current} title="Next key" onClick={() => jumpToKey(1)}>|▶</button>
        <button disabled={!anim.current} title="Go to end"
          onClick={() => useEditor.getState().setAnimTime(duration)}>
          ⏭
        </button>
```

with helper (place near `deleteSelectedKeys`):

```ts
function jumpToKey(dir: -1 | 1) {
  const times = [...new Set(boneTracks.flatMap((t) => t.keys.map((k) => k.time ?? 0)))].sort(
    (a, b) => a - b,
  );
  const t = useEditor.getState().anim.time;
  const next =
    dir === 1 ? times.find((x) => x > t + 1e-6) : [...times].reverse().find((x) => x < t - 1e-6);
  if (next !== undefined) useEditor.getState().setAnimTime(next);
}
```

- [ ] **Step 4: ruler loop highlight** — inside `.ruler`, first child:

```tsx
{
  anim.loopEnd !== null && (
    <span
      className="loop-range"
      style={{
        left: PAD + (anim.loopStart ?? 0) * pps,
        width: Math.max((anim.loopEnd - (anim.loopStart ?? 0)) * pps, 0),
      }}
    />
  );
}
```

CSS: `.tl-field { display:inline-flex; gap:4px; align-items:center; font-size:11px; } .tl-field input { width:56px; } .loop-range { position:absolute; top:0; bottom:0; background: var(--accent-soft); opacity:0.35; pointer-events:none; }`

- [ ] **Step 5:** typecheck/build; commit `P17: loop-range playback, Current/Loop fields, full transport`.

---

### Task 3: Tabs Graph | Dopesheet + Sync

**Files:** Modify `TimelinePanel.tsx`, `GraphEditor.tsx` (only if its props need the height), `styles.css`

- [ ] **Step 1:** add `const [tab, setTab] = useState<'dopesheet' | 'graph'>('dopesheet');` and `const [sync, setSync] = useState(true);`. REMOVE the `showGraph` state + the `Curve` button's `resizeTimeline` growth hack (keep a `Curve` button that just does `setTab('graph')`).
- [ ] **Step 2:** tab bar as the FIRST row inside the panel (above `.timeline-header`):

```tsx
<div className="tl-tabs">
  <button className={tab === 'graph' ? 'tl-tab active' : 'tl-tab'} onClick={() => setTab('graph')}>
    Graph
  </button>
  <button
    className={tab === 'dopesheet' ? 'tl-tab active' : 'tl-tab'}
    onClick={() => setTab('dopesheet')}
  >
    Dopesheet
  </button>
  <button
    className={sync ? 'tl-sync active' : 'tl-sync'}
    title="Sync graph to dopesheet selection"
    onClick={() => setSync(!sync)}
  >
    Sync
  </button>
</div>
```

- [ ] **Step 3:** render: `tab === 'dopesheet'` shows the existing `.timeline-body`; `tab === 'graph'` shows the GraphEditor block full-height (move the existing `<GraphEditor …/>` invocation; keep its current props). Sync behavior: when `sync` and a key is selected in the dopesheet, the GraphEditor receives that key (it already renders the selected key's curve — confirm the current prop wiring at line ~796 and keep it; when `!sync`, freeze the last key via a `useRef` that only updates when sync is on).
- [ ] **Step 4:** CSS `.tl-tabs { display:flex; gap:2px; padding:2px 8px 0; } .tl-tab { border-radius:4px 4px 0 0; } .tl-tab.active { background: var(--accent-soft); } .tl-sync { margin-left: 12px; }`; typecheck/build + manual check; commit `P17: Graph/Dopesheet tabs with sync toggle`.

---

### Task 4: Toolbar — Filter, Lock, Shift, Offset

**Files:** Modify `TimelinePanel.tsx`, `styles.css`

- [ ] **Step 1: Filter** — `const [typeFilter, setTypeFilter] = useState<Set<string> | null>(null);` (null = all). Dropdown (menu-wrap/dropdown pattern from Toolbar) with checkboxes for `['rotate','translate','scale','shear','color','attachment','deform','draworder','event']`. Where rows are built (`boneTracks` + the draw-order/event track renders), skip rows whose timeline type is filtered out (`typeFilter && !typeFilter.has(type)`).
- [ ] **Step 2: Lock** — `const [locked, setLocked] = useState<string[] | null>(null);` toggle button stores the current row identity list (e.g. `boneTracks.map(t => t.bone + '.' + t.timeline)`); when locked, render exactly those rows (missing ones show empty) and don't add new ones. Minimal honest version: filter `boneTracks` to the locked list.
- [ ] **Step 3: Shift** — number input (frames) + Apply: `commitKeyDrag(frames / 30)` on the current selection (that function already validates + executes; check its signature at line ~279 — it takes a seconds delta).
- [ ] **Step 4: Offset** — number input (frames) + Apply over ALL keys of the current animation: import `TransformBoneKeys` (already used by `shift_keys` op) and execute `new TransformBoneKeys(anim.current, { offset: frames / 30 })` — check the constructor shape in `core/src/commands/animations.ts` (mirror the `shift_keys` op case in `bridge/ops.ts`) and pass exactly what it expects; surface errors via the existing `execute` path. Tooltip: 'Shift every bone key; fails on collisions'.
- [ ] **Step 5:** place Filter/Lock/Shift/Offset in the `.timeline-header` after the GIF button, styles as needed; typecheck/build; commit `P17: dopesheet toolbar — filter, lock, shift, offset`.

---

### Task 5: Spine key ticks — colors, summary rows, connectors

**Files:** Modify `TimelinePanel.tsx`, `styles.css`

- [ ] **Step 1: color classes** — the bone track `.key` span gains `key-${track.timeline}`; the draw-order and event track keys gain `key-draworder` / `key-event` (find their render blocks after boneTracks). CSS:

```css
.key.key-rotate {
  background: #7bd47b;
}
.key.key-translate {
  background: #6fa8dc;
}
.key.key-scale {
  background: #e06666;
}
.key.key-shear {
  background: #d5a6bd;
}
.key.key-color {
  background: #ffd966;
}
.key.key-attachment {
  background: #e0e0e0;
}
.key.key-deform {
  background: #b4a7d6;
}
.key.key-draworder,
.key.key-event {
  background: #f0a252;
}
.key.key-multi {
  background: #ffffff;
}
```

(Check the current `.key` rule for shape — make ticks Spine-like: `width: 3px; height: 70%; border-radius: 1px;` while keeping the 10px hit area via a transparent border or `::after`; preserve `.key.selected` visibility.)

- [ ] **Step 2: per-bone summary rows** — group `boneTracks` by bone; before each bone's timeline rows render a `.track.bone-summary` row labeled with the bone name whose keys are the union of the bone's key times; a time with ≥2 distinct timeline types gets `key-multi`, else the single type's class. Clicking a summary key selects all refs at that time for that bone (reuse `selectKey` semantics: build the KeyRef list and set selection directly).
- [ ] **Step 3: animation summary diamonds** — directly under `.ruler`, a `.summary-row` with a `.summary-diamond` (red, rotated square: `width:7px;height:7px;background:#e05555;transform:rotate(45deg);position:absolute;`) at every distinct key time across all rows (bones + draworder + events).
- [ ] **Step 4: connectors** — inside each timeline `.track` (bone tracks only), render an absolute `<svg className="track-lines">` spanning the row; for each consecutive key pair draw `<line>` from x1 to x2 (y middle): stepped (`key.curve === 'stepped'`) → `strokeDasharray="3 3"`; bezier (`Array.isArray(key.curve)`) → `strokeWidth={2}`; linear → `strokeWidth={1}`. Stroke color = the row's tick color at 60% opacity. Pointer-events none.
- [ ] **Step 5:** typecheck/build; screenshot dev-server check against Spine screenshot #5; commit `P17: Spine-style key ticks, summary rows, interpolation connectors`.

---

### Task 6: Pose-tạm (Auto Key off) + e2e battery + docs

**Files:** Modify `Viewport.tsx`, `state/bone-edit.ts`, `components/ToolCluster.tsx`, `CLAUDE.md`, `PLAN.md`

- [ ] **Step 1: Viewport** — REPLACE the Phase-15 auto-key gate in `onPointerUp` (the `if (animating && !state.autoKey && …) { setError…; return; }` block): keep the gate ONLY for `drag.kind === 'vertex'`; for translate/rotate/scale/shear when `animating && !state.autoKey`, write the override result into posePreview instead of committing:

```ts
if (
  animating &&
  !state.autoKey &&
  (drag.kind === 'translate' ||
    drag.kind === 'rotate' ||
    drag.kind === 'scale' ||
    drag.kind === 'shear') &&
  override
) {
  for (const boneName of drag.bones) {
    const b = override.find((x) => x.name === boneName);
    if (!b) continue;
    if (drag.kind === 'translate') state.setPosePreview(boneName, { x: b.x, y: b.y });
    else if (drag.kind === 'rotate') state.setPosePreview(boneName, { rotation: b.rotation });
    else if (drag.kind === 'scale')
      state.setPosePreview(boneName, { scaleX: b.scaleX, scaleY: b.scaleY });
    else state.setPosePreview(boneName, { shearX: b.shearX, shearY: b.shearY });
  }
  redraw();
  return;
}
```

`baseLocals()` merges the overlay after `computeAnimatedLocals`/physics:

```ts
      const locals = /* existing result */;
      const preview = state.posePreview;
      if (!preview) return locals;
      return locals.map((b) => (preview[b.name] ? { ...b, ...preview[b.name] } : b));
```

Subscribe `posePreview` for redraw (selector + effect dep).

- [ ] **Step 2: bone-edit.ts** — in `applyBoneEdit`, replace the `!s.autoKey` error branch: write `s.setPosePreview(boneName, patch as Record<string, number>)` and return true.
- [ ] **Step 3: ToolCluster** — `shown` merges posePreview (`const pp = useEditor((s) => s.posePreview);` → after computing shown: `pp?.[bone.name] ? { ...shown, ...pp[bone.name] } : shown`). The per-row key button when `!autoKey`: commit the CURRENT shown values through the auto-key path — call a new helper in bone-edit:

```ts
/** Keys the given absolute locals at the playhead regardless of autoKey, then clears the bone's preview. */
export function keyPoseNow(boneName: string, patch: BonePatch): boolean {
  const s = useEditor.getState();
  const prevAuto = s.autoKey;
  if (!prevAuto) s.setAutoKey(true);
  const ok = applyBoneEdit(boneName, patch);
  if (!prevAuto) s.setAutoKey(false);
  if (ok && s.posePreview?.[boneName]) {
    const { [boneName]: _dropped, ...rest } = s.posePreview;
    useEditor.setState({ posePreview: Object.keys(rest).length ? rest : null });
  }
  return ok;
}
```

Key buttons call `keyPoseNow(primary.name, { rotation: shown.rotation })` etc. (setAutoKey(true) clears posePreview per Task 1 — reorder: capture the preview values BEFORE toggling; simplest: in `setAutoKey`, only clear posePreview when turning ON FROM THE UI — move the clearing out of setAutoKey and into the ToolCluster Auto Key button handler instead, so keyPoseNow's temporary toggle doesn't wipe the overlay. Adjust Task 1 accordingly.)

- [ ] **Step 4: e2e battery + docs** — run smoke/anim/bridge/chat per the standard recipe (expect all green; bridge `toolCount: 59`, `setIkWorks` intact). Manual dev check: Auto Key off → drag bone → pose changes, no key, scrub resets; key button writes the key. CLAUDE.md: mark Phase 17 done (tabs/toolbar/ticks/loop-range/pose-tạm) + Next: phases 18–22; PLAN.md §8 row 17 `✅ (07/2026)`. Commit `P17: transient posing when Auto Key is off + e2e/docs`.

---

### Final acceptance (spec §7)

- [ ] Suites + build + pytest green; 4 e2e green with kept selectors
- [ ] Screenshot vs Spine #5: tabs, toolbar, colored ticks, diamond row, connectors
- [ ] Loop range wraps playback; Current/Loop fields drive the playhead
- [ ] Auto Key off: transient pose + key button commits; scrub clears
