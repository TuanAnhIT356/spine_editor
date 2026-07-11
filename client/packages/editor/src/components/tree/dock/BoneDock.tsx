import {
  RemoveBone,
  RenameBone,
  SetBoneTransform,
  type BoneTransformPatch,
} from '@spine-editor/core';
import { useEffect, useState } from 'react';
import { useEditor } from '../../../state/store.js';
import { NumField } from './fields.js';

/** Bone properties form (moved verbatim from PropertiesPanel.BoneProperties). */
export function BoneDock({ name }: { name: string }) {
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
