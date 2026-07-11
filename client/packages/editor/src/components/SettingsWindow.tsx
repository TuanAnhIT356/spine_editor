import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store.js';

const POS_KEY = 'spine-editor.settings-window';

/** Editor preferences: frame rate, local autosave, welcome screen. */
export function SettingsWindow({ onClose }: { onClose: () => void }) {
  const settings = useEditor((s) => s.settings);
  const setSettings = useEditor((s) => s.setSettings);
  const [pos, setPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { x: number; y: number };
      if (typeof saved.x === 'number') return saved;
    } catch {
      /* first open */
    }
    return { x: 120, y: 120 };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => localStorage.setItem(POS_KEY, JSON.stringify(pos)), [pos]);

  return (
    <div className="settings-window" style={{ left: pos.x, top: pos.y }}>
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
        <span className="chat-title">Settings</span>
        <button className="close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="settings-body">
        <label className="field">
          <span>Frame rate</span>
          <select
            value={settings.fps}
            onChange={(e) => setSettings({ fps: Number(e.target.value) as 24 | 30 | 60 })}
          >
            {[24, 30, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Autosave (local)</span>
          <input
            type="checkbox"
            checked={settings.autosave}
            onChange={(e) => setSettings({ autosave: e.target.checked })}
          />
        </label>
        <label className="field">
          <span>Show welcome on startup</span>
          <input
            type="checkbox"
            checked={settings.welcome}
            onChange={(e) => setSettings({ welcome: e.target.checked })}
          />
        </label>
      </div>
    </div>
  );
}
