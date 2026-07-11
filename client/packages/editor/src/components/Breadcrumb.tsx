import { primarySelection, useEditor } from '../state/store.js';

/** root ▸ hip ▸ tail1 ▸ … chain of the primary selected bone; click = select. */
export function Breadcrumb() {
  const selection = useEditor((s) => s.selection);
  const revision = useEditor((s) => s.revision);
  void revision;
  const primary = primarySelection(selection);
  if (!primary || primary.kind !== 'bone') return null;
  const bones = useEditor.getState().doc.data.bones;
  const byName = new Map(bones.map((b) => [b.name, b]));
  const chain: string[] = [];
  for (let b = byName.get(primary.name); b; b = b.parent ? byName.get(b.parent) : undefined) {
    chain.unshift(b.name);
  }
  return (
    <div className="breadcrumb">
      {chain.map((name, i) => (
        <span key={name}>
          {i > 0 && <span className="crumb-sep">▸</span>}
          <button onClick={() => useEditor.getState().select({ kind: 'bone', name })}>
            {name}
          </button>
        </span>
      ))}
    </div>
  );
}
