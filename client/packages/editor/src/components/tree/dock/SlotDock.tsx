import {
  AddSkinAttachment,
  AddSlot,
  Composite,
  RemoveSkinAttachment,
  ReorderSlot,
  SetMeshGeometry,
  SetSlotProperties,
  buildGridMeshAttachment,
  createSlot,
  isWeightedVertices,
  meshVertexCount,
  weldMeshVertices,
  type Command,
  type SpineAttachment,
  type SpineBlendMode,
  type SpineClippingAttachment,
  type SpinePointAttachment,
} from '@spine-editor/core';
import { uniqueName, useEditor } from '../../../state/store.js';
import { NumField } from './fields.js';

const BLEND_MODES: SpineBlendMode[] = ['normal', 'additive', 'multiply', 'screen'];

const VERTEX_TYPES = new Set(['mesh', 'boundingbox', 'clipping', 'path']);

/** Mode + action row for the mesh being edited (setup-mode geometry tools). */
function MeshToolsRow({ slotName, attName }: { slotName: string; attName: string }) {
  const meshEdit = useEditor((s) => s.meshEdit);
  const mode = useEditor((s) => s.mode);
  const doc = useEditor((s) => s.doc);
  if (!meshEdit) return null;
  const att = doc.data.skins.find((s) => s.name === 'default')?.attachments?.[slotName]?.[attName];
  if (!att || att.type !== 'mesh') return null;
  const setup = mode === 'setup';
  const state = () => useEditor.getState();
  const geometryOf = (m: {
    vertices: number[];
    uvs: number[];
    triangles: number[];
    hull?: number;
  }) => ({
    vertices: m.vertices,
    uvs: m.uvs,
    triangles: m.triangles,
    hull: m.hull ?? m.uvs.length / 2,
  });
  const modes = [
    ['vertices', 'Modify'],
    ['create', 'Create'],
    ['delete', 'Delete'],
    ['weights', 'Weights'],
  ] as const;
  return (
    <div className="mesh-tools">
      {modes.map(([m, label]) => (
        <button
          key={m}
          className={meshEdit.mode === m ? 'active' : ''}
          disabled={!setup && (m === 'create' || m === 'delete')}
          onClick={() => state().setMeshEditMode(m)}
        >
          {label}
        </button>
      ))}
      <button
        disabled={!setup}
        title="Merge vertices closer than 1 unit"
        onClick={() => {
          try {
            const { mesh: welded, merged } = weldMeshVertices(state().doc.data, slotName, att, 1);
            if (merged > 0) {
              state().execute(
                new SetMeshGeometry('default', slotName, attName, geometryOf(welded)),
              );
              state().setError(`Welded ${merged} vertex${merged > 1 ? 'es' : ''}.`);
            }
          } catch (err) {
            state().setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        Weld
      </button>
      <button
        disabled={!setup || !att.width || !att.height}
        title="Replace geometry with a fresh 3×3 grid (clears weights + deform keys)"
        onClick={() => {
          const grid = buildGridMeshAttachment(att.width!, att.height!);
          state().execute(new SetMeshGeometry('default', slotName, attName, geometryOf(grid)));
        }}
      >
        Reset
      </button>
    </div>
  );
}

/** Weights status + shortcut to the floating Weights window. */
function WeightsSection({ slotName, attName }: { slotName: string; attName: string }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const doc = useEditor((s) => s.doc);
  const meshEdit = useEditor((s) => s.meshEdit);
  const att = doc.data.skins.find((s) => s.name === 'default')?.attachments?.[slotName]?.[attName];
  if (!att || att.type !== 'mesh' || !meshEdit) return null;
  const weighted = isWeightedVertices(att.vertices, meshVertexCount(att));
  return (
    <>
      <div className="panel-title">Weights</div>
      <div className="empty">
        {weighted
          ? 'Weighted mesh — use the Weights window to paint and adjust.'
          : 'Unweighted — open the Weights window to bind bones.'}
      </div>
      <button onClick={() => useEditor.getState().setMeshEditMode('weights')}>Weights…</button>
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
        <MeshToolsRow slotName={slotName} attName={meshEdit.attachment} />
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

/** Slot properties form (moved verbatim from PropertiesPanel.SlotProperties). */
export function SlotDock({ name }: { name: string }) {
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
      <button
        title="Open the Color window (setup color + tint black)"
        onClick={() => window.dispatchEvent(new CustomEvent('spine-editor:open-color'))}
      >
        Color…
      </button>
      <AttachmentsSection slotName={name} />
      <button className="danger" onClick={() => useEditor.getState().removeSlotCascade(name)}>
        Delete Slot
      </button>
    </>
  );
}
