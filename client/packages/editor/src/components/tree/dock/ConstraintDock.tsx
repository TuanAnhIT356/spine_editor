import {
  RemoveIkConstraint,
  RemovePathConstraint,
  RemovePhysicsConstraint,
  RemoveTransformConstraint,
  SetIkConstraintProperties,
  SetPathConstraintProperties,
  SetPhysicsConstraintProperties,
  SetTransformConstraintProperties,
  type Command,
} from '@spine-editor/core';
import { useEditor } from '../../../state/store.js';
import { NumField } from './fields.js';

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function BoneSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const doc = useEditor((s) => s.doc);
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {doc.data.bones.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ModeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Spine-style editors for the four constraint types (Phase 16b). */
export function ConstraintDock({
  kind,
  name,
}: {
  kind: 'ik' | 'transform' | 'path' | 'physics';
  name: string;
}) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  void revision;
  const exec = (cmd: Command) => useEditor.getState().execute(cmd);
  const del = (cmd: Command) => {
    if (exec(cmd)) useEditor.getState().select(null);
  };

  if (kind === 'ik') {
    const c = doc.data.ik.find((x) => x.name === name);
    if (!c) return null;
    const patch = (p: object) => exec(new SetIkConstraintProperties(name, p));
    return (
      <>
        <div className="panel-title">IK Constraint: {name}</div>
        <BoneSelect label="Target" value={c.target} onChange={(target) => patch({ target })} />
        <label className="field">
          <span>Bones</span>
          <input value={c.bones.join(', ')} disabled />
        </label>
        <Check
          label="Positive"
          value={c.bendPositive}
          onChange={(bendPositive) => patch({ bendPositive })}
        />
        <Check label="Stretch" value={c.stretch} onChange={(stretch) => patch({ stretch })} />
        <Check label="Compress" value={c.compress} onChange={(compress) => patch({ compress })} />
        <NumField
          label="Softness"
          value={c.softness}
          onCommit={(softness) => patch({ softness })}
        />
        <NumField label="Mix" value={c.mix} onCommit={(mix) => patch({ mix })} />
        <button className="danger" onClick={() => del(new RemoveIkConstraint(name))}>
          Delete Constraint
        </button>
      </>
    );
  }

  if (kind === 'transform') {
    const c = doc.data.transform.find((x) => x.name === name);
    if (!c) return null;
    const patch = (p: object) => exec(new SetTransformConstraintProperties(name, p));
    return (
      <>
        <div className="panel-title">Transform Constraint: {name}</div>
        <BoneSelect label="Target" value={c.target} onChange={(target) => patch({ target })} />
        <label className="field">
          <span>Bones</span>
          <input value={c.bones.join(', ')} disabled />
        </label>
        <NumField
          label="Rotation"
          value={c.rotation}
          onCommit={(rotation) => patch({ rotation })}
        />
        <NumField label="X" value={c.x} onCommit={(x) => patch({ x })} />
        <NumField label="Y" value={c.y} onCommit={(y) => patch({ y })} />
        <NumField label="Scale X" value={c.scaleX} onCommit={(scaleX) => patch({ scaleX })} />
        <NumField label="Scale Y" value={c.scaleY} onCommit={(scaleY) => patch({ scaleY })} />
        <NumField
          label="Mix Rotate"
          value={c.mixRotate}
          onCommit={(mixRotate) => patch({ mixRotate })}
        />
        <NumField label="Mix X" value={c.mixX} onCommit={(mixX) => patch({ mixX })} />
        <NumField label="Mix Y" value={c.mixY} onCommit={(mixY) => patch({ mixY })} />
        <NumField
          label="Mix Scale X"
          value={c.mixScaleX}
          onCommit={(mixScaleX) => patch({ mixScaleX })}
        />
        <NumField
          label="Mix Scale Y"
          value={c.mixScaleY}
          onCommit={(mixScaleY) => patch({ mixScaleY })}
        />
        <Check label="Local" value={c.local} onChange={(local) => patch({ local })} />
        <Check label="Relative" value={c.relative} onChange={(relative) => patch({ relative })} />
        <button className="danger" onClick={() => del(new RemoveTransformConstraint(name))}>
          Delete Constraint
        </button>
      </>
    );
  }

  if (kind === 'path') {
    const c = doc.data.path.find((x) => x.name === name);
    if (!c) return null;
    const patch = (p: object) => exec(new SetPathConstraintProperties(name, p));
    return (
      <>
        <div className="panel-title">Path Constraint: {name}</div>
        <label className="field">
          <span>Target</span>
          <select value={c.target} onChange={(e) => patch({ target: e.target.value })}>
            {doc.data.slots.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Bones</span>
          <input value={c.bones.join(', ')} disabled />
        </label>
        <ModeSelect
          label="Position Mode"
          value={c.positionMode ?? 'percent'}
          options={['fixed', 'percent']}
          onChange={(positionMode) => patch({ positionMode })}
        />
        <ModeSelect
          label="Spacing Mode"
          value={c.spacingMode ?? 'length'}
          options={['length', 'fixed', 'percent', 'proportional']}
          onChange={(spacingMode) => patch({ spacingMode })}
        />
        <ModeSelect
          label="Rotate Mode"
          value={c.rotateMode ?? 'tangent'}
          options={['tangent', 'chain', 'chainScale']}
          onChange={(rotateMode) => patch({ rotateMode })}
        />
        <NumField
          label="Position"
          value={c.position ?? 0}
          onCommit={(position) => patch({ position })}
        />
        <NumField
          label="Spacing"
          value={c.spacing ?? 0}
          onCommit={(spacing) => patch({ spacing })}
        />
        <NumField
          label="Rotation"
          value={c.rotation ?? 0}
          onCommit={(rotation) => patch({ rotation })}
        />
        <NumField
          label="Mix Rotate"
          value={c.mixRotate ?? 1}
          onCommit={(mixRotate) => patch({ mixRotate })}
        />
        <NumField label="Mix X" value={c.mixX ?? 1} onCommit={(mixX) => patch({ mixX })} />
        <NumField label="Mix Y" value={c.mixY ?? 1} onCommit={(mixY) => patch({ mixY })} />
        <button className="danger" onClick={() => del(new RemovePathConstraint(name))}>
          Delete Constraint
        </button>
      </>
    );
  }

  const c = doc.data.physics.find((x) => x.name === name);
  if (!c) return null;
  const patch = (p: object) => exec(new SetPhysicsConstraintProperties(name, p));
  return (
    <>
      <div className="panel-title">Physics Constraint: {name}</div>
      <label className="field">
        <span>Bone</span>
        <input value={c.bone} disabled />
      </label>
      <NumField label="X" value={c.x ?? 0} onCommit={(x) => patch({ x })} />
      <NumField label="Y" value={c.y ?? 0} onCommit={(y) => patch({ y })} />
      <NumField label="Rotate" value={c.rotate ?? 0} onCommit={(rotate) => patch({ rotate })} />
      <NumField label="Scale X" value={c.scaleX ?? 0} onCommit={(scaleX) => patch({ scaleX })} />
      <NumField label="Shear X" value={c.shearX ?? 0} onCommit={(shearX) => patch({ shearX })} />
      <NumField label="Inertia" value={c.inertia ?? 1} onCommit={(inertia) => patch({ inertia })} />
      <NumField
        label="Strength"
        value={c.strength ?? 100}
        onCommit={(strength) => patch({ strength })}
      />
      <NumField label="Damping" value={c.damping ?? 1} onCommit={(damping) => patch({ damping })} />
      <NumField label="Mass" value={c.mass ?? 1} onCommit={(mass) => patch({ mass })} />
      <NumField label="Wind" value={c.wind ?? 0} onCommit={(wind) => patch({ wind })} />
      <NumField label="Gravity" value={c.gravity ?? 0} onCommit={(gravity) => patch({ gravity })} />
      <NumField label="Limit" value={c.limit ?? 5000} onCommit={(limit) => patch({ limit })} />
      <NumField label="Mix" value={c.mix ?? 1} onCommit={(mix) => patch({ mix })} />
      <button className="danger" onClick={() => del(new RemovePhysicsConstraint(name))}>
        Delete Constraint
      </button>
    </>
  );
}
