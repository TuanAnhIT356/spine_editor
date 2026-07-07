import {
  RemoveBone,
  RenameBone,
  SetBoneTransform,
  SetSlotProperties,
  type BoneTransformPatch,
  type SpineBlendMode,
} from '@spine-editor/core';
import { useEffect, useState } from 'react';
import { useEditor } from '../state/store.js';

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
      <button className="danger" onClick={() => useEditor.getState().removeSlotCascade(name)}>
        Delete Slot
      </button>
    </>
  );
}

export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  return (
    <div className="panel properties">
      {!selection && <div className="empty">Select a bone or slot to edit its properties.</div>}
      {selection?.kind === 'bone' && <BoneProperties name={selection.name} />}
      {selection?.kind === 'slot' && <SlotProperties name={selection.name} />}
    </div>
  );
}
