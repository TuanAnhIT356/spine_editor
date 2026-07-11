import { useState } from 'react';
import { exportGif } from '../state/gif-export.js';
import { exportPngSequence, exportWebm } from '../state/frame-export.js';
import { useEditor } from '../state/store.js';

type Format = 'gif' | 'webm' | 'png';

/** Format + fps picker for animation exports (GIF / WebM / PNG sequence). */
export function ExportAnimationDialog({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState<Format>('gif');
  const [fps, setFps] = useState(20);
  const [progress, setProgress] = useState<string | null>(null);

  const runExport = () => {
    const onProgress = (f: number, t: number) => setProgress(`Exporting… frame ${f}/${t}`);
    const job =
      format === 'gif'
        ? exportGif(fps, onProgress)
        : format === 'webm'
          ? exportWebm(fps, onProgress)
          : exportPngSequence(fps, onProgress);
    setProgress('Exporting…');
    void job
      .then(onClose)
      .catch((err) =>
        useEditor.getState().setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setProgress(null));
  };

  return (
    <div className="io-overlay" onClick={progress ? undefined : onClose}>
      <div className="io-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">Export Animation</div>
        <label className="field">
          <span>Format</span>
          <select
            value={format}
            disabled={progress !== null}
            onChange={(e) => {
              const f = e.target.value as Format;
              setFormat(f);
              setFps(f === 'gif' ? 20 : 30);
            }}
          >
            <option value="gif">GIF</option>
            <option value="webm">WebM video</option>
            <option value="png">PNG sequence (zip)</option>
          </select>
        </label>
        <label className="field">
          <span>FPS</span>
          <input
            type="number"
            min={1}
            max={60}
            disabled={progress !== null}
            value={fps}
            onChange={(e) => setFps(Math.max(1, Math.min(60, Math.round(Number(e.target.value)))))}
          />
        </label>
        {progress && <div className="empty">{progress}</div>}
        <div className="io-actions">
          <button disabled={progress !== null} onClick={runExport}>
            Export
          </button>
          <button disabled={progress !== null} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
