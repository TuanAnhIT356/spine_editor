# Phase 18 — TrackMixer + Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic 4-track animation mixer in core (crossfade/alpha/additive/hold-previous/speed/loop) driving a floating Preview window with per-track runtime controls, plus configurable onion-skin ghosting.

**Architecture:** `core/src/mixer.ts` blends per-animation `computeAnimatedLocals` results on bone locals only (shortest-arc rotation lerp); the editor's PreviewWindow owns a second `SceneRenderer` + RAF loop feeding `mixer.pose()` as `bonesOverride`. Ghost config moves from constants into the store, edited by a mini floating window.

**Tech Stack:** core TS + vitest (TDD), React floating windows (ChatWindow pattern), PixiJS second renderer.

**Spec:** `docs/superpowers/specs/2026-07-11-phase18-preview-design.md`

## Global Constraints

- Branch `claude/phase18-preview`; pnpm from `client/` (shim PATH as before).
- Mixer is bone-locals only (no deform/attachment/draworder/event) — an approximation for preview, no runtime-parity claim.
- `ghostConfig` and all preview state are editor-only, never serialized.
- No e2e selector changes. Every commit ends with the repo trailer.

---

### Task 1: Core TrackMixer (TDD)

**Files:** Create `client/packages/core/src/mixer.ts`; modify `client/packages/core/src/index.ts` (`export * from './mixer.js';`); test `client/packages/core/test/mixer.test.ts`.

**Interfaces (Produces):** `TrackState`, `TrackMixer` exactly as spec §1 (constructor `(data: SkeletonData, trackCount = 4)`, `tracks`, `setAnimation(track, name, mixDuration?)`, `setTrackProps(track, patch)`, `update(dt)`, `pose(): BoneData[]`).

- [ ] **Step 1: failing tests** — `mixer.test.ts` builds a doc with bones `root, b` and animations `spin` (b.rotate 0→90 over 1s, linear keys `[{value:0},{time:1,value:90}]`) and `lift` (b.translate y 0→100 over 1s):

```ts
import { describe, expect, it } from 'vitest';
import { TrackMixer, createBone, createEmptySkeleton } from '../src/index.js';

function data() {
  const d = createEmptySkeleton();
  d.bones.push(createBone('b', 'root'));
  d.animations['spin'] = { bones: { b: { rotate: [{ value: 0 }, { time: 1, value: 90 }] } } };
  d.animations['lift'] = {
    bones: {
      b: {
        translate: [
          { x: 0, y: 0 },
          { time: 1, y: 100 },
        ],
      },
    },
  };
  d.animations['still'] = { bones: { b: { rotate: [{ value: 30 }, { time: 1, value: 30 }] } } };
  return d;
}

const bone = (m: TrackMixer) => m.pose().find((b) => b.name === 'b')!;

describe('TrackMixer', () => {
  it('plays track 0 and loops', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin');
    m.update(0.5);
    expect(bone(m).rotation).toBeCloseTo(45, 1);
    m.update(0.75); // t=1.25 → wraps to 0.25
    expect(bone(m).rotation).toBeCloseTo(22.5, 1);
  });

  it('respects speed', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin');
    m.setTrackProps(0, { speed: 2 });
    m.update(0.25); // effective 0.5
    expect(bone(m).rotation).toBeCloseTo(45, 1);
  });

  it('crossfades between animations on one track', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'still'); // rotation 30 constant
    m.update(0.2);
    m.setAnimation(0, 'spin', 1); // fade 1s from still→spin
    m.update(0.5); // w=0.5; spin at t=0.5 → 45; still → 30 → blend 37.5
    expect(bone(m).rotation).toBeCloseTo(37.5, 1);
  });

  it('holdPrevious keeps the previous pose fully until the fade ends', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'still');
    m.setTrackProps(0, { holdPrevious: true });
    m.update(0.2);
    m.setAnimation(0, 'spin', 1);
    m.update(0.5); // hold: prev contributes fully → lerp(30, 45, 0.5) is NOT used;
    // implementation: result = lerp(prevPose, currentPose, w) with prevPose frozen
    // at full weight → expected still-dominant value > plain crossfade
    expect(bone(m).rotation).toBeCloseTo(37.5, 1); // same midpoint math, but prevTime FROZEN
    // the observable hold effect: prev pose does not advance
    // (still is constant so freeze is invisible; assert via lift below)
  });

  it('layers track 1 with alpha (replace mix)', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin');
    m.setAnimation(1, 'still'); // rotation 30
    m.setTrackProps(1, { alpha: 0.5 });
    m.update(0.5); // track0 → 45; track1 target 30 → lerp(45,30,0.5)=37.5
    expect(bone(m).rotation).toBeCloseTo(37.5, 1);
  });

  it('additive track adds offsets scaled by alpha', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin');
    m.setAnimation(1, 'lift');
    m.setTrackProps(1, { additive: true, alpha: 0.5 });
    m.update(0.5); // lift y offset at 0.5 = 50 → +25 additively
    expect(bone(m).rotation).toBeCloseTo(45, 1);
    expect(bone(m).y).toBeCloseTo(25, 1);
  });

  it('clearing an animation fades back to the underlying pose', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'still');
    m.update(0.2);
    m.setAnimation(0, null, 1);
    m.update(0.5); // fade out: lerp(30, 0(setup), 0.5) = 15
    expect(bone(m).rotation).toBeCloseTo(15, 1);
  });
});
```

Adjust the holdPrevious test while implementing so it asserts the FROZEN prevTime observable (e.g. prev = `spin` playing, hold on → prev pose stops advancing during the fade); keep the other six exactly.

- [ ] **Step 2: RED** — import failure.
- [ ] **Step 3: implement `mixer.ts`:**

```ts
/**
 * Deterministic 4-track animation mixer for the Preview view. Blends BONE
 * LOCALS only (computeAnimatedLocals per animation): track 0 replaces the
 * setup pose, higher tracks layer by alpha (replace-lerp) or additively.
 * An approximation of runtime AnimationState — good for previewing, no
 * exact-parity claim (no deform/attachment/draworder/event timelines).
 */

import { computeAnimatedLocals } from './evaluate.js';
import { getAnimationDuration } from './evaluate.js';
import type { BoneData, SkeletonData } from './model/types.js';

export interface TrackState {
  animation: string | null;
  prev: string | null;
  time: number;
  prevTime: number;
  mixDuration: number;
  mixElapsed: number;
  speed: number;
  loop: boolean;
  alpha: number;
  holdPrevious: boolean;
  additive: boolean;
}

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/** Shortest-arc angle interpolation in degrees. */
function lerpAngle(a: number, b: number, w: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return a + d * w;
}

function blendLocals(from: BoneData[], to: BoneData[], w: number): BoneData[] {
  const byName = new Map(to.map((b) => [b.name, b]));
  return from.map((a) => {
    const b = byName.get(a.name);
    if (!b || w >= 1) return b ?? a;
    if (w <= 0) return a;
    return {
      ...a,
      x: lerp(a.x, b.x, w),
      y: lerp(a.y, b.y, w),
      rotation: lerpAngle(a.rotation, b.rotation, w),
      scaleX: lerp(a.scaleX, b.scaleX, w),
      scaleY: lerp(a.scaleY, b.scaleY, w),
      shearX: lerp(a.shearX, b.shearX, w),
      shearY: lerp(a.shearY, b.shearY, w),
    };
  });
}

function newTrack(): TrackState {
  return {
    animation: null,
    prev: null,
    time: 0,
    prevTime: 0,
    mixDuration: 0.2,
    mixElapsed: 0,
    speed: 1,
    loop: true,
    alpha: 1,
    holdPrevious: false,
    additive: false,
  };
}

export class TrackMixer {
  readonly tracks: TrackState[];

  constructor(
    private readonly data: SkeletonData,
    trackCount = 4,
  ) {
    this.tracks = Array.from({ length: trackCount }, newTrack);
  }

  setAnimation(track: number, name: string | null, mixDuration?: number): void {
    const t = this.tracks[track];
    if (!t) return;
    t.prev = t.animation;
    t.prevTime = t.time;
    t.animation = name;
    t.time = 0;
    t.mixElapsed = 0;
    if (mixDuration !== undefined) t.mixDuration = mixDuration;
  }

  setTrackProps(
    track: number,
    patch: Partial<
      Pick<TrackState, 'speed' | 'loop' | 'alpha' | 'holdPrevious' | 'additive' | 'mixDuration'>
    >,
  ): void {
    const t = this.tracks[track];
    if (t) Object.assign(t, patch);
  }

  update(dt: number): void {
    for (const t of this.tracks) {
      if (!t.animation && !t.prev) continue;
      const step = dt * t.speed;
      t.mixElapsed += dt;
      if (t.animation) t.time = this.advance(t.animation, t.time + step, t.loop);
      if (t.prev && !t.holdPrevious) t.prevTime = this.advance(t.prev, t.prevTime + step, t.loop);
      if (t.prev && t.mixDuration > 0 && t.mixElapsed >= t.mixDuration) t.prev = null;
      if (t.prev && t.mixDuration <= 0) t.prev = null;
    }
  }

  private advance(name: string, time: number, loop: boolean): number {
    const anim = this.data.animations[name];
    if (!anim) return time;
    const dur = Math.max(getAnimationDuration(anim), 0.001);
    if (time <= dur) return time;
    return loop ? time % dur : dur;
  }

  private trackPose(t: TrackState, under: BoneData[]): BoneData[] | null {
    const current = t.animation
      ? computeAnimatedLocals(this.data, t.animation, t.time)
      : t.prev
        ? under
        : null;
    if (!current) return null;
    if (!t.prev) return current;
    const prevPose = computeAnimatedLocals(this.data, t.prev, t.prevTime);
    const w = t.mixDuration > 0 ? Math.min(t.mixElapsed / t.mixDuration, 1) : 1;
    return blendLocals(prevPose, current, w);
  }

  /** Blended locals for the current state. */
  pose(): BoneData[] {
    let result = this.data.bones.map((b) => ({ ...b }));
    const setup = this.data.bones;
    this.tracks.forEach((t, i) => {
      const p = this.trackPose(t, result);
      if (!p) return;
      if (i === 0) {
        result = p.map((b) => ({ ...b }));
        return;
      }
      if (t.additive) {
        const setupByName = new Map(setup.map((b) => [b.name, b]));
        const byName = new Map(p.map((b) => [b.name, b]));
        result = result.map((r) => {
          const tp = byName.get(r.name);
          const s = setupByName.get(r.name);
          if (!tp || !s) return r;
          return {
            ...r,
            x: r.x + (tp.x - s.x) * t.alpha,
            y: r.y + (tp.y - s.y) * t.alpha,
            rotation: r.rotation + (tp.rotation - s.rotation) * t.alpha,
            scaleX: r.scaleX * (1 + (tp.scaleX / (s.scaleX || 1) - 1) * t.alpha),
            scaleY: r.scaleY * (1 + (tp.scaleY / (s.scaleY || 1) - 1) * t.alpha),
            shearX: r.shearX + (tp.shearX - s.shearX) * t.alpha,
            shearY: r.shearY + (tp.shearY - s.shearY) * t.alpha,
          };
        });
      } else {
        result = blendLocals(result, p, t.alpha);
      }
    });
    return result;
  }
}
```

Fix the `setAnimation(0, null, 1)` fade-out path: when `animation === null && prev !== null`, `trackPose` must blend `prevPose → under` (the pose beneath, i.e. setup for track 0): implement as `blendLocals(prevPose, under, w)`. Adjust the code above accordingly while making tests pass (the tests define the contract).

- [ ] **Step 4: GREEN** — mixer tests + whole core suite + typecheck.
- [ ] **Step 5: commit** `P18: TrackMixer — 4-track crossfade/alpha/additive preview mixer`.

---

### Task 2: PreviewWindow

**Files:** Create `client/packages/editor/src/components/PreviewWindow.tsx`; modify `Toolbar.tsx` (Views ▾ item + render), `styles.css`.

- [ ] **Step 1: component** (full code — floating window per ChatWindow pattern):

```tsx
import { TrackMixer } from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store.js';
import { SceneRenderer } from '../viewport/renderer.js';

const POS_KEY = 'spine-editor.preview-window';
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

/** Runtime-style preview: 4 mixer tracks with speed/mix/alpha/hold/additive. */
export function PreviewWindow({ onClose }: { onClose: () => void }) {
  const revision = useEditor((s) => s.revision);
  const assets = useEditor((s) => s.assets);
  const activeSkin = useEditor((s) => s.activeSkin);
  const doc = useEditor.getState().doc;
  const names = Object.keys(doc.data.animations);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const mixerRef = useRef<TrackMixer | null>(null);
  const [active, setActive] = useState(0);
  const [mixSeconds, setMixSeconds] = useState(0.2);
  const [showBones, setShowBones] = useState(true);
  const [, force] = useState(0); // re-render for track state display
  const [box, setBox] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as {
        x: number;
        y: number;
        w: number;
        h: number;
      };
      if (typeof saved.x === 'number') return saved;
    } catch {
      /* first open */
    }
    return { x: 60, y: 80, w: 460, h: 560 };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => localStorage.setItem(POS_KEY, JSON.stringify(box)), [box]);

  // Renderer + RAF loop; mixer rebuilt when the document changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new SceneRenderer();
    rendererRef.current = renderer;
    let raf = 0;
    let last = performance.now();
    void renderer.init(host).then(() => {
      const tick = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        const state = useEditor.getState();
        const mixer = mixerRef.current;
        if (renderer.ready && mixer) {
          mixer.update(dt);
          renderer.setViewFilters({
            bones: { select: true, visible: showBonesRef.current, labels: false },
            images: { select: true, visible: true, labels: false },
            others: { select: true, visible: false, labels: false },
          });
          void renderer.render({
            data: state.doc.data,
            bonesOverride: mixer.pose(),
            activeSkin: state.activeSkin,
            assets: state.assets,
            selection: [],
          });
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      renderer.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('wheel', onWheel);
      renderer.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showBonesRef = useRef(showBones);
  showBonesRef.current = showBones;

  // (Re)build the mixer when the document changes, keeping assignments.
  useEffect(() => {
    const prev = mixerRef.current;
    const mixer = new TrackMixer(useEditor.getState().doc.data);
    if (prev) {
      prev.tracks.forEach((t, i) => {
        if (t.animation && useEditor.getState().doc.data.animations[t.animation]) {
          mixer.setAnimation(i, t.animation, 0);
          mixer.setTrackProps(i, {
            speed: t.speed,
            loop: t.loop,
            alpha: t.alpha,
            holdPrevious: t.holdPrevious,
            additive: t.additive,
            mixDuration: t.mixDuration,
          });
        }
      });
    }
    mixerRef.current = mixer;
  }, [revision]);

  const mixer = mixerRef.current;
  const track = mixer?.tracks[active];

  return (
    <div
      className="preview-window"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <div
        className="chat-header"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const { dx, dy } = drag.current;
          setBox((b) => ({ ...b, x: Math.max(0, e.clientX - dx), y: Math.max(0, e.clientY - dy) }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span className="chat-title">Preview</span>
        <label className="views-item">
          <input
            type="checkbox"
            checked={showBones}
            onChange={(e) => setShowBones(e.target.checked)}
          />
          Bones
        </label>
        <button className="close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="preview-body">
        <div ref={hostRef} className="preview-canvas" />
        <div className="preview-side">
          <div className="panel-title">Animations</div>
          {names.map((n) => (
            <button
              key={n}
              className={track?.animation === n ? 'active' : ''}
              onClick={() => {
                mixer?.setAnimation(active, track?.animation === n ? null : n, mixSeconds);
                force((v) => v + 1);
              }}
            >
              {n}
            </button>
          ))}
          <div className="panel-title">Track</div>
          <div className="preview-tracks">
            {[0, 1, 2, 3].map((i) => (
              <button key={i} className={active === i ? 'active' : ''} onClick={() => setActive(i)}>
                {i}
              </button>
            ))}
          </div>
          {track && (
            <>
              <label className="field">
                <span>Speed</span>
                <select
                  value={String(track.speed)}
                  onChange={(e) => {
                    mixer?.setTrackProps(active, { speed: Number(e.target.value) });
                    force((v) => v + 1);
                  }}
                >
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Mix (s)</span>
                <input
                  type="number"
                  step="0.1"
                  value={mixSeconds}
                  onChange={(e) => setMixSeconds(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Repeat</span>
                <input
                  type="checkbox"
                  checked={track.loop}
                  onChange={(e) => {
                    mixer?.setTrackProps(active, { loop: e.target.checked });
                    force((v) => v + 1);
                  }}
                />
              </label>
              {active > 0 && (
                <>
                  <label className="field">
                    <span>Alpha</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={track.alpha}
                      onChange={(e) => {
                        mixer?.setTrackProps(active, { alpha: Number(e.target.value) });
                        force((v) => v + 1);
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Hold Previous</span>
                    <input
                      type="checkbox"
                      checked={track.holdPrevious}
                      onChange={(e) => {
                        mixer?.setTrackProps(active, { holdPrevious: e.target.checked });
                        force((v) => v + 1);
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Additive</span>
                    <input
                      type="checkbox"
                      checked={track.additive}
                      onChange={(e) => {
                        mixer?.setTrackProps(active, { additive: e.target.checked });
                        force((v) => v + 1);
                      }}
                    />
                  </label>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

(Alpha/Hold/Additive hidden for track 0 per the Spine docs; hold-previous also applies on track 0's crossfade internally.)

- [ ] **Step 2: Toolbar** — `const [showPreview, setShowPreview] = useState(false);`, Views ▾ gains a `Preview` checkbox item toggling it, render `{showPreview && <PreviewWindow onClose={() => setShowPreview(false)} />}`.
- [ ] **Step 3: styles** — `.preview-window { position: fixed; z-index: 25; display:flex; flex-direction:column; background: var(--panel-2); border:1px solid var(--border); border-radius:8px; overflow:hidden; box-shadow:0 8px 30px rgba(0,0,0,.5);} .preview-body{flex:1;display:flex;min-height:0;} .preview-canvas{flex:1;min-width:0;} .preview-side{width:170px;overflow-y:auto;border-left:1px solid var(--border);padding:6px;display:flex;flex-direction:column;gap:4px;} .preview-tracks{display:flex;gap:4px;}`
- [ ] **Step 4:** typecheck/build; manual dev check (walk on track 0 + wave alpha 0.5 on track 1); commit `P18: floating Preview window driven by TrackMixer`.

---

### Task 3: Ghosting config + window

**Files:** Modify `store.ts` (ghostConfig + setGhostConfig), `Viewport.tsx` (buildGhosts uses config), create `components/GhostingWindow.tsx`, modify `Toolbar.tsx` + `styles.css`.

- [ ] **Step 1: store** — `ghostConfig: { before: 2, after: 2, spacingFrames: 4, opacity: 0.5 }` + `setGhostConfig(patch: Partial<…>)` (merge).
- [ ] **Step 2: buildGhosts** — replace the fixed `[-2,-1,1,2]` + `duration/12` spacing: steps = `-before..-1` and `1..after`; `spacing = spacingFrames / 30`; ghost colors keep past/future hues (opacity wiring only if `RenderInput.ghosts` supports it — check the renderer's ghost drawing for an alpha value; if it uses a fixed alpha, multiply that constant by `ghostConfig.opacity / 0.5`).
- [ ] **Step 3: GhostingWindow** — mini floating window (same drag pattern, `POS_KEY 'spine-editor.ghosting-window'`, ~220×220): toggle `Ghost on/off` (anim.ghost), NumFields Before/After (0–6, integers), Spacing (frames), Opacity (0–1 range). Views ▾ gains `Ghosting` item.
- [ ] **Step 4:** typecheck/build; manual check; commit `P18: configurable onion-skin ghosting + window`.

---

### Task 4: E2E battery + docs

- [ ] **Step 1:** standard battery (smoke/anim/bridge/chat) — no selectors changed; expect all green (`toolCount: 59`, `setIkWorks`, `chatRigWorks`).
- [ ] **Step 2:** docs — CLAUDE.md: append Phase 18 done (TrackMixer 4 track, Preview window with per-track speed/mix/alpha/hold/additive, configurable ghosting; Playback view folded into the P17 transport + Preview) + `Next: PLAN.md §8 phases 19–22.` (replace the previous Next tail). PLAN.md row 18: `— ✅ (07/2026, Playback gộp vào transport P17 + Preview)`.
- [ ] **Step 3:** suites + pytest; commit `P18: e2e + docs — Phase 18 complete`.

---

### Final acceptance (spec §4)

- [ ] Mixer tests (7) green; suites + pytest green
- [ ] 4 e2e green, no selector churn
- [ ] Manual: walk + wave layering works; hold-previous kills dipping; ghosting knobs live
- [ ] Docs updated
