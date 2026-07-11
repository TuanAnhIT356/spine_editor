import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store.js';

const POS_KEY = 'spine-editor.metrics-window';

/** Document statistics, Spine's Metrics view equivalent. */
export function MetricsWindow({ onClose }: { onClose: () => void }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const doc = useEditor((s) => s.doc);
  const assets = useEditor((s) => s.assets);
  const audioAssets = useEditor((s) => s.audioAssets);
  const [pos, setPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { x: number; y: number };
      if (typeof saved.x === 'number') return saved;
    } catch {
      /* first open */
    }
    return { x: 140, y: 100 };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => localStorage.setItem(POS_KEY, JSON.stringify(pos)), [pos]);

  const d = doc.data;
  const byType = new Map<string, number>();
  let meshVertices = 0;
  let meshTriangles = 0;
  for (const skin of d.skins) {
    for (const bySlot of Object.values(skin.attachments ?? {})) {
      for (const att of Object.values(bySlot)) {
        const type = att.type ?? 'region';
        byType.set(type, (byType.get(type) ?? 0) + 1);
        if (att.type === 'mesh') {
          meshVertices += att.uvs.length / 2;
          meshTriangles += att.triangles.length / 3;
        }
      }
    }
  }
  const rows: [string, number][] = [
    ['Bones', d.bones.length],
    ['Slots', d.slots.length],
    ['Skins', d.skins.length],
    ...[...byType.entries()].map(([t, n]) => [`Attachments: ${t}`, n] as [string, number]),
    ['IK constraints', d.ik.length],
    ['Transform constraints', d.transform.length],
    ['Path constraints', d.path.length],
    ['Physics constraints', d.physics.length],
    ['Events', Object.keys(d.events).length],
    ['Animations', Object.keys(d.animations).length],
    ['Images', Object.keys(assets).length],
    ['Audio', Object.keys(audioAssets).length],
    ['Mesh vertices', meshVertices],
    ['Mesh triangles', meshTriangles],
  ];

  return (
    <div className="metrics-window" style={{ left: pos.x, top: pos.y }}>
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
        <span className="chat-title">Metrics</span>
        <button className="close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="metrics-body">
        <table>
          <tbody>
            {rows.map(([label, n]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="metrics-n">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
