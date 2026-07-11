import { SetSlotProperties } from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { primarySelection, useEditor } from '../state/store.js';

const POS_KEY = 'spine-editor.color-window';

const toHex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Spine-style Color view: setup color + optional tint black for the selected slot. */
export function ColorWindow({ onClose }: { onClose: () => void }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const mode = useEditor((s) => s.mode);
  const [pos, setPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { x: number; y: number };
      if (typeof saved.x === 'number') return saved;
    } catch {
      /* first open */
    }
    return { x: 100, y: 100 };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => localStorage.setItem(POS_KEY, JSON.stringify(pos)), [pos]);

  const primary = primarySelection(selection);
  const slot = primary?.kind === 'slot' ? doc.findSlot(primary.name) : null;
  const animate = mode === 'animate';
  const patch = (p: { color?: string; dark?: string | null }) => {
    if (slot) useEditor.getState().execute(new SetSlotProperties(slot.name, p));
  };

  const light = slot?.color ?? 'ffffffff';
  const alpha = parseInt(light.slice(6, 8), 16);

  return (
    <div className="color-window" style={{ left: pos.x, top: pos.y }}>
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
        <span className="chat-title">Color{slot ? `: ${slot.name}` : ''}</span>
        <button className="close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="color-body">
        {!slot ? (
          <div className="empty">Select a slot in the tree.</div>
        ) : (
          <>
            {animate && (
              <div className="empty">
                Setup colors only — key colors via the dopesheet or set_slot_color_keyframe.
              </div>
            )}
            <label className="field">
              <span>Color</span>
              <input
                type="color"
                disabled={animate}
                value={`#${light.slice(0, 6)}`}
                onChange={(e) => patch({ color: e.target.value.slice(1) + light.slice(6, 8) })}
              />
            </label>
            <label className="field">
              <span>Alpha</span>
              <input
                type="range"
                min={0}
                max={255}
                disabled={animate}
                value={alpha}
                onChange={(e) =>
                  patch({ color: light.slice(0, 6) + toHex2(Number(e.target.value)) })
                }
              />
            </label>
            <label className="field">
              <span>Tint black</span>
              <input
                type="checkbox"
                disabled={animate}
                checked={slot.dark !== null}
                onChange={(e) => patch({ dark: e.target.checked ? '000000' : null })}
              />
            </label>
            {slot.dark !== null && (
              <label className="field">
                <span>Dark</span>
                <input
                  type="color"
                  disabled={animate}
                  value={`#${slot.dark}`}
                  onChange={(e) => patch({ dark: e.target.value.slice(1) })}
                />
              </label>
            )}
          </>
        )}
      </div>
    </div>
  );
}
