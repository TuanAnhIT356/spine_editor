import { useEffect, useRef, useState } from 'react';
import { AddSkinAttachment, AddSlot, Composite, createSlot } from '@spine-editor/core';
import {
  segmentBackends,
  segmentParts,
  segmentPose,
  segmentRemoveBg,
  type SegBackendInfo,
  type SegPartCut,
  type SegPartPrompt,
} from '../server/api.js';
import { uniqueName, useEditor, type ImageAsset } from '../state/store.js';

interface ReviewPart {
  prompt: SegPartPrompt;
  cut: SegPartCut | null;
  visible: boolean;
}

const COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#bcf60c',
  '#fabebe',
  '#008080',
];

export function SegmentModal({ onClose }: { onClose: () => void }) {
  const assets = useEditor((s) => s.assets);
  const [sourceName, setSourceName] = useState('');
  const [image, setImage] = useState(''); // current working dataURL
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [beforeBg, setBeforeBg] = useState(''); // one-step undo for Remove BG
  const [backends, setBackends] = useState<SegBackendInfo[]>([]);
  const [backend, setBackend] = useState('mock');
  const [parts, setParts] = useState<ReviewPart[]>([]);
  const [selected, setSelected] = useState(0);
  const [placeOnCanvas, setPlaceOnCanvas] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    segmentBackends()
      .then((list) => {
        setBackends(list);
        const fal = list.find((b) => b.name === 'fal' && b.has_key);
        setBackend(fal ? 'fal' : 'mock');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function loadFrom(dataUrl: string) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    setImage(dataUrl);
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    setParts([]);
  }

  function pickAsset(name: string) {
    setSourceName(name);
    setBeforeBg('');
    const a = assets[name];
    if (a) void loadFrom(a.dataUrl);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSourceName(file.name.replace(/\.[a-z]+$/i, ''));
    setBeforeBg('');
    const reader = new FileReader();
    reader.onload = () => void loadFrom(String(reader.result));
    reader.readAsDataURL(file);
  }

  // redraw canvas: image + part overlays + prompt points
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !imgSize) return;
    const scale = Math.min(1, 420 / imgSize.w, 420 / imgSize.h);
    canvas.width = Math.max(1, Math.round(imgSize.w * scale));
    canvas.height = Math.max(1, Math.round(imgSize.h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.src = image;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      parts.forEach((p, i) => {
        if (!p.visible) return;
        const color = COLORS[i % COLORS.length] ?? '#e6194b';
        ctx.strokeStyle = color;
        ctx.fillStyle = color + '44';
        const r = p.cut;
        const box = r ? { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height } : p.prompt.box;
        if (box) {
          ctx.fillRect(
            box.x0 * scale,
            box.y0 * scale,
            (box.x1 - box.x0) * scale,
            (box.y1 - box.y0) * scale,
          );
          ctx.strokeRect(
            box.x0 * scale,
            box.y0 * scale,
            (box.x1 - box.x0) * scale,
            (box.y1 - box.y0) * scale,
          );
        }
        for (const pt of p.prompt.points) {
          ctx.fillStyle = pt.label === 1 ? '#2e7d32' : '#c62828';
          ctx.beginPath();
          ctx.arc(pt.x * scale, pt.y * scale, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    };
  }, [image, imgSize, parts]);

  function canvasPoint(e: React.MouseEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas || !imgSize) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / imgSize.w;
    return {
      x: Math.round((e.clientX - rect.left) / scale),
      y: Math.round((e.clientY - rect.top) / scale),
    };
  }

  function addPoint(e: React.MouseEvent) {
    const pt = canvasPoint(e);
    const part = parts[selected];
    if (!pt || !part) return;
    const label = e.altKey ? 0 : 1;
    const next = [...parts];
    next[selected] = {
      ...part,
      prompt: { ...part.prompt, points: [...part.prompt.points, { ...pt, label }] },
    };
    setParts(next);
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const onRemoveBg = () =>
    run(async () => {
      const previous = image;
      const res = await segmentRemoveBg(image);
      await loadFrom(res.image);
      setBeforeBg(previous);
    });

  const onDetect = () =>
    run(async () => {
      const [res, pose] = [await segmentParts(image, backend), await segmentPose(image)];
      const prompts = new Map(pose.parts.map((p) => [p.name, p]));
      setParts(
        res.parts.map((cut) => ({
          prompt: prompts.get(cut.name) ?? { name: cut.name, points: [] },
          cut,
          visible: true,
        })),
      );
      setSelected(0);
    });

  const onRerunPart = (index: number) =>
    run(async () => {
      const part = parts[index];
      if (!part) return;
      const res = await segmentParts(image, backend, [part.prompt]);
      const next = [...parts];
      next[index] = { ...part, cut: res.parts[0] ?? null };
      setParts(next);
    });

  function onImport() {
    if (!imgSize) return;
    const state = useEditor.getState();
    const newAssets: ImageAsset[] = [];
    const commands = [];
    for (const part of parts) {
      if (!part.cut) continue;
      const cut = part.cut;
      let name = part.prompt.name;
      let n = 2;
      while (state.assets[name] || newAssets.some((a) => a.name === name)) {
        name = `${part.prompt.name}-${n++}`;
      }
      newAssets.push({
        name,
        dataUrl: cut.image,
        width: cut.width,
        height: cut.height,
        origin: { x: cut.x, y: cut.y, sourceWidth: imgSize.w, sourceHeight: imgSize.h },
      });
      if (placeOnCanvas) {
        const slotName = uniqueName(name, (s) => state.doc.data.slots.some((sl) => sl.name === s));
        commands.push(new AddSlot(createSlot(slotName, 'root', { attachment: name })));
        commands.push(
          new AddSkinAttachment('default', slotName, name, {
            x: cut.x + cut.width / 2 - imgSize.w / 2,
            y: imgSize.h / 2 - (cut.y + cut.height / 2),
            width: cut.width,
            height: cut.height,
          }),
        );
      }
    }
    if (newAssets.length === 0) {
      setError('No parts to import');
      return;
    }
    state.addAssets(newAssets);
    if (commands.length > 0) {
      state.execute(new Composite('Import segmented parts', commands));
    }
    setNotice(`Imported ${newAssets.length} parts${placeOnCanvas ? ' onto the canvas' : ''}.`);
  }

  const selectedBackend = backends.find((b) => b.name === backend);

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div
        className="shortcuts-panel server-modal generate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-title">Segment character (AI)</div>
        <div className="gen-options">
          <select value={sourceName} onChange={(e) => pickAsset(e.target.value)}>
            <option value="">— pick an imported image —</option>
            {Object.keys(assets).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <input type="file" accept="image/png,image/webp,image/jpeg" onChange={onFile} />
        </div>
        {image && (
          <>
            <div className="gen-options">
              <button disabled={busy} onClick={() => void onRemoveBg()}>
                Remove BG
              </button>
              {beforeBg && (
                <button
                  disabled={busy}
                  onClick={() => {
                    void loadFrom(beforeBg);
                    setBeforeBg('');
                  }}
                >
                  Undo BG
                </button>
              )}
              <select value={backend} onChange={(e) => setBackend(e.target.value)}>
                {backends.map((b) => (
                  <option key={b.name} value={b.name} disabled={!b.has_key}>
                    {b.name}
                    {b.has_key ? '' : ' (no key)'}
                  </option>
                ))}
              </select>
              <button disabled={busy} onClick={() => void onDetect()}>
                {busy ? 'Working…' : 'Detect parts'}
              </button>
            </div>
            {selectedBackend && (
              <div className="gen-estimate">
                {selectedBackend.name === 'mock'
                  ? 'mock: free box masks (no AI call) — for trying the flow'
                  : `~$${(selectedBackend.approx_cost_usd * 10).toFixed(2)} for ~10 parts, billed to your fal key`}
              </div>
            )}
            <div className="segment-layout">
              <canvas
                ref={canvasRef}
                className="segment-canvas"
                title="Click: add foreground point to selected part · Alt+click: background point"
                onClick={addPoint}
              />
              {parts.length > 0 && (
                <div className="segment-parts">
                  {parts.map((p, i) => (
                    <div key={i} className={`key-row${i === selected ? ' selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={p.visible}
                        onChange={() => {
                          const next = [...parts];
                          next[i] = { ...p, visible: !p.visible };
                          setParts(next);
                        }}
                      />
                      <input
                        value={p.prompt.name}
                        onFocus={() => setSelected(i)}
                        onChange={(e) => {
                          const next = [...parts];
                          next[i] = { ...p, prompt: { ...p.prompt, name: e.target.value } };
                          setParts(next);
                        }}
                      />
                      <button
                        disabled={busy}
                        title="Re-run this part"
                        onClick={() => void onRerunPart(i)}
                      >
                        ↻
                      </button>
                      <button
                        disabled={busy}
                        title="Remove part"
                        onClick={() => setParts(parts.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {parts.length > 0 && (
              <div className="gen-options">
                <label className="row-inline">
                  <input
                    type="checkbox"
                    checked={placeOnCanvas}
                    onChange={(e) => setPlaceOnCanvas(e.target.checked)}
                  />
                  Place on canvas
                </label>
                <button disabled={busy} onClick={onImport}>
                  Import parts
                </button>
              </div>
            )}
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}
        <button className="close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
