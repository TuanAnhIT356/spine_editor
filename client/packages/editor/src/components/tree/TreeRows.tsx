import { ReparentBone } from '@spine-editor/core';
import { isSelected, useEditor } from '../../state/store.js';
import {
  BBoxIcon,
  BoneIcon,
  ClipIcon,
  CurveIcon,
  ImageIcon,
  MeshIcon,
  PointIcon,
  SlotIcon,
} from '../icons.js';
import { clickSelect, moveSlotInDrawOrder } from './tree-actions.js';

const ATT_ICONS: Record<string, (p: { size?: number }) => React.JSX.Element> = {
  region: ImageIcon,
  mesh: MeshIcon,
  boundingbox: BBoxIcon,
  point: PointIcon,
  clipping: ClipIcon,
  path: CurveIcon,
};

function VisDot({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      className={`vis-dot ${hidden ? 'off' : ''}`}
      title={hidden ? 'Show in viewport' : 'Hide in viewport'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    />
  );
}

/** The skeleton tree: bones nesting slots nesting attachments (Spine layout). */
export function TreeRows({
  query,
  show,
}: {
  query: string;
  show: { slots: boolean; attachments: boolean; constraints: boolean };
}) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const hiddenBones = useEditor((s) => s.hiddenBones);
  const hiddenSlots = useEditor((s) => s.hiddenSlots);
  void revision;

  const bones = doc.data.bones;
  const slots = doc.data.slots;
  const defaultAtts = doc.data.skins.find((s) => s.name === 'default')?.attachments ?? {};
  const childrenOf = (parent: string) => bones.filter((b) => b.parent === parent);
  const roots = bones.filter((b) => b.parent === null);

  function boneTint(name: string): string {
    const color = bones.find((b) => b.name === name)?.color;
    return color ? `#${color.slice(0, 6)}` : 'var(--warn)';
  }

  function AttachmentRows({ slotName, depth }: { slotName: string; depth: number }) {
    if (!show.attachments) return null;
    const bySlot = defaultAtts[slotName] ?? {};
    return (
      <>
        {Object.entries(bySlot).map(([attName, att]) => {
          const type = (att as { type?: string }).type ?? 'region';
          const Icon = ATT_ICONS[type] ?? ImageIcon;
          return (
            <div
              key={attName}
              className="row attachment"
              style={{ paddingLeft: 8 + depth * 14 }}
              title={type}
              onClick={(e) => clickSelect(e, { kind: 'slot', name: slotName })}
            >
              <span className="type-icon">
                <Icon size={12} />
              </span>
              {attName}
            </div>
          );
        })}
      </>
    );
  }

  function BoneRow({ name, depth }: { name: string; depth: number }) {
    const selected = isSelected(selection, 'bone', name);
    const boneSlots = slots
      .map((s, index) => ({ slot: s, index }))
      .filter(({ slot }) => slot.bone === name);
    return (
      <>
        <div
          className={`row bone ${selected ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={name !== 'root'}
          onClick={(e) => clickSelect(e, { kind: 'bone', name })}
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
          <VisDot
            hidden={hiddenBones.includes(name)}
            onToggle={() => useEditor.getState().toggleBoneHidden(name)}
          />
          <span className="type-icon" style={{ color: boneTint(name) }}>
            <BoneIcon size={12} />
          </span>
          {name}
        </div>
        {show.slots &&
          boneSlots.map(({ slot, index }) => {
            const slotSelected = isSelected(selection, 'slot', slot.name);
            return (
              <div key={slot.name}>
                <div
                  className={`row slot ${slotSelected ? 'selected' : ''}`}
                  style={{ paddingLeft: 22 + depth * 14 }}
                  onClick={(e) => clickSelect(e, { kind: 'slot', name: slot.name })}
                >
                  <VisDot
                    hidden={hiddenSlots.includes(slot.name)}
                    onToggle={() => useEditor.getState().toggleSlotHidden(slot.name)}
                  />
                  <span className="type-icon">
                    <SlotIcon size={12} />
                  </span>
                  {slot.name}
                  {slotSelected && (
                    <span className="row-actions">
                      <button
                        title="Draw behind (earlier in draw order; keys draw order in animate mode)"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSlotInDrawOrder(slot.name, -1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        title="Draw in front (later in draw order; keys draw order in animate mode)"
                        disabled={index === slots.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSlotInDrawOrder(slot.name, 1);
                        }}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                </div>
                <AttachmentRows slotName={slot.name} depth={depth + 2.4} />
              </div>
            );
          })}
        {childrenOf(name).map((child) => (
          <BoneRow key={child.name} name={child.name} depth={depth + 1} />
        ))}
      </>
    );
  }

  const matchedBones = query ? bones.filter((b) => b.name.toLowerCase().includes(query)) : [];
  const matchedSlots = query ? slots.filter((s) => s.name.toLowerCase().includes(query)) : [];

  return (
    <>
      {!query && roots.map((b) => <BoneRow key={b.name} name={b.name} depth={1} />)}
      {query && matchedBones.length === 0 && matchedSlots.length === 0 && (
        <div className="empty">No bones or slots match “{query}”.</div>
      )}
      {query &&
        matchedBones.map((b) => (
          <div
            key={b.name}
            className={`row bone ${isSelected(selection, 'bone', b.name) ? 'selected' : ''}`}
            style={{ paddingLeft: 8 }}
            onClick={(e) => clickSelect(e, { kind: 'bone', name: b.name })}
          >
            <span className="type-icon" style={{ color: boneTint(b.name) }}>
              <BoneIcon size={12} />
            </span>
            {b.name}
          </div>
        ))}
      {query &&
        matchedSlots.map((s) => (
          <div
            key={s.name}
            className={`row slot ${isSelected(selection, 'slot', s.name) ? 'selected' : ''}`}
            style={{ paddingLeft: 8 }}
            onClick={(e) => clickSelect(e, { kind: 'slot', name: s.name })}
          >
            <span className="type-icon">
              <SlotIcon size={12} />
            </span>
            {s.name}
          </div>
        ))}
    </>
  );
}
