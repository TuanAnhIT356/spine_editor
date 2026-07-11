import {
  SetAttachmentVertices,
  autoWeightVertices,
  boneWeightPerVertex,
  boundBoneIndices,
  isWeightedVertices,
  meshLocalPositions,
  meshVertexCount,
  pruneWeights,
  removeBoneFromWeights,
  smoothWeights,
  swapWeights,
} from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store.js';
import { WEIGHT_COLORS } from './weight-colors.js';

const POS_KEY = 'spine-editor.weights-window';

/** Spine-style Weights view: bound-bone palette, Bind/Remove/Swap, Auto/Smooth/Prune. */
export function WeightsWindow({ onClose }: { onClose: () => void }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const meshEdit = useEditor((s) => s.meshEdit);
  const doc = useEditor((s) => s.doc);
  const [session, setSession] = useState<string[]>([]);
  const [influences, setInfluences] = useState(4);
  const [prune, setPrune] = useState(0.01);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [pos, setPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { x: number; y: number };
      if (typeof saved.x === 'number') return saved;
    } catch {
      /* first open */
    }
    return { x: 80, y: 110 };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => localStorage.setItem(POS_KEY, JSON.stringify(pos)), [pos]);
  // Đổi mesh đang edit → reset session/swap.
  const editKey = meshEdit ? `${meshEdit.slot}/${meshEdit.attachment}` : '';
  useEffect(() => {
    setSession([]);
    setSwapFrom(null);
  }, [editKey]);

  const att = meshEdit
    ? doc.data.skins.find((s) => s.name === 'default')?.attachments?.[meshEdit.slot]?.[
        meshEdit.attachment
      ]
    : undefined;
  const mesh = att && att.type === 'mesh' ? att : null;
  const count = mesh ? meshVertexCount(mesh) : 0;
  const weighted = mesh ? isWeightedVertices(mesh.vertices, count) : false;
  const boundNames =
    mesh && weighted
      ? boundBoneIndices(mesh.vertices, count)
          .map((i) => doc.data.bones[i]?.name)
          .filter((n): n is string => n !== undefined)
      : [];
  const listed = [...boundNames, ...session.filter((n) => !boundNames.includes(n))];
  const unlisted = doc.data.bones.map((b) => b.name).filter((n) => !listed.includes(n));

  const run = (fn: () => number[]) => {
    const state = useEditor.getState();
    if (!meshEdit) return;
    try {
      const vertices = fn();
      state.execute(
        new SetAttachmentVertices('default', meshEdit.slot, meshEdit.attachment, vertices),
      );
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pct = (name: string): string => {
    if (!mesh || !weighted || count === 0) return '—';
    const bi = doc.data.bones.findIndex((b) => b.name === name);
    if (bi < 0) return '—';
    const w = boneWeightPerVertex(mesh.vertices, count, bi);
    let sum = 0;
    for (const v of w) sum += v;
    return `${((sum / count) * 100).toFixed(1)}%`;
  };

  return (
    <div className="weights-window" style={{ left: pos.x, top: pos.y }}>
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
        <span className="chat-title">Weights</span>
        <button className="close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="weights-body">
        {!mesh || !meshEdit ? (
          <div className="empty">Edit a mesh first (Tree → attachment → Edit).</div>
        ) : (
          <>
            <div className="panel-title">Bones</div>
            {listed.length === 0 && <div className="empty">Bind bones, then Auto.</div>}
            {listed.map((name, i) => (
              <div
                key={name}
                className={`weights-bone ${swapFrom === name ? 'swap-from' : ''}`}
                onClick={() => {
                  if (swapFrom && swapFrom !== name && mesh) {
                    run(() => swapWeights(doc.data, meshEdit.slot, mesh, swapFrom, name));
                    setSwapFrom(null);
                  }
                }}
              >
                <span
                  className="weights-dot"
                  style={{
                    background: `#${WEIGHT_COLORS[i % WEIGHT_COLORS.length]!.toString(16).padStart(6, '0')}`,
                  }}
                />
                <label>
                  <input
                    type="radio"
                    name="weights-paint"
                    checked={meshEdit.paintBone === name}
                    onChange={() => {
                      useEditor.getState().setPaintBone(name);
                      useEditor.getState().setMeshEditMode('weights');
                    }}
                  />
                  {name}
                </label>
                <span className="weights-pct">{pct(name)}</span>
              </div>
            ))}
            <div className="weights-actions">
              <select
                value=""
                title="Bind a bone (then Auto or paint)"
                onChange={(e) => {
                  if (e.target.value) {
                    setSession((prev) => [...prev, e.target.value]);
                    useEditor.getState().setPaintBone(e.target.value);
                  }
                }}
              >
                <option value="">Bind…</option>
                {unlisted.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                disabled={!meshEdit.paintBone || !weighted}
                title="Unbind the selected bone"
                onClick={() => {
                  const bone = meshEdit.paintBone;
                  if (!bone || !mesh) return;
                  run(() => removeBoneFromWeights(doc.data, meshEdit.slot, mesh, bone));
                  setSession((prev) => prev.filter((n) => n !== bone));
                  useEditor.getState().setPaintBone(null);
                }}
              >
                Remove
              </button>
              <button
                disabled={!meshEdit.paintBone || !weighted || listed.length < 2}
                className={swapFrom ? 'active' : ''}
                title="Swap: click this, then click another bone in the list"
                onClick={() => setSwapFrom(swapFrom ? null : meshEdit.paintBone)}
              >
                Swap
              </button>
            </div>
            <div className="weights-actions">
              <button
                disabled={listed.length === 0}
                title="Recompute distance-based weights over the listed bones"
                onClick={() => {
                  if (!mesh) return;
                  run(() =>
                    autoWeightVertices(
                      doc.data,
                      meshEdit.slot,
                      meshLocalPositions(doc.data, meshEdit.slot, mesh),
                      listed,
                      influences,
                    ),
                  );
                }}
              >
                Auto
              </button>
              <button
                disabled={!weighted}
                title="Average weights with neighboring vertices"
                onClick={() => mesh && run(() => smoothWeights(doc.data, meshEdit.slot, mesh, 1))}
              >
                Smooth
              </button>
              <button
                disabled={!weighted}
                title="Drop influences below the threshold"
                onClick={() =>
                  mesh &&
                  run(() =>
                    pruneWeights(mesh.vertices, count, {
                      maxInfluences: influences,
                      threshold: prune,
                    }),
                  )
                }
              >
                Prune
              </button>
            </div>
            <label className="field">
              <span>Influences</span>
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={influences}
                onChange={(e) =>
                  setInfluences(Math.max(1, Math.min(8, Math.round(Number(e.target.value)))))
                }
              />
            </label>
            <label className="field">
              <span>Prune &lt;</span>
              <input
                type="number"
                min={0}
                max={0.5}
                step={0.01}
                value={prune}
                onChange={(e) => setPrune(Math.max(0, Number(e.target.value)))}
              />
            </label>
            <label className="field">
              <span>Amount</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={meshEdit.paintAmount}
                onChange={(e) => useEditor.getState().setPaintAmount(Number(e.target.value))}
              />
            </label>
            <div className="weights-actions">
              {(['add', 'replace'] as const).map((m) => (
                <button
                  key={m}
                  className={meshEdit.paintMode === m ? 'active' : ''}
                  title={m === 'add' ? 'Brush adds weight (Shift subtracts)' : 'Brush sets weight'}
                  onClick={() => useEditor.getState().setPaintMode(m)}
                >
                  {m === 'add' ? 'Add' : 'Replace'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
