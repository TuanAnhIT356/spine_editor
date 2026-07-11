import { useState } from 'react';
import { DEFAULT_ATLAS_OPTIONS, type AtlasOptions } from '../state/atlas.js';

const OPTIONS_KEY = 'spine-editor.atlas-options';

export function loadAtlasOptions(): AtlasOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (!raw) return DEFAULT_ATLAS_OPTIONS;
    const parsed = JSON.parse(raw) as Partial<AtlasOptions>;
    return {
      padding: typeof parsed.padding === 'number' ? Math.max(0, Math.min(16, parsed.padding)) : 2,
      maxSize: parsed.maxSize === 1024 || parsed.maxSize === 4096 ? parsed.maxSize : 2048,
      powerOfTwo: parsed.powerOfTwo === true,
      trim: parsed.trim === true,
    };
  } catch {
    return DEFAULT_ATLAS_OPTIONS;
  }
}

/** Texture-packer settings collected before exporting the atlas. */
export function AtlasDialog({
  onExport,
  onClose,
}: {
  onExport: (options: AtlasOptions) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<AtlasOptions>(loadAtlasOptions);
  const patch = (p: Partial<AtlasOptions>) => {
    const next = { ...options, ...p };
    setOptions(next);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      /* no storage */
    }
  };
  return (
    <div className="io-overlay" onClick={onClose}>
      <div className="io-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">Export Atlas — Texture Packer</div>
        <label className="field">
          <span>Padding</span>
          <input
            type="number"
            min={0}
            max={16}
            value={options.padding}
            onChange={(e) =>
              patch({ padding: Math.max(0, Math.min(16, Math.round(Number(e.target.value)))) })
            }
          />
        </label>
        <label className="field">
          <span>Max size</span>
          <select
            value={options.maxSize}
            onChange={(e) => patch({ maxSize: Number(e.target.value) as 1024 | 2048 | 4096 })}
          >
            {[1024, 2048, 4096].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Power of two</span>
          <input
            type="checkbox"
            checked={options.powerOfTwo}
            onChange={(e) => patch({ powerOfTwo: e.target.checked })}
          />
        </label>
        <label className="field">
          <span>Trim transparent edges</span>
          <input
            type="checkbox"
            checked={options.trim}
            onChange={(e) => patch({ trim: e.target.checked })}
          />
        </label>
        <div className="io-actions">
          <button onClick={() => onExport(options)}>Export</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
