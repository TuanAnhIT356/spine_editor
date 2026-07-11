import { TrackMixer } from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store.js';
import { SceneRenderer } from '../viewport/renderer.js';

const POS_KEY = 'spine-editor.preview-window';
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

/** Runtime-style preview: 4 mixer tracks with speed/mix/alpha/hold/additive. */
export function PreviewWindow({ onClose }: { onClose: () => void }) {
  const revision = useEditor((s) => s.revision);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const mixerRef = useRef<TrackMixer | null>(null);
  const [active, setActive] = useState(0);
  const [mixSeconds, setMixSeconds] = useState(0.2);
  const [showBones, setShowBones] = useState(true);
  const [, force] = useState(0); // re-render for mixer state display
  const showBonesRef = useRef(showBones);
  showBonesRef.current = showBones;
  const names = Object.keys(useEditor.getState().doc.data.animations);
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

  // Renderer + RAF loop driven by the mixer (independent of the main viewport).
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
  }, []);

  // (Re)build the mixer when the document changes, keeping assignments.
  useEffect(() => {
    const prev = mixerRef.current;
    const doc = useEditor.getState().doc;
    const mixer = new TrackMixer(doc.data);
    if (prev) {
      prev.tracks.forEach((t, i) => {
        if (t.animation && doc.data.animations[t.animation]) {
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
        <label className="views-item" onPointerDown={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={showBones}
            onChange={(e) => setShowBones(e.target.checked)}
          />
          Bones
        </label>
        <button className="close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="preview-body">
        <div ref={hostRef} className="preview-canvas" />
        <div className="preview-side">
          <div className="panel-title">Animations</div>
          {names.length === 0 && <div className="empty">No animations yet.</div>}
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
