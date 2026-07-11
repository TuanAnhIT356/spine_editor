import { useEffect, useState } from 'react';
import {
  deleteGalleryImage,
  generateImage,
  generatePartSet,
  getGalleryImage,
  listGallery,
  listProviders,
  type GalleryEntry,
  type GalleryImage,
  type PartSetEntry,
  type ProviderInfo,
} from '../server/api.js';
import { useEditor, type ImageAsset } from '../state/store.js';

/** Wraps a subject prompt into a game-asset prompt (T-pose, flat, clean). */
const GAME_ASSET_TEMPLATE = (subject: string) =>
  `full body 2D game character sprite of ${subject}, T-pose with arms straight out, ` +
  `front view, flat cel shading, clean bold outlines, no background, no text, no watermark, ` +
  `centered, whole body visible`;

async function importAsAsset(image: GalleryImage): Promise<string> {
  const img = new Image();
  img.src = image.data_url;
  await img.decode();
  const state = useEditor.getState();
  const base = image.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  let name = base || `gen-${image.id}`;
  let n = 2;
  while (state.assets[name]) name = `${base}-${n++}`;
  const asset: ImageAsset = {
    name,
    dataUrl: image.data_url,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
  state.addAssets([asset]);
  return name;
}

export function GenerateModal({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [transparent, setTransparent] = useState(true);
  const [template, setTemplate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<GalleryImage | null>(null);
  const [gallery, setGallery] = useState<GalleryEntry[]>([]);
  const [partSet, setPartSet] = useState<PartSetEntry[] | null>(null);

  const selected = providers.find((p) => p.name === provider);

  const reloadGallery = () =>
    listGallery()
      .then(setGallery)
      .catch(() => undefined);

  useEffect(() => {
    listProviders()
      .then((list) => {
        setProviders(list);
        const first = list.find((p) => p.has_key && p.name !== 'mock') ?? list[0];
        if (first) setProvider(first.name);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    void reloadGallery();
  }, []);

  async function onGenerate() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const finalPrompt = template ? GAME_ASSET_TEMPLATE(prompt.trim()) : prompt.trim();
      const image = await generateImage(provider, finalPrompt, size, transparent);
      setResult(image);
      await reloadGallery();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onImport(image: GalleryImage) {
    const name = await importAsAsset(image);
    setNotice(`Imported as image "${name}" — attach it from the Hierarchy panel.`);
  }

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div
        className="shortcuts-panel server-modal generate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-title">Generate Image (AI)</div>
        <textarea
          rows={3}
          placeholder='describe the character or part, e.g. "a brave knight with a red cape"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <label className="row-inline">
          <input
            type="checkbox"
            checked={template}
            onChange={(e) => setTemplate(e.target.checked)}
          />
          Game-asset template (T-pose, flat shading, clean outlines)
        </label>
        <div className="gen-options">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.name} value={p.name} disabled={!p.has_key}>
                {p.name}
                {p.has_key ? '' : ' (no key)'}
              </option>
            ))}
          </select>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            <option>512x512</option>
            <option>1024x1024</option>
            <option>1024x1536</option>
            <option>1536x1024</option>
          </select>
          <label className="row-inline">
            <input
              type="checkbox"
              checked={transparent}
              disabled={selected ? !selected.supports_transparent : false}
              onChange={(e) => setTransparent(e.target.checked)}
            />
            transparent
          </label>
          <button
            disabled={busy || !prompt.trim() || !selected?.has_key}
            onClick={() => void onGenerate()}
          >
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {selected && (
          <div className="gen-estimate">
            {selected.name === 'mock'
              ? 'mock: free local test image (no AI call)'
              : `~$${selected.approx_cost_usd.toFixed(3)} per image, billed to your ${selected.name} key`}
            {selected && !selected.supports_transparent && ' · no transparent background'}
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}
        {result && (
          <div className="gen-result">
            <img src={result.data_url} alt={result.prompt} />
            <button onClick={() => void onImport(result)}>Add to Images</button>
            <button
              disabled={busy || !selected?.supports_edit}
              title={
                selected?.supports_edit
                  ? 'Generate the 10 standard parts from this image (strategy A)'
                  : `${provider} does not support editing`
              }
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const set = await generatePartSet(provider, { reference: result.data_url });
                    setPartSet(set.parts);
                    if (set.warnings.length) setError(set.warnings.join(' · '));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              {busy ? 'Working…' : 'Generate part set'}
            </button>
          </div>
        )}
        {partSet && (
          <>
            <div className="panel-title">Part set</div>
            <div className="segment-layout" style={{ flexWrap: 'wrap' }}>
              {partSet.map((p) => (
                <figure key={p.name} className="partset-cell">
                  <img src={p.image} alt={p.name} />
                  <figcaption>{p.name}</figcaption>
                </figure>
              ))}
            </div>
            <button
              disabled={busy}
              onClick={() =>
                void (async () => {
                  const state = useEditor.getState();
                  const assets: ImageAsset[] = [];
                  for (const p of partSet) {
                    const img = new Image();
                    img.src = p.image;
                    await img.decode();
                    let name = p.name;
                    let n = 2;
                    while (state.assets[name] || assets.some((a) => a.name === name)) {
                      name = `${p.name}-${n++}`;
                    }
                    assets.push({
                      name,
                      dataUrl: p.image,
                      width: img.naturalWidth,
                      height: img.naturalHeight,
                    });
                  }
                  state.addAssets(assets);
                  setNotice(`Imported ${assets.length} part images.`);
                })()
              }
            >
              Add all to Images
            </button>
          </>
        )}
        {gallery.length > 0 && (
          <>
            <div className="panel-title">Gallery</div>
            <div className="projects-list">
              {gallery.map((entry) => (
                <div key={entry.id} className="project-row">
                  <span className="project-name" title={entry.prompt}>
                    {entry.prompt}
                  </span>
                  <span className="project-date">
                    {entry.provider} · {entry.size}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void getGalleryImage(entry.id)
                        .then(onImport)
                        .catch((err: unknown) =>
                          setError(err instanceof Error ? err.message : String(err)),
                        )
                    }
                  >
                    Import
                  </button>
                  <button
                    disabled={busy}
                    title="Delete from gallery"
                    onClick={() => void deleteGalleryImage(entry.id).then(reloadGallery)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <button className="close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
