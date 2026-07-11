import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store.js';

const POS_KEY = 'spine-editor.ghosting-window';

/** Mini floating window with the onion-skin ghosting knobs. */
export function GhostingWindow({ onClose }: { onClose: () => void }) {
  const ghost = useEditor((s) => s.anim.ghost);
  const cfg = useEditor((s) => s.ghostConfig);
  const setGhost = useEditor((s) => s.setGhost);
  const setGhostConfig = useEditor((s) => s.setGhostConfig);
  const [pos, setPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { x: number; y: number };
      if (typeof saved.x === 'number') return saved;
    } catch {
      /* first open */
    }
    return { x: 90, y: 120 };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => localStorage.setItem(POS_KEY, JSON.stringify(pos)), [pos]);

  const intField = (label: string, key: 'before' | 'after' | 'spacingFrames', max: number) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={key === 'spacingFrames' ? 1 : 0}
        max={max}
        step={1}
        value={cfg[key]}
        onChange={(e) => {
          const v = Math.round(Number(e.target.value));
          if (Number.isFinite(v)) setGhostConfig({ [key]: Math.max(0, Math.min(max, v)) });
        }}
      />
    </label>
  );

  return (
    <div className="ghosting-window" style={{ left: pos.x, top: pos.y }}>
      <div
        className="chat-header"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const { dx, dy } = drag.current;
          setPos({ x: Math.max(0, e.clientX - dx), y: Math.max(0, e.clientY - dy) });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span className="chat-title">Ghosting</span>
        <button className="close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="ghosting-body">
        <label className="field">
          <span>Ghosting</span>
          <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />
        </label>
        {intField('Before', 'before', 6)}
        {intField('After', 'after', 6)}
        {intField('Spacing (frames)', 'spacingFrames', 30)}
        <label className="field">
          <span>Opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.opacity}
            onChange={(e) => setGhostConfig({ opacity: Number(e.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}
