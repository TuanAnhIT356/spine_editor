import { useState } from 'react';
import { computeAnimatedLocals } from '@spine-editor/core';
import { primarySelection, useEditor, type Tool } from '../state/store.js';
import { applyBoneEdit, parseNumeric, type BonePatch } from '../state/bone-edit.js';
import {
  CreateIcon,
  CursorIcon,
  EyeIcon,
  KeyIcon,
  RotateIcon,
  ScaleIcon,
  SelectIcon,
  ShearIcon,
  TagIcon,
  TranslateIcon,
} from './icons.js';

const TOOLS: { id: Tool; label: string; icon: () => React.JSX.Element; setupOnly?: boolean }[] = [
  { id: 'select', label: 'Select', icon: () => <SelectIcon /> },
  { id: 'translate', label: 'Translate', icon: () => <TranslateIcon /> },
  { id: 'rotate', label: 'Rotate', icon: () => <RotateIcon /> },
  { id: 'scale', label: 'Scale', icon: () => <ScaleIcon /> },
  { id: 'shear', label: 'Shear', icon: () => <ShearIcon /> },
  { id: 'create', label: 'Create', icon: () => <CreateIcon />, setupOnly: true },
];

/** One numeric field; commits on Enter/blur with +,*,/ prefixes. */
function NumBox({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="num-box"
      value={text ?? value.toFixed(2)}
      onFocus={(e) => {
        setText(value.toFixed(2));
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        if (text !== null) {
          const v = parseNumeric(text, value);
          if (v !== null && Math.abs(v - value) > 1e-9) onCommit(v);
        }
        setText(null);
      }}
    />
  );
}

export function ToolCluster() {
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.mode);
  const axes = useEditor((s) => s.axesMode);
  const filters = useEditor((s) => s.viewFilters);
  const autoKey = useEditor((s) => s.autoKey);
  const selection = useEditor((s) => s.selection);
  const revision = useEditor((s) => s.revision);
  const anim = useEditor((s) => s.anim);
  void revision; // re-render on document changes so the boxes track edits

  const primary = primarySelection(selection);
  const bone = primary?.kind === 'bone' ? useEditor.getState().doc.findBone(primary.name) : null;
  // In animate mode show the ANIMATED locals so the boxes match the on-screen pose.
  const shown = (() => {
    if (!bone) return null;
    if (mode !== 'animate' || !anim.current) return bone;
    const locals = computeAnimatedLocals(useEditor.getState().doc.data, anim.current, anim.time);
    return locals.find((b) => b.name === bone.name) ?? bone;
  })();

  function commit(patch: BonePatch) {
    if (!primary || primary.kind !== 'bone') return;
    applyBoneEdit(primary.name, patch);
  }

  return (
    <div className="tool-cluster">
      <div className="tc-tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'active' : ''}
            disabled={t.setupOnly && mode === 'animate'}
            title={t.label}
            onClick={() => useEditor.getState().setTool(t.id)}
          >
            {t.icon()} {t.label}
          </button>
        ))}
      </div>
      {shown && (
        <div className="tc-transform">
          <div className="tc-row">
            <span className="tc-label">
              <RotateIcon size={12} /> Rotate
            </span>
            <NumBox value={shown.rotation} onCommit={(v) => commit({ rotation: v })} />
            <button
              className="tc-key"
              title="Key current value at the playhead"
              disabled={mode !== 'animate'}
              onClick={() => commit({ rotation: shown.rotation })}
            >
              <KeyIcon size={10} />
            </button>
          </div>
          <div className="tc-row">
            <span className="tc-label">
              <TranslateIcon size={12} /> Translate
            </span>
            <NumBox value={shown.x} onCommit={(v) => commit({ x: v })} />
            <NumBox value={shown.y} onCommit={(v) => commit({ y: v })} />
          </div>
          <div className="tc-row">
            <span className="tc-label">
              <ScaleIcon size={12} /> Scale
            </span>
            <NumBox value={shown.scaleX} onCommit={(v) => commit({ scaleX: v })} />
            <NumBox value={shown.scaleY} onCommit={(v) => commit({ scaleY: v })} />
          </div>
          <div className="tc-row">
            <span className="tc-label">
              <ShearIcon size={12} /> Shear
            </span>
            <NumBox value={shown.shearX} onCommit={(v) => commit({ shearX: v })} />
            <NumBox value={shown.shearY} onCommit={(v) => commit({ shearY: v })} />
          </div>
        </div>
      )}
      <div className="tc-axes">
        {(['local', 'parent', 'world'] as const).map((m) => (
          <button
            key={m}
            className={axes === m ? 'active' : ''}
            onClick={() => useEditor.getState().setAxesMode(m)}
          >
            {m[0]!.toUpperCase() + m.slice(1)}
          </button>
        ))}
        {mode === 'animate' && (
          <button
            className={autoKey ? 'active tc-autokey' : 'tc-autokey'}
            title="Auto Key"
            onClick={() => useEditor.getState().setAutoKey(!autoKey)}
          >
            <KeyIcon /> Auto Key
          </button>
        )}
      </div>
      <div className="tc-filters">
        <div className="tc-filter-head">
          <span />
          <CursorIcon size={11} />
          <EyeIcon size={11} />
          <TagIcon size={11} />
        </div>
        {(['bones', 'images', 'others'] as const).map((g) => (
          <div key={g} className="tc-filter-row">
            <span>{g[0]!.toUpperCase() + g.slice(1)}</span>
            {(['select', 'visible', 'labels'] as const).map((k) => (
              <button
                key={k}
                className={filters[g][k] ? 'dot on' : 'dot'}
                title={`${g} ${k}`}
                onClick={() => useEditor.getState().toggleViewFilter(g, k)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
