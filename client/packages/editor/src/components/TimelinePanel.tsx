import {
  Composite,
  CreateAnimation,
  DeleteBoneKeyframe,
  DeleteDrawOrderKeyframe,
  DeleteEventKeyframe,
  RemoveAnimation,
  SetEventDef,
  TransformBoneKeys,
  UpsertBoneKeyframe,
  UpsertEventKeyframe,
  getAnimationDuration,
  type Command,
  type SpineBoneKey,
  type SpineBoneTimelineName,
} from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { exportGif } from '../state/gif-export.js';
import { uniqueName, useEditor } from '../state/store.js';
import { GraphEditor } from './GraphEditor.js';

const DEFAULT_PPS = 200; // pixels per second
const MIN_PPS = 40;
const MAX_PPS = 1200;
const SNAP = 0.01;
/** Left inset so the t=0 key is fully visible and clickable. */
const PAD = 12;
const RULER_H = 22;
const ROW_H = 24;

const TIMELINE_ORDER: SpineBoneTimelineName[] = [
  'rotate',
  'translate',
  'translatex',
  'translatey',
  'scale',
  'scalex',
  'scaley',
  'shear',
  'shearx',
  'sheary',
];

const SPEED_CHOICES = [0.1, 0.25, 0.5, 1, 1.5, 2];

interface KeyRef {
  bone: string;
  timeline: SpineBoneTimelineName;
  time: number;
}

/** Selected key on the draw order or event track. */
type SpecialKeyRef =
  { kind: 'draworder'; time: number } | { kind: 'event'; name: string; time: number };

const snap = (t: number) => Math.max(0, Math.round(t / SNAP) * SNAP);
const sameKey = (a: KeyRef, b: KeyRef) =>
  a.bone === b.bone && a.timeline === b.timeline && Math.abs(a.time - b.time) < 1e-6;

const TICK_STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60];

/** Ruler tick times, spaced so ticks stay ~60px apart regardless of zoom. */
const TIMELINE_TYPES = [
  'rotate',
  'translate',
  'scale',
  'shear',
  'color',
  'attachment',
  'deform',
  'draworder',
  'event',
];

function tickTimes(span: number, pps: number): number[] {
  const targetPx = 60;
  const rawInterval = targetPx / pps;
  const interval = TICK_STEPS.find((s) => s >= rawInterval) ?? TICK_STEPS[TICK_STEPS.length - 1]!;
  const count = Math.floor(span / interval) + 1;
  return Array.from({ length: count }, (_, i) => Math.round(i * interval * 100) / 100);
}

interface BoxSelState {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
}

export function TimelinePanel() {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const anim = useEditor((s) => s.anim);
  const layout = useEditor((s) => s.layout);
  void revision;

  const [selectedKeys, setSelectedKeys] = useState<KeyRef[]>([]);
  const [selectedSpecial, setSelectedSpecial] = useState<SpecialKeyRef | null>(null);
  const [dragKeys, setDragKeys] = useState<{ grabTime: number; delta: number } | null>(null);
  const [boxSel, setBoxSel] = useState<BoxSelState | null>(null);
  const [pps, setPps] = useState(DEFAULT_PPS);
  const [tab, setTab] = useState<'dopesheet' | 'graph'>('dopesheet');
  const [sync, setSync] = useState(true);
  const [typeFilter, setTypeFilter] = useState<Set<string> | null>(null);
  const [locked, setLocked] = useState<string[] | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [shiftText, setShiftText] = useState('1');
  const [offsetText, setOffsetText] = useState('1');
  /** Key shown in the Graph tab; frozen while Sync is off. */
  const graphKeyRef = useRef<KeyRef | null>(null);
  const [scaleText, setScaleText] = useState('1.5');
  const [exporting, setExporting] = useState(false);
  const tracksRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const animation = anim.current ? doc.getAnimation(anim.current) : undefined;
  const duration = animation ? getAnimationDuration(animation) : 0;
  const span = Math.max(duration, 1) + 0.5;
  const names = Object.keys(doc.data.animations);

  const boneTracks = Object.entries(animation?.bones ?? {}).flatMap(([boneName, timelines]) =>
    TIMELINE_ORDER.filter((tl) => timelines[tl]).map((tl) => ({
      bone: boneName,
      timeline: tl,
      keys: timelines[tl]!,
    })),
  );
  const visibleTracks = boneTracks.filter((t) => {
    if (typeFilter && !typeFilter.has(t.timeline)) return false;
    if (locked && !locked.includes(`${t.bone}.${t.timeline}`)) return false;
    return true;
  });
  const drawOrderKeys =
    typeFilter && !typeFilter.has('draworder') ? [] : (animation?.drawOrder ?? []);
  const eventKeys = typeFilter && !typeFilter.has('event') ? [] : (animation?.events ?? []);
  const primaryKey = selectedKeys.length > 0 ? selectedKeys[selectedKeys.length - 1]! : null;

  /** Zooms the timeline, keeping the time under `anchorClientX` fixed on screen. */
  function zoomBy(factor: number, anchorClientX?: number) {
    const el = tracksRef.current;
    setPps((prev) => {
      const next = Math.min(MAX_PPS, Math.max(MIN_PPS, prev * factor));
      if (el && anchorClientX !== undefined) {
        const rect = el.getBoundingClientRect();
        const anchorTime = (anchorClientX - rect.left + el.scrollLeft - PAD) / prev;
        requestAnimationFrame(() => {
          el.scrollLeft = anchorTime * next + PAD - (anchorClientX - rect.left);
        });
      }
      return next;
    });
  }

  // Ctrl/Cmd + scroll over the timeline zooms in/out instead of scrolling.
  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [anim.current]);

  // Delete/Backspace removes selected keys. Capture phase so the global
  // bone-delete shortcut in App never sees the event while keys are selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
      if (selectedKeys.length === 0 && !selectedSpecial) return;
      e.preventDefault();
      e.stopPropagation();
      deleteSelectedKeys();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Playback ticker.
  useEffect(() => {
    if (!anim.playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = useEditor.getState();
      const a = s.anim.current ? s.doc.getAnimation(s.anim.current) : undefined;
      const dur = a ? Math.max(getAnimationDuration(a), 0.001) : 1;
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
      s.setAnimTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim.playing]);

  function timeFromEvent(e: React.PointerEvent): number {
    const el = tracksRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return snap((e.clientX - rect.left + el.scrollLeft - PAD) / pps);
  }

  /** Pointer position in .tracks content coordinates (for box select). */
  function tracksPoint(e: React.PointerEvent): { x: number; y: number } {
    const inner = innerRef.current;
    if (!inner) return { x: 0, y: 0 };
    const rect = inner.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onScrub(e: React.PointerEvent) {
    useEditor.getState().setAnimTime(Math.min(timeFromEvent(e), span));
  }

  function onNewAnimation() {
    const state = useEditor.getState();
    const name = window.prompt(
      'Animation name',
      uniqueName('animation', (n) => n in state.doc.data.animations),
    );
    if (!name) return;
    if (state.execute(new CreateAnimation(name.trim()))) state.setAnimation(name.trim());
  }

  function onDeleteAnimation() {
    const state = useEditor.getState();
    if (!anim.current) return;
    if (!window.confirm(`Delete animation "${anim.current}"?`)) return;
    state.execute(new RemoveAnimation(anim.current));
  }

  function onAddEvent() {
    const state = useEditor.getState();
    if (!anim.current) return;
    const name = window.prompt('Event name', Object.keys(state.doc.data.events)[0] ?? 'event');
    if (!name) return;
    const commands: Command[] = [];
    if (!(name in state.doc.data.events)) commands.push(new SetEventDef(name, {}));
    const time = snap(anim.time);
    const key: { name: string; time?: number } = { name };
    if (time > 0) key.time = time;
    commands.push(new UpsertEventKeyframe(anim.current, key));
    if (
      state.execute(commands.length === 1 ? commands[0]! : new Composite('Key event', commands))
    ) {
      setSelectedSpecial({ kind: 'event', name, time });
    }
  }

  function selectKey(e: React.PointerEvent | React.MouseEvent, ref: KeyRef): KeyRef[] {
    setSelectedSpecial(null);
    let next: KeyRef[];
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      next = selectedKeys.some((k) => sameKey(k, ref))
        ? selectedKeys.filter((k) => !sameKey(k, ref))
        : [...selectedKeys, ref];
    } else {
      next = selectedKeys.some((k) => sameKey(k, ref)) ? selectedKeys : [ref];
    }
    setSelectedKeys(next);
    return next;
  }

  if (sync && primaryKey) graphKeyRef.current = primaryKey;

  function jumpToKey(dir: -1 | 1) {
    const times = [...new Set(boneTracks.flatMap((t) => t.keys.map((k) => k.time ?? 0)))].sort(
      (a, b) => a - b,
    );
    const t = useEditor.getState().anim.time;
    const next =
      dir === 1 ? times.find((x) => x > t + 1e-6) : [...times].reverse().find((x) => x < t - 1e-6);
    if (next !== undefined) useEditor.getState().setAnimTime(next);
  }

  function deleteSelectedKeys() {
    const state = useEditor.getState();
    if (!anim.current) return;
    const commands: Command[] = selectedKeys.map(
      (k) => new DeleteBoneKeyframe(anim.current!, k.bone, k.timeline, k.time),
    );
    if (selectedSpecial?.kind === 'draworder') {
      commands.push(new DeleteDrawOrderKeyframe(anim.current, selectedSpecial.time));
    } else if (selectedSpecial?.kind === 'event') {
      commands.push(
        new DeleteEventKeyframe(anim.current, selectedSpecial.name, selectedSpecial.time),
      );
    }
    if (commands.length === 0) return;
    const ok = state.execute(
      commands.length === 1
        ? commands[0]!
        : new Composite(`Delete ${commands.length} keys`, commands),
    );
    if (ok) {
      setSelectedKeys([]);
      setSelectedSpecial(null);
    }
  }

  function commitKeyDrag(delta: number) {
    const state = useEditor.getState();
    if (!anim.current || Math.abs(delta) < SNAP / 2) return;
    const minTime = Math.min(...selectedKeys.map((k) => k.time));
    const offset = Math.max(snap(minTime + delta), 0) - minTime;
    if (
      state.execute(
        new TransformBoneKeys(
          anim.current,
          selectedKeys.map((k) => ({ bone: k.bone, timeline: k.timeline, time: k.time })),
          { offset },
        ),
      )
    ) {
      setSelectedKeys(selectedKeys.map((k) => ({ ...k, time: snap(k.time + offset) })));
    }
  }

  function applyScale() {
    const state = useEditor.getState();
    const factor = Number(scaleText);
    if (!anim.current || !Number.isFinite(factor) || factor <= 0 || selectedKeys.length < 2) return;
    const pivot = Math.min(...selectedKeys.map((k) => k.time));
    if (
      state.execute(
        new TransformBoneKeys(
          anim.current,
          selectedKeys.map((k) => ({ bone: k.bone, timeline: k.timeline, time: k.time })),
          { scale: factor, pivot },
        ),
      )
    ) {
      setSelectedKeys(selectedKeys.map((k) => ({ ...k, time: pivot + (k.time - pivot) * factor })));
    }
  }

  const [copiedKeys, setCopiedKeys] = useState<
    { bone: string; timeline: SpineBoneTimelineName; relTime: number; key: SpineBoneKey }[]
  >([]);

  function copySelectedKeys() {
    if (!animation || selectedKeys.length === 0) return;
    const minTime = Math.min(...selectedKeys.map((k) => k.time));
    const copies: typeof copiedKeys = [];
    for (const ref of selectedKeys) {
      const key = animation.bones?.[ref.bone]?.[ref.timeline]?.find(
        (k) => Math.abs((k.time ?? 0) - ref.time) < 1e-6,
      );
      if (key)
        copies.push({
          bone: ref.bone,
          timeline: ref.timeline,
          relTime: ref.time - minTime,
          key: { ...key },
        });
    }
    setCopiedKeys(copies);
  }

  function pasteKeysAtPlayhead() {
    const state = useEditor.getState();
    if (copiedKeys.length === 0 || !anim.current) return;
    const base = snap(anim.time);
    const commands: Command[] = copiedKeys.map(({ bone, timeline, relTime, key }) => {
      const next: SpineBoneKey = { ...key };
      delete next.curve; // curves store absolute segment coordinates; re-ease after pasting
      const t = snap(base + relTime);
      if (t > 0) next.time = t;
      else delete next.time;
      return new UpsertBoneKeyframe(anim.current!, bone, timeline, next);
    });
    if (
      state.execute(
        commands.length === 1
          ? commands[0]!
          : new Composite(`Paste ${commands.length} keys`, commands),
      )
    ) {
      setSelectedKeys(
        copiedKeys.map(({ bone, timeline, relTime }) => ({
          bone,
          timeline,
          time: snap(base + relTime),
        })),
      );
    }
  }

  // --- Box select over the track area -------------------------------------
  function onTracksPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('track') && !target.classList.contains('tracks')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = tracksPoint(e);
    setBoxSel({
      x0: p.x,
      y0: p.y,
      x1: p.x,
      y1: p.y,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
    });
  }

  function onTracksPointerMove(e: React.PointerEvent) {
    if (!boxSel) return;
    const p = tracksPoint(e);
    setBoxSel({ ...boxSel, x1: p.x, y1: p.y });
  }

  function onTracksPointerUp() {
    if (!boxSel) return;
    const { x0, y0, x1, y1, additive } = boxSel;
    setBoxSel(null);
    const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ya, yb] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (xb - xa < 3 && yb - ya < 3) {
      if (!additive) {
        setSelectedKeys([]);
        setSelectedSpecial(null);
      }
      return;
    }
    const hits: KeyRef[] = [];
    boneTracks.forEach((track, row) => {
      const cy = RULER_H + row * ROW_H + ROW_H / 2;
      if (cy < ya || cy > yb) return;
      for (const key of track.keys) {
        const t = key.time ?? 0;
        const cx = PAD + t * pps;
        if (cx >= xa && cx <= xb)
          hits.push({ bone: track.bone, timeline: track.timeline, time: t });
      }
    });
    setSelectedSpecial(null);
    if (additive) {
      const merged = [...selectedKeys];
      for (const h of hits) if (!merged.some((k) => sameKey(k, h))) merged.push(h);
      setSelectedKeys(merged);
    } else {
      setSelectedKeys(hits);
    }
  }

  const primaryKeyData =
    primaryKey && anim.current
      ? doc
          .getAnimation(anim.current)
          ?.bones?.[primaryKey.bone]?.[primaryKey.timeline]?.find(
            (k) => Math.abs((k.time ?? 0) - primaryKey.time) < 1e-6,
          )
      : undefined;

  type CurveChoice = 'linear' | 'stepped' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier';

  /** Per-channel key values (rotate: value; two-axis timelines: x,y). */
  function channelValues(tl: SpineBoneTimelineName, key: SpineBoneKey): number[] {
    const dflt = tl.startsWith('scale') ? 1 : 0;
    if (tl === 'translate' || tl === 'scale' || tl === 'shear') {
      return [key.x ?? dflt, key.y ?? dflt];
    }
    return [key.value ?? dflt];
  }

  function setKeyCurve(ref: KeyRef, choice: CurveChoice) {
    const state = useEditor.getState();
    if (!anim.current || choice === 'bezier') return;
    const keys = state.doc.getAnimation(anim.current)?.bones?.[ref.bone]?.[ref.timeline];
    const idx = keys?.findIndex((k) => Math.abs((k.time ?? 0) - ref.time) < 1e-6) ?? -1;
    const key = keys?.[idx];
    if (!keys || !key) return;
    const next: SpineBoneKey = { ...key };
    if (choice === 'linear') delete next.curve;
    else if (choice === 'stepped') next.curve = 'stepped';
    else {
      const k2 = keys[idx + 1];
      if (!k2) {
        state.setError('Ease presets need a following key to curve toward.');
        return;
      }
      // CSS-style control points, scaled to the segment per channel.
      const [ax, bx] =
        choice === 'ease-in' ? [0.42, 1] : choice === 'ease-out' ? [0, 0.58] : [0.42, 0.58];
      const t1 = key.time ?? 0;
      const dt = (k2.time ?? 0) - t1;
      const v1s = channelValues(ref.timeline, key);
      const v2s = channelValues(ref.timeline, k2);
      const curve: number[] = [];
      v1s.forEach((v1, ch) => {
        const v2 = v2s[ch] ?? v1;
        curve.push(t1 + ax * dt, v1, t1 + bx * dt, v2);
      });
      next.curve = curve;
    }
    state.execute(new UpsertBoneKeyframe(anim.current, ref.bone, ref.timeline, next));
  }

  const frame = Math.round(anim.time * 30);

  return (
    <div className="timeline" style={{ height: layout.timelineHeight }}>
      <div className="tl-tabs">
        <button
          className={tab === 'graph' ? 'tl-tab active' : 'tl-tab'}
          onClick={() => setTab('graph')}
        >
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
          title="Sync the Graph tab to the dopesheet selection"
          onClick={() => setSync(!sync)}
        >
          Sync
        </button>
        <div className="menu-wrap">
          <button
            className={typeFilter ? 'tl-sync active' : 'tl-sync'}
            onClick={() => setShowFilter((v) => !v)}
          >
            Filter ▾
          </button>
          {showFilter && (
            <div className="dropdown">
              {TIMELINE_TYPES.map((t) => (
                <label key={t} className="views-item">
                  <input
                    type="checkbox"
                    checked={!typeFilter || typeFilter.has(t)}
                    onChange={(e) => {
                      const next = new Set(typeFilter ?? TIMELINE_TYPES);
                      if (e.target.checked) next.add(t);
                      else next.delete(t);
                      setTypeFilter(next.size === TIMELINE_TYPES.length ? null : next);
                    }}
                  />
                  {t}
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          className={locked ? 'tl-sync active' : 'tl-sync'}
          title="Freeze the current row list"
          onClick={() =>
            setLocked(locked ? null : boneTracks.map((t) => `${t.bone}.${t.timeline}`))
          }
        >
          Lock
        </button>
        <span className="tl-field">
          <span>Shift</span>
          <input value={shiftText} onChange={(e) => setShiftText(e.target.value)} />
          <button
            disabled={selectedKeys.length === 0}
            title="Move the selected keys by ±frames"
            onClick={() => {
              const frames = Number(shiftText);
              if (Number.isFinite(frames) && frames !== 0) commitKeyDrag(frames / 30);
            }}
          >
            Apply
          </button>
        </span>
        <span className="tl-field">
          <span>Offset</span>
          <input value={offsetText} onChange={(e) => setOffsetText(e.target.value)} />
          <button
            disabled={!anim.current}
            title="Shift every bone key of the animation by ±frames (fails on collisions)"
            onClick={() => {
              const frames = Number(offsetText);
              if (!Number.isFinite(frames) || frames === 0 || !anim.current) return;
              const refs = boneTracks.flatMap((t) =>
                t.keys.map((k) => ({ bone: t.bone, timeline: t.timeline, time: k.time ?? 0 })),
              );
              if (refs.length > 0) {
                useEditor
                  .getState()
                  .execute(new TransformBoneKeys(anim.current, refs, { offset: frames / 30 }));
              }
            }}
          >
            Apply
          </button>
        </span>
      </div>
      <div className="timeline-header">
        <select
          value={anim.current ?? ''}
          onChange={(e) => useEditor.getState().setAnimation(e.target.value || null)}
        >
          <option value="">— animation —</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button onClick={onNewAnimation}>New</button>
        <button disabled={!anim.current} onClick={onDeleteAnimation}>
          Delete
        </button>
        <span className="sep" />
        <button
          disabled={!anim.current}
          title="Go to start"
          onClick={() => useEditor.getState().setAnimTime(useEditor.getState().anim.loopStart ?? 0)}
        >
          ⏮
        </button>
        <button disabled={!anim.current} title="Previous key" onClick={() => jumpToKey(-1)}>
          ◀|
        </button>
        <button
          disabled={!anim.current}
          title="Previous frame (←)"
          onClick={() => useEditor.getState().stepFrame(-1)}
        >
          ⏴
        </button>
        <button
          disabled={!anim.current}
          onClick={() => useEditor.getState().setPlaying(!anim.playing)}
          title="Space"
        >
          {anim.playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button
          disabled={!anim.current}
          title="Next frame (→)"
          onClick={() => useEditor.getState().stepFrame(1)}
        >
          ⏵
        </button>
        <button disabled={!anim.current} title="Next key" onClick={() => jumpToKey(1)}>
          |▶
        </button>
        <button
          disabled={!anim.current}
          title="Go to end"
          onClick={() => useEditor.getState().setAnimTime(duration)}
        >
          ⏭
        </button>
        <button
          className={anim.loop ? 'active' : ''}
          onClick={() => useEditor.getState().setLoop(!anim.loop)}
        >
          Loop
        </button>
        <select
          value={String(anim.speed)}
          title="Playback speed"
          onChange={(e) => useEditor.getState().setSpeed(Number(e.target.value))}
        >
          {SPEED_CHOICES.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <button
          className={anim.ghost ? 'active' : ''}
          title="Onion-skin nearby frames (blue = past, green = future)"
          onClick={() => useEditor.getState().setGhost(!anim.ghost)}
        >
          Ghost
        </button>
        <span className="time-display">
          {anim.time.toFixed(2)}s · f{frame} / {duration.toFixed(2)}s
        </span>
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
              useEditor
                .getState()
                .setLoopRange(
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
              useEditor
                .getState()
                .setLoopRange(
                  anim.loopStart,
                  e.target.value === '' ? null : Number(e.target.value) / 30,
                )
            }
          />
        </label>
        {(anim.loopStart !== null || anim.loopEnd !== null) && (
          <button
            title="Clear loop range"
            onClick={() => useEditor.getState().setLoopRange(null, null)}
          >
            ✕
          </button>
        )}
        <span className="sep" />
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out (Ctrl/Cmd+Scroll)">
          −
        </button>
        <button onClick={() => setPps(DEFAULT_PPS)} title="Reset zoom">
          {Math.round((pps / DEFAULT_PPS) * 100)}%
        </button>
        <button onClick={() => zoomBy(1.2)} title="Zoom in (Ctrl/Cmd+Scroll)">
          +
        </button>
        <button disabled={!anim.current} onClick={onAddEvent} title="Key an event at the playhead">
          + Event
        </button>
        <button
          disabled={!anim.current || exporting}
          title="Export the current animation as an animated GIF (20fps, viewport framing)"
          onClick={() => {
            setExporting(true);
            exportGif()
              .catch((err) =>
                useEditor.getState().setError(err instanceof Error ? err.message : String(err)),
              )
              .finally(() => setExporting(false));
          }}
        >
          {exporting ? 'Exporting…' : 'GIF'}
        </button>
        {copiedKeys.length > 0 && (
          <button
            onClick={pasteKeysAtPlayhead}
            title={`Paste ${copiedKeys.length} key(s) at the playhead`}
          >
            Paste @ {anim.time.toFixed(2)}s
          </button>
        )}
        {(selectedKeys.length > 0 || selectedSpecial) && (
          <span className="key-tools">
            {selectedKeys.length > 1
              ? `${selectedKeys.length} keys`
              : primaryKey
                ? `key @ ${primaryKey.time.toFixed(2)}s`
                : selectedSpecial?.kind === 'draworder'
                  ? `draw order @ ${selectedSpecial.time.toFixed(2)}s`
                  : `${selectedSpecial?.name} @ ${selectedSpecial?.time.toFixed(2)}s`}
            {primaryKey && primaryKeyData && (
              <>
                <select
                  value={
                    primaryKeyData.curve === 'stepped'
                      ? 'stepped'
                      : Array.isArray(primaryKeyData.curve)
                        ? 'bezier'
                        : 'linear'
                  }
                  onChange={(e) => setKeyCurve(primaryKey, e.target.value as CurveChoice)}
                >
                  <option value="linear">linear</option>
                  <option value="stepped">stepped</option>
                  <option value="ease-in">ease-in</option>
                  <option value="ease-out">ease-out</option>
                  <option value="ease-in-out">ease-in-out</option>
                  <option value="bezier" disabled>
                    bezier
                  </option>
                </select>
                <button
                  onClick={() => setTab('graph')}
                  title="Edit the bezier curve toward the next key (Graph tab)"
                >
                  Curve
                </button>
                <button onClick={copySelectedKeys} title="Copy selected key values">
                  Copy
                </button>
              </>
            )}
            {selectedKeys.length > 1 && (
              <>
                <input
                  className="scale-input"
                  value={scaleText}
                  onChange={(e) => setScaleText(e.target.value)}
                  title="Time scale factor around the earliest selected key"
                />
                <button onClick={applyScale} title="Scale the timing of the selected keys">
                  Scale
                </button>
              </>
            )}
            <button onClick={deleteSelectedKeys} title="Delete selected keys (Del)">
              ✕
            </button>
          </span>
        )}
      </div>

      {!anim.current && (
        <div className="empty">
          Create an animation, then drag bones with the Translate/Rotate tools to set keys.
        </div>
      )}

      {anim.current && tab === 'dopesheet' && (
        <div className="timeline-body" ref={tracksRef}>
          <div
            className="tracks"
            ref={innerRef}
            style={{ width: span * pps + 40 + PAD }}
            onPointerDown={onTracksPointerDown}
            onPointerMove={onTracksPointerMove}
            onPointerUp={onTracksPointerUp}
          >
            <div
              className="ruler"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                scrubbing.current = true;
                onScrub(e);
              }}
              onPointerMove={(e) => scrubbing.current && onScrub(e)}
              onPointerUp={() => (scrubbing.current = false)}
            >
              {anim.loopEnd !== null && (
                <span
                  className="loop-range"
                  style={{
                    left: PAD + (anim.loopStart ?? 0) * pps,
                    width: Math.max((anim.loopEnd - (anim.loopStart ?? 0)) * pps, 0),
                  }}
                />
              )}
              {tickTimes(span, pps).map((t) => (
                <span key={t} className="tick" style={{ left: PAD + t * pps }}>
                  {t.toFixed(2)}
                </span>
              ))}
            </div>
            <div className="track summary-row">
              <span className="track-label">{anim.current}</span>
              {[
                ...new Set([
                  ...visibleTracks.flatMap((t) => t.keys.map((k) => k.time ?? 0)),
                  ...drawOrderKeys.map((k) => k.time ?? 0),
                  ...eventKeys.map((k) => k.time ?? 0),
                ]),
              ].map((t) => (
                <span key={t} className="summary-diamond" style={{ left: PAD + t * pps - 3 }} />
              ))}
            </div>
            {Object.entries(
              visibleTracks.reduce<Record<string, Map<number, Set<string>>>>((acc, t) => {
                const m = (acc[t.bone] ??= new Map());
                for (const k of t.keys) {
                  const time = k.time ?? 0;
                  if (!m.has(time)) m.set(time, new Set());
                  m.get(time)!.add(t.timeline);
                }
                return acc;
              }, {}),
            ).map(([bone, times]) => (
              <div key={`sum-${bone}`} className="track bone-summary">
                <span className="track-label">{bone}</span>
                {[...times.entries()].map(([t, types]) => (
                  <span
                    key={t}
                    className={`key ${types.size > 1 ? 'key-multi' : `key-${[...types][0]}`}`}
                    style={{ left: PAD + t * pps - 5 }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const refs = [...types].map((timeline) => ({
                        bone,
                        timeline: timeline as KeyRef['timeline'],
                        time: t,
                      }));
                      setSelectedKeys(refs);
                    }}
                  />
                ))}
              </div>
            ))}
            {visibleTracks.map((track) => (
              <div key={`${track.bone}.${track.timeline}`} className="track">
                <span className="track-label">
                  {track.bone} · {track.timeline}
                </span>
                <svg className="track-lines">
                  {track.keys.slice(0, -1).map((key, i) => {
                    const a = (key.time ?? 0) * pps + PAD;
                    const b = (track.keys[i + 1]!.time ?? 0) * pps + PAD;
                    const stepped = key.curve === 'stepped';
                    const bezier = Array.isArray(key.curve);
                    return (
                      <line
                        key={i}
                        x1={a}
                        y1={12}
                        x2={b}
                        y2={12}
                        className={`conn conn-${track.timeline}`}
                        strokeDasharray={stepped ? '3 3' : undefined}
                        strokeWidth={bezier ? 2 : 1}
                      />
                    );
                  })}
                </svg>
                {track.keys.map((key) => {
                  const t = key.time ?? 0;
                  const ref: KeyRef = { bone: track.bone, timeline: track.timeline, time: t };
                  const isSelected = selectedKeys.some((k) => sameKey(k, ref));
                  const shift = isSelected && dragKeys ? dragKeys.delta : 0;
                  const x = PAD + (t + shift) * pps;
                  return (
                    <span
                      key={t}
                      className={`key key-${track.timeline} ${isSelected ? 'selected' : ''}`}
                      style={{ left: x - 5 }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                          selectKey(e, ref);
                          return;
                        }
                        e.currentTarget.setPointerCapture(e.pointerId);
                        selectKey(e, ref);
                        setDragKeys({ grabTime: timeFromEvent(e), delta: 0 });
                      }}
                      onPointerMove={(e) => {
                        if (!dragKeys) return;
                        setDragKeys({ ...dragKeys, delta: timeFromEvent(e) - dragKeys.grabTime });
                      }}
                      onPointerUp={() => {
                        if (!dragKeys) return;
                        const { delta } = dragKeys;
                        setDragKeys(null);
                        if (Math.abs(delta) < SNAP / 2) {
                          // Plain click (no drag): collapse a multi-selection
                          // to just the clicked key.
                          if (selectedKeys.length > 1) setSelectedKeys([ref]);
                          return;
                        }
                        commitKeyDrag(delta);
                      }}
                    />
                  );
                })}
              </div>
            ))}
            {drawOrderKeys.length > 0 && (
              <div className="track special">
                <span className="track-label">draw order</span>
                {drawOrderKeys.map((key) => {
                  const t = key.time ?? 0;
                  const isSelected =
                    selectedSpecial?.kind === 'draworder' &&
                    Math.abs(selectedSpecial.time - t) < 1e-6;
                  return (
                    <span
                      key={t}
                      className={`key draworder key-draworder ${isSelected ? 'selected' : ''}`}
                      title={`draw order (${key.offsets?.length ?? 0} offsets)`}
                      style={{ left: PAD + t * pps - 5 }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelectedKeys([]);
                        setSelectedSpecial({ kind: 'draworder', time: t });
                      }}
                    />
                  );
                })}
              </div>
            )}
            {eventKeys.length > 0 && (
              <div className="track special">
                <span className="track-label">events</span>
                {eventKeys.map((key) => {
                  const t = key.time ?? 0;
                  const isSelected =
                    selectedSpecial?.kind === 'event' &&
                    selectedSpecial.name === key.name &&
                    Math.abs(selectedSpecial.time - t) < 1e-6;
                  return (
                    <span
                      key={`${key.name}@${t}`}
                      className={`key event key-event ${isSelected ? 'selected' : ''}`}
                      title={key.name}
                      style={{ left: PAD + t * pps - 5 }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelectedKeys([]);
                        setSelectedSpecial({ kind: 'event', name: key.name, time: t });
                      }}
                    />
                  );
                })}
              </div>
            )}
            {boneTracks.length === 0 && drawOrderKeys.length === 0 && eventKeys.length === 0 && (
              <div className="empty">
                No keys yet — pose a bone with Translate/Rotate to auto-key at the playhead.
              </div>
            )}
            <div className="playhead" style={{ left: PAD + anim.time * pps }} />
            {boxSel && (
              <div
                className="box-select"
                style={{
                  left: Math.min(boxSel.x0, boxSel.x1),
                  top: Math.min(boxSel.y0, boxSel.y1),
                  width: Math.abs(boxSel.x1 - boxSel.x0),
                  height: Math.abs(boxSel.y1 - boxSel.y0),
                }}
              />
            )}
          </div>
        </div>
      )}

      {anim.current && tab === 'graph' && graphKeyRef.current && (
        <GraphEditor
          animation={anim.current}
          bone={graphKeyRef.current.bone}
          timeline={graphKeyRef.current.timeline}
          time={graphKeyRef.current.time}
        />
      )}
      {anim.current && tab === 'graph' && !graphKeyRef.current && (
        <div className="empty">Select a key in the Dopesheet to edit its curve here.</div>
      )}
    </div>
  );
}
