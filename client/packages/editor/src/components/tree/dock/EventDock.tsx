import { RemoveEventDef, SetEventDef } from '@spine-editor/core';
import { useEditor } from '../../../state/store.js';
import { NumField } from './fields.js';

/** Event definition editor (defaults for keyed events). */
export function EventDock({ name }: { name: string }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const audioAssets = useEditor((s) => s.audioAssets);
  void revision;
  const def = doc.data.events[name];
  if (!def) return null;
  const patch = (p: Partial<typeof def>) =>
    useEditor.getState().execute(new SetEventDef(name, { ...def, ...p }));
  return (
    <>
      <div className="panel-title">Event: {name}</div>
      <NumField label="Int" value={def.int ?? 0} onCommit={(int) => patch({ int })} />
      <NumField label="Float" value={def.float ?? 0} onCommit={(float) => patch({ float })} />
      <label className="field">
        <span>String</span>
        <input
          defaultValue={def.string ?? ''}
          onBlur={(e) => patch({ string: e.target.value || undefined })}
        />
      </label>
      <label className="field">
        <span>Audio</span>
        <select
          value={def.audio ?? ''}
          onChange={(e) => patch({ audio: e.target.value || undefined })}
        >
          <option value="">— none —</option>
          {Object.keys(audioAssets).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          {def.audio && !(def.audio in audioAssets) && (
            <option value={def.audio}>{def.audio} (missing)</option>
          )}
        </select>
      </label>
      <NumField label="Volume" value={def.volume ?? 1} onCommit={(volume) => patch({ volume })} />
      <NumField
        label="Balance"
        value={def.balance ?? 0}
        onCommit={(balance) => patch({ balance })}
      />
      <button
        className="danger"
        onClick={() => {
          if (useEditor.getState().execute(new RemoveEventDef(name))) {
            useEditor.getState().select(null);
          }
        }}
      >
        Delete Event
      </button>
    </>
  );
}
