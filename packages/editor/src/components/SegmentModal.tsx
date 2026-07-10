import { useMemo, useState } from 'react';
import { removeBackground, splitParts, type SplitPart } from '../server/api.js';
import { useEditor, type ImageAsset } from '../state/store.js';

async function toAsset(name: string, dataUrl: string): Promise<ImageAsset> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { name, dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}

interface PartRow extends SplitPart {
  selected: boolean;
}

export function SegmentModal({ onClose }: { onClose: () => void }) {
  const assets = useEditor((s) => s.assets);
  const names = useMemo(() => Object.keys(assets), [assets]);
  const [source, setSource] = useState(names[0] ?? '');
  const [bgProvider, setBgProvider] = useState('none'); // none | local | rembg | fal
  const [keepPlacement, setKeepPlacement] = useState(true);
  const [minArea, setMinArea] = useState(64);
  const [working, setWorking] = useState<string | null>(null); // preview after remove-bg
  const [parts, setParts] = useState<PartRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function onSplit() {
    const asset = assets[source];
    if (!asset) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let image = asset.dataUrl;
      if (bgProvider !== 'none') {
        image = (await removeBackground(image, bgProvider)).data_url;
        setWorking(image);
      }
      const result = await splitParts(image, minArea, !keepPlacement);
      setParts(result.parts.map((p) => ({ ...p, selected: true })));
      if (result.parts.length === 0) {
        setNotice('No parts found — try removing the background first or lower min area.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    const chosen = parts.filter((p) => p.selected);
    const state = useEditor.getState();
    const imported: ImageAsset[] = [];
    for (const part of chosen) {
      let name = `${source}-${part.name}`;
      let n = 2;
      while (state.assets[name] || imported.some((a) => a.name === name)) {
        name = `${source}-${part.name}-${n++}`;
      }
      imported.push(await toAsset(name, part.data_url));
    }
    state.addAssets(imported);
    setNotice(
      `Imported ${imported.length} part(s)${keepPlacement ? ' (full-canvas: attach them all to one bone to keep the layout)' : ''}.`,
    );
  }

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div
        className="shortcuts-panel server-modal generate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-title">Split Image into Parts</div>
        {names.length === 0 && (
          <div className="empty">Import or generate an image first, then split it here.</div>
        )}
        <div className="gen-options">
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <select
            value={bgProvider}
            title="Remove the background before splitting"
            onChange={(e) => setBgProvider(e.target.value)}
          >
            <option value="none">bg: keep</option>
            <option value="local">bg: remove (local, flat backdrops)</option>
            <option value="rembg">bg: remove (rembg, if installed)</option>
            <option value="fal">bg: remove (fal.ai, needs key)</option>
          </select>
          <label className="row-inline" title="Smaller islands are ignored">
            min area
            <input
              type="number"
              min={1}
              value={minArea}
              style={{ width: 64 }}
              onChange={(e) => setMinArea(Number(e.target.value) || 64)}
            />
          </label>
          <button disabled={busy || !source} onClick={() => void onSplit()}>
            {busy ? 'Splitting…' : 'Split'}
          </button>
        </div>
        <label
          className="row-inline"
          title="Parts keep the full canvas size so attaching them all to one bone reproduces the original layout"
        >
          <input
            type="checkbox"
            checked={keepPlacement}
            onChange={(e) => setKeepPlacement(e.target.checked)}
          />
          Keep original placement (uncropped parts)
        </label>
        {working && bgProvider !== 'none' && (
          <div className="gen-result">
            <img src={working} alt="after background removal" />
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}
        {parts.length > 0 && (
          <>
            <div className="panel-title">Parts ({parts.length})</div>
            <div className="projects-list">
              {parts.map((part, index) => (
                <div key={index} className="project-row">
                  <input
                    type="checkbox"
                    checked={part.selected}
                    onChange={(e) =>
                      setParts((all) =>
                        all.map((p, i) => (i === index ? { ...p, selected: e.target.checked } : p)),
                      )
                    }
                  />
                  <img src={part.data_url} alt={part.name} />
                  <input
                    className="part-name"
                    value={part.name}
                    onChange={(e) =>
                      setParts((all) =>
                        all.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)),
                      )
                    }
                  />
                  <span className="project-date">
                    {part.width}×{part.height} @ {part.x},{part.y}
                  </span>
                </div>
              ))}
            </div>
            <button
              disabled={busy || parts.every((p) => !p.selected)}
              onClick={() => void onImport()}
            >
              Import selected parts
            </button>
          </>
        )}
        <button className="close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
