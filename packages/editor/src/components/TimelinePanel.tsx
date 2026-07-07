import {
  CreateAnimation,
  DeleteBoneKeyframe,
  MoveBoneKeyframe,
  RemoveAnimation,
  UpsertBoneKeyframe,
  getAnimationDuration,
  type SpineBoneKey,
  type SpineBoneTimelineName,
} from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { uniqueName, useEditor } from '../state/store.js';

const PPS = 200; // pixels per second
const SNAP = 0.01;
/** Left inset so the t=0 key is fully visible and clickable. */
const PAD = 12;

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

interface KeyRef {
  bone: string;
  timeline: SpineBoneTimelineName;
  time: number;
}

const snap = (t: number) => Math.max(0, Math.round(t / SNAP) * SNAP);

export function TimelinePanel() {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const anim = useEditor((s) => s.anim);
  void revision;

  const [selectedKey, setSelectedKey] = useState<KeyRef | null>(null);
  const [dragKey, setDragKey] = useState<(KeyRef & { toTime: number }) | null>(null);
  const tracksRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const animation = anim.current ? doc.getAnimation(anim.current) : undefined;
  const duration = animation ? getAnimationDuration(animation) : 0;
  const span = Math.max(duration, 1) + 0.5;
  const names = Object.keys(doc.data.animations);

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
      let t = s.anim.time + dt;
      if (t > dur) {
        if (s.anim.loop) t %= dur;
        else {
          s.setAnimTime(dur);
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
    return snap((e.clientX - rect.left + el.scrollLeft - PAD) / PPS);
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

  function keyLabel(keys: SpineBoneKey[] | undefined): number[] {
    return (keys ?? []).map((k) => k.time ?? 0);
  }

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

  const [copiedKey, setCopiedKey] = useState<(KeyRef & { key: SpineBoneKey }) | null>(null);

  function copySelectedKey() {
    if (!selectedKey || !selectedKeyData) return;
    setCopiedKey({ ...selectedKey, key: { ...selectedKeyData } });
  }

  function pasteKeyAtPlayhead() {
    const state = useEditor.getState();
    if (!copiedKey || !anim.current) return;
    const time = snap(anim.time);
    const key: SpineBoneKey = { ...copiedKey.key };
    delete key.curve; // curves reference segment values; re-ease after pasting
    if (time > 0) key.time = time;
    else delete key.time;
    if (
      state.execute(new UpsertBoneKeyframe(anim.current, copiedKey.bone, copiedKey.timeline, key))
    ) {
      setSelectedKey({ bone: copiedKey.bone, timeline: copiedKey.timeline, time });
    }
  }

  const selectedKeyData =
    selectedKey && anim.current
      ? doc
          .getAnimation(anim.current)
          ?.bones?.[selectedKey.bone]?.[selectedKey.timeline]?.find(
            (k) => Math.abs((k.time ?? 0) - selectedKey.time) < 1e-6,
          )
      : undefined;

  return (
    <div className="timeline">
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
          onClick={() => useEditor.getState().setPlaying(!anim.playing)}
          title="Space"
        >
          {anim.playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button
          className={anim.loop ? 'active' : ''}
          onClick={() => useEditor.getState().setLoop(!anim.loop)}
        >
          Loop
        </button>
        <span className="time-display">
          {anim.time.toFixed(2)}s / {duration.toFixed(2)}s
        </span>
        {copiedKey && (
          <button
            onClick={pasteKeyAtPlayhead}
            title={`Paste ${copiedKey.timeline} key of "${copiedKey.bone}" at the playhead`}
          >
            Paste @ {anim.time.toFixed(2)}s
          </button>
        )}
        {selectedKey && selectedKeyData && (
          <span className="key-tools">
            key @ {selectedKey.time.toFixed(2)}s
            <select
              value={
                selectedKeyData.curve === 'stepped'
                  ? 'stepped'
                  : Array.isArray(selectedKeyData.curve)
                    ? 'bezier'
                    : 'linear'
              }
              onChange={(e) => setKeyCurve(selectedKey, e.target.value as CurveChoice)}
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
            <button onClick={copySelectedKey} title="Copy key values">
              Copy
            </button>
            <button
              onClick={() => {
                if (!anim.current) return;
                if (
                  useEditor
                    .getState()
                    .execute(
                      new DeleteBoneKeyframe(
                        anim.current,
                        selectedKey.bone,
                        selectedKey.timeline,
                        selectedKey.time,
                      ),
                    )
                ) {
                  setSelectedKey(null);
                }
              }}
            >
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

      {anim.current && (
        <div className="timeline-body" ref={tracksRef}>
          <div className="tracks" style={{ width: span * PPS + 40 + PAD }}>
            <div
              className="ruler"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                scrubbing.current = true;
                onScrub(e);
              }}
              onPointerMove={(e) => scrubbing.current && onScrub(e)}
              onPointerUp={() => (scrubbing.current = false)}
            >
              {Array.from({ length: Math.floor(span * 2) + 1 }, (_, i) => i * 0.5).map((t) => (
                <span key={t} className="tick" style={{ left: PAD + t * PPS }}>
                  {t.toFixed(1)}
                </span>
              ))}
            </div>
            {Object.entries(animation?.bones ?? {}).map(([boneName, timelines]) =>
              TIMELINE_ORDER.filter((tl) => timelines[tl]).map((tl) => (
                <div key={`${boneName}.${tl}`} className="track">
                  <span className="track-label">
                    {boneName} · {tl}
                  </span>
                  {keyLabel(timelines[tl]).map((t) => {
                    const isSelected =
                      selectedKey?.bone === boneName &&
                      selectedKey.timeline === tl &&
                      Math.abs(selectedKey.time - t) < 1e-6;
                    const isDragging =
                      dragKey &&
                      dragKey.bone === boneName &&
                      dragKey.timeline === tl &&
                      Math.abs(dragKey.time - t) < 1e-6;
                    const x = PAD + (isDragging ? dragKey.toTime : t) * PPS;
                    return (
                      <span
                        key={t}
                        className={`key ${isSelected ? 'selected' : ''}`}
                        style={{ left: x - 5 }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setSelectedKey({ bone: boneName, timeline: tl, time: t });
                          setDragKey({ bone: boneName, timeline: tl, time: t, toTime: t });
                        }}
                        onPointerMove={(e) => {
                          if (!dragKey) return;
                          setDragKey({ ...dragKey, toTime: timeFromEvent(e) });
                        }}
                        onPointerUp={() => {
                          if (!dragKey || !anim.current) return;
                          const { bone, timeline, time, toTime } = dragKey;
                          setDragKey(null);
                          if (Math.abs(toTime - time) > 1e-6) {
                            if (
                              useEditor
                                .getState()
                                .execute(
                                  new MoveBoneKeyframe(anim.current, bone, timeline, time, toTime),
                                )
                            ) {
                              setSelectedKey({ bone, timeline, time: toTime });
                            }
                          }
                        }}
                      />
                    );
                  })}
                </div>
              )),
            )}
            {Object.keys(animation?.bones ?? {}).length === 0 && (
              <div className="empty">
                No keys yet — pose a bone with Translate/Rotate to auto-key at the playhead.
              </div>
            )}
            <div className="playhead" style={{ left: PAD + anim.time * PPS }} />
          </div>
        </div>
      )}
    </div>
  );
}
