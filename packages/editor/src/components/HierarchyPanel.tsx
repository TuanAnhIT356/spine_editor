import { ReorderSlot, ReparentBone } from '@spine-editor/core';
import { useEditor } from '../state/store.js';

export function HierarchyPanel() {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const assets = useEditor((s) => s.assets);
  void revision;

  const bones = doc.data.bones;
  const slots = doc.data.slots;
  const childrenOf = (parent: string) => bones.filter((b) => b.parent === parent);
  const roots = bones.filter((b) => b.parent === null);

  function BoneRow({ name, depth }: { name: string; depth: number }) {
    const selected = selection?.kind === 'bone' && selection.name === name;
    const boneSlots = slots
      .map((s, index) => ({ slot: s, index }))
      .filter(({ slot }) => slot.bone === name);
    return (
      <>
        <div
          className={`row bone ${selected ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={name !== 'root'}
          onClick={() => useEditor.getState().select({ kind: 'bone', name })}
          onDragStart={(e) => e.dataTransfer.setData('text/bone', name)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const dragged = e.dataTransfer.getData('text/bone');
            if (dragged && dragged !== name) {
              useEditor.getState().execute(new ReparentBone(dragged, name));
            }
          }}
        >
          <span className="icon">◆</span> {name}
        </div>
        {boneSlots.map(({ slot, index }) => {
          const slotSelected = selection?.kind === 'slot' && selection.name === slot.name;
          return (
            <div
              key={slot.name}
              className={`row slot ${slotSelected ? 'selected' : ''}`}
              style={{ paddingLeft: 22 + depth * 14 }}
              onClick={() => useEditor.getState().select({ kind: 'slot', name: slot.name })}
            >
              <span className="icon">▣</span> {slot.name}
              {slotSelected && (
                <span className="row-actions">
                  <button
                    title="Draw behind (earlier in draw order)"
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      useEditor.getState().execute(new ReorderSlot(slot.name, index - 1));
                    }}
                  >
                    ↑
                  </button>
                  <button
                    title="Draw in front (later in draw order)"
                    disabled={index === slots.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      useEditor.getState().execute(new ReorderSlot(slot.name, index + 1));
                    }}
                  >
                    ↓
                  </button>
                </span>
              )}
            </div>
          );
        })}
        {childrenOf(name).map((child) => (
          <BoneRow key={child.name} name={child.name} depth={depth + 1} />
        ))}
      </>
    );
  }

  const selectedBone = selection?.kind === 'bone' ? selection.name : null;

  return (
    <div className="panel hierarchy">
      <div className="panel-title">Hierarchy</div>
      <div className="tree">
        {roots.map((b) => (
          <BoneRow key={b.name} name={b.name} depth={0} />
        ))}
      </div>
      <div className="panel-title">Images</div>
      <div className="assets">
        {Object.values(assets).length === 0 && (
          <div className="empty">Import images, then attach them to a selected bone.</div>
        )}
        {Object.values(assets).map((asset) => (
          <div key={asset.name} className="asset-row">
            <img src={asset.dataUrl} alt={asset.name} />
            <span className="asset-name" title={`${asset.width}×${asset.height}`}>
              {asset.name}
            </span>
            <button
              disabled={!selectedBone}
              title={selectedBone ? `Attach to bone "${selectedBone}"` : 'Select a bone first'}
              onClick={() =>
                selectedBone && useEditor.getState().attachAsset(asset.name, selectedBone)
              }
            >
              Attach
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
