import { useEffect, useState } from 'react';
import type { SceneRenderer } from '../viewport/renderer.js';

/** Spine-style zoom slider in the viewport's lower-left corner. */
export function ZoomControl({ getRenderer }: { getRenderer: () => SceneRenderer | null }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const r = getRenderer();
    if (!r) return;
    setZoom(r.zoom);
    r.onZoomChange = setZoom;
    return () => {
      if (r.onZoomChange === setZoom) r.onZoomChange = null;
    };
  }, [getRenderer]);
  const apply = (z: number) => getRenderer()?.setZoomCenter(z);
  return (
    <div className="zoom-control">
      <button onClick={() => apply(zoom * 1.25)}>+</button>
      <input
        type="range"
        min={-3}
        max={3}
        step={0.01}
        value={Math.log2(zoom)}
        onChange={(e) => apply(2 ** Number(e.target.value))}
      />
      <button onClick={() => apply(zoom / 1.25)}>−</button>
      <button className="zoom-reset" title="Reset zoom" onClick={() => apply(1)}>
        1:1
      </button>
    </div>
  );
}
