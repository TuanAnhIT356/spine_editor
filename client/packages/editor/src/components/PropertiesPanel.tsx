import {
  AddSkinAttachment,
  AddSlot,
  Composite,
  RemoveBone,
  RemoveSkinAttachment,
  RenameBone,
  ReorderSlot,
  SetAttachmentVertices,
  SetBoneTransform,
  SetSlotProperties,
  autoWeightVertices,
  createSlot,
  isWeightedVertices,
  meshVertexCount,
  type BoneTransformPatch,
  type Command,
  type SpineAttachment,
  type SpineBlendMode,
  type SpineClippingAttachment,
  type SpinePointAttachment,
} from '@spine-editor/core';
import { useEffect, useState } from 'react';
import { primarySelection, uniqueName, useEditor } from '../state/store.js';

function NumField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step="1"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function BoneProperties({ name }: { name: string }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  void revision;
  const bone = doc.findBone(name);
  const [renameText, setRenameText] = useState(name);
  useEffect(() => setRenameText(name), [name]);
  if (!bone) return null;

  const patch = (p: BoneTransformPatch) =>
    useEditor.getState().execute(new SetBoneTransform(name, p));

  const commitRename = () => {
    const to = renameText.trim();
    if (!to || to === name) {
      setRenameText(name);
      return;
    }
    if (useEditor.getState().execute(new RenameBone(name, to))) {
      useEditor.getState().select({ kind: 'bone', name: to });
    } else {
      setRenameText(name);
    }
  };

  return (
    <>
      <div className="panel-title">Bone</div>
      <label className="field">
        <span>Name</span>
        <input
          value={renameText}
          disabled={bone.parent === null}
          onChange={(e) => setRenameText(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <NumField label="X" value={bone.x} onCommit={(x) => patch({ x })} />
      <NumField label="Y" value={bone.y} onCommit={(y) => patch({ y })} />
      <NumField
        label="Rotation"
        value={bone.rotation}
        onCommit={(rotation) => patch({ rotation })}
      />
      <NumField label="Scale X" value={bone.scaleX} onCommit={(scaleX) => patch({ scaleX })} />
      <NumField label="Scale Y" value={bone.scaleY} onCommit={(scaleY) => patch({ scaleY })} />
      <NumField label="Length" value={bone.length} onCommit={(length) => patch({ length })} />
      {bone.parent !== null && (
        <button
          className="danger"
          onClick={() => {
            if (useEditor.getState().execute(new RemoveBone(name))) {
              useEditor.getState().select(null);
            }
          }}
        >
          Delete Bone
        </button>
      )}
    </>
  );
}

const BLEND_MODES: SpineBlendMode[] = ['normal', 'additive', 'multiply', 'screen'];

const VERTEX_TYPES = new Set(['mesh', 'boundingbox', 'clipping', 'path']);

/** Unique bone indices influencing a weighted vertex array. */
function influenceBoneIndices(vertices: number[]): number[] {
  const out = new Set<number>();
  let vi = 0;
  while (vi < vertices.length) {
    const count = vertices[vi++] ?? 0;
    for (let b = 0; b < count; b++) {
      out.add(vertices[vi] ?? 0);
      vi += 4;
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Weights controls for the mesh being edited (bind bones, pick paint bone). */
function WeightsSection({ slotName, attName }: { slotName: string; attName: string }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const meshEdit = useEditor((s) => s.meshEdit);
  void revision;
  const [chosen, setChosen] = useState<string[]>([]);

  const att = doc.data.skins.find((s) => s.name === 'default')?.attachments?.[slotName]?.[attName];
  if (!att || att.type !== 'mesh' || !meshEdit) return null;
  const count = meshVertexCount(att);
  const weighted = isWeightedVertices(att.vertices, count);
  const bones = doc.data.bones;

  if (!weighted) {
    return (
      <>
        <div className="panel-title">Weights</div>
        <div className="empty">
          Pick bones, then bind — vertices get distance-based weights and follow the bones.
        </div>
        <div className="bone-checks">
          {bones.map((b) => (
            <label key={b.name}>
              <input
                type="checkbox"
                checked={chosen.includes(b.name)}
                onChange={(e) =>
                  setChosen((prev) =>
                    e.target.checked ? [...prev, b.name] : prev.filter((n) => n !== b.name),
                  )
                }
              />
              {b.name}
            </label>
          ))}
        </div>
        <button
          disabled={chosen.length === 0}
          onClick={() => {
            const state = useEditor.getState();
            try {
              const weightedVerts = autoWeightVertices(
                state.doc.data,
                slotName,
                att.vertices,
                chosen,
              );
              if (
                state.execute(
                  new SetAttachmentVertices('default', slotName, attName, weightedVerts),
                )
              ) {
                state.setMeshEditMode('weights');
                state.setPaintBone(chosen[0] ?? null);
              }
            } catch (err) {
              state.setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Bind + Auto Weights
        </button>
      </>
    );
  }

  const influences = influenceBoneIndices(att.vertices)
    .map((i) => bones[i]?.name)
    .filter((n): n is string => n !== undefined);
  return (
    <>
      <div className="panel-title">Weights</div>
      <div className="empty">
        Pick a bone and drag over vertices in the viewport to paint its influence (blue = 0, red =
        1).
      </div>
      <div className="bone-checks">
        {influences.map((name) => (
          <label key={name}>
            <input
              type="radio"
              name="paint-bone"
              checked={meshEdit.paintBone === name}
              onChange={() => {
                useEditor.getState().setPaintBone(name);
                useEditor.getState().setMeshEditMode('weights');
              }}
            />
            {name}
          </label>
        ))}
      </div>
    </>
  );
}

/** Per-slot attachment list: activate, edit vertices, add bbox/point/clipping. */
function AttachmentsSection({ slotName }: { slotName: string }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const meshEdit = useEditor((s) => s.meshEdit);
  void revision;
  const slot = doc.findSlot(slotName);
  if (!slot) return null;
  const bySlot = doc.data.skins.find((s) => s.name === 'default')?.attachments?.[slotName] ?? {};
  const state = () => useEditor.getState();

  function addAttachment(kind: 'boundingbox' | 'point' | 'path') {
    const suffix = kind === 'point' ? 'point' : kind === 'path' ? 'path' : 'bbox';
    const name = uniqueName(`${slotName}-${suffix}`, (n) => Object.keys(bySlot).includes(n));
    const att: SpineAttachment =
      kind === 'point'
        ? { type: 'point', x: 0, y: 0 }
        : kind === 'path'
          ? {
              type: 'path',
              vertexCount: 6,
              // Two points: in-handle, anchor, out-handle each (smooth line).
              vertices: [-40, 0, 0, 0, 40, 0, 60, 0, 100, 0, 140, 0],
              lengths: [100],
            }
          : { type: 'boundingbox', vertexCount: 4, vertices: [-40, -40, 40, -40, 40, 40, -40, 40] };
    if (state().execute(new AddSkinAttachment('default', slotName, name, att))) {
      if (kind !== 'point') state().startMeshEdit(slotName, name);
    }
  }

  function addClippingSlot() {
    const s = state();
    const slotIdx = s.doc.data.slots.findIndex((sl) => sl.name === slotName);
    const clipSlot = uniqueName(`${slotName}-clip`, (n) =>
      s.doc.data.slots.some((sl) => sl.name === n),
    );
    const commands: Command[] = [
      new AddSlot(createSlot(clipSlot, slot!.bone)),
      new AddSkinAttachment('default', clipSlot, 'clip', {
        type: 'clipping',
        end: slotName,
        vertexCount: 4,
        vertices: [-50, -50, 50, -50, 50, 50, -50, 50],
      }),
      new SetSlotProperties(clipSlot, { attachment: 'clip' }),
      new ReorderSlot(clipSlot, slotIdx),
    ];
    if (s.execute(new Composite(`Add clipping slot "${clipSlot}"`, commands))) {
      s.startMeshEdit(clipSlot, 'clip');
    }
  }

  return (
    <>
      <div className="panel-title">Attachments</div>
      {Object.entries(bySlot).map(([name, att]) => {
        const type = att.type ?? 'region';
        const isActive = slot.attachment === name;
        const editing = meshEdit?.slot === slotName && meshEdit.attachment === name;
        return (
          <div key={name} className="attachment-row">
            <span className={`att-type att-${type}`}>{type}</span>
            <span className="att-name" title={name}>
              {name}
            </span>
            {!isActive && (
              <button
                title="Make this the slot's active attachment"
                onClick={() =>
                  state().execute(new SetSlotProperties(slotName, { attachment: name }))
                }
              >
                ●
              </button>
            )}
            {VERTEX_TYPES.has(type) &&
              (editing ? (
                <button className="active" onClick={() => state().endMeshEdit()}>
                  Done
                </button>
              ) : (
                <button
                  title="Edit vertices in the viewport (Esc to finish)"
                  onClick={() => state().startMeshEdit(slotName, name)}
                >
                  Edit
                </button>
              ))}
            <button
              title="Remove attachment"
              onClick={() => state().execute(new RemoveSkinAttachment('default', slotName, name))}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="attachment-actions">
        <button onClick={() => addAttachment('boundingbox')}>+ Bounding Box</button>
        <button onClick={() => addAttachment('point')}>+ Point</button>
        <button
          title="Composite bezier spline (target it with a path constraint)"
          onClick={() => addAttachment('path')}
        >
          + Path
        </button>
        <button
          title="Adds a clipping slot just before this slot in the draw order"
          onClick={addClippingSlot}
        >
          + Clipping
        </button>
      </div>
      {Object.entries(bySlot).map(([name, att]) =>
        att.type === 'clipping' ? (
          <ClippingFields key={name} slotName={slotName} attName={name} att={att} />
        ) : att.type === 'point' ? (
          <PointFields key={name} slotName={slotName} attName={name} att={att} />
        ) : null,
      )}
      {meshEdit?.slot === slotName && (
        <WeightsSection slotName={slotName} attName={meshEdit.attachment} />
      )}
    </>
  );
}

/** End-slot picker for a clipping attachment (clipping stops after that slot). */
function ClippingFields({
  slotName,
  attName,
  att,
}: {
  slotName: string;
  attName: string;
  att: SpineClippingAttachment;
}) {
  const doc = useEditor((s) => s.doc);
  return (
    <label className="field">
      <span>{attName} ends at</span>
      <select
        value={att.end ?? ''}
        onChange={(e) =>
          useEditor
            .getState()
            .execute(
              new AddSkinAttachment(
                'default',
                slotName,
                attName,
                { ...att, end: e.target.value || undefined },
                true,
              ),
            )
        }
      >
        <option value="">— last slot —</option>
        {doc.data.slots.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Position/rotation fields for a point attachment. */
function PointFields({
  slotName,
  attName,
  att,
}: {
  slotName: string;
  attName: string;
  att: SpinePointAttachment;
}) {
  const patch = (p: Partial<SpinePointAttachment>) =>
    useEditor
      .getState()
      .execute(new AddSkinAttachment('default', slotName, attName, { ...att, ...p }, true));
  return (
    <>
      <div className="panel-title">{attName}</div>
      <NumField label="X" value={att.x ?? 0} onCommit={(x) => patch({ x })} />
      <NumField label="Y" value={att.y ?? 0} onCommit={(y) => patch({ y })} />
      <NumField
        label="Rotation"
        value={att.rotation ?? 0}
        onCommit={(rotation) => patch({ rotation })}
      />
    </>
  );
}

function SlotProperties({ name }: { name: string }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  void revision;
  const slot = doc.findSlot(name);
  if (!slot) return null;

  return (
    <>
      <div className="panel-title">Slot</div>
      <label className="field">
        <span>Name</span>
        <input value={slot.name} disabled />
      </label>
      <label className="field">
        <span>Bone</span>
        <select
          value={slot.bone}
          onChange={(e) =>
            useEditor.getState().execute(new SetSlotProperties(name, { bone: e.target.value }))
          }
        >
          {doc.data.bones.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Blend</span>
        <select
          value={slot.blend}
          onChange={(e) =>
            useEditor
              .getState()
              .execute(new SetSlotProperties(name, { blend: e.target.value as SpineBlendMode }))
          }
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Attachment</span>
        <input value={slot.attachment ?? ''} disabled />
      </label>
      <AttachmentsSection slotName={name} />
      <button className="danger" onClick={() => useEditor.getState().removeSlotCascade(name)}>
        Delete Slot
      </button>
    </>
  );
}

export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  const layout = useEditor((s) => s.layout);
  const primary = primarySelection(selection);
  const extraCount = selection.length > 1 ? selection.length - 1 : 0;
  return (
    <div className="panel properties" style={{ width: layout.propertiesWidth }}>
      {!primary && <div className="empty">Select a bone or slot to edit its properties.</div>}
      {extraCount > 0 && <div className="selection-count">+{extraCount} more selected</div>}
      {primary?.kind === 'bone' && <BoneProperties name={primary.name} />}
      {primary?.kind === 'slot' && <SlotProperties name={primary.name} />}
    </div>
  );
}
