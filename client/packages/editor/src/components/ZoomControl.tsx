import { useEffect, useState } from 'react';
import { useEditor } from '../state/store.js';
import { computeSkeletonBounds } from '../viewport/bounds.js';
import { FrameIcon, RulerIcon } from './icons.js';
import type { SceneRenderer } from '../viewport/renderer.js';

/** Spine-style zoom slider in the viewport's lower-left corner. */
export function ZoomControl({ getRenderer }: { getRenderer: () => SceneRenderer | null }) {
  const [zoom, setZoom] = useState(1);
  const showRulers = useEditor((s) => s.settings.showRulers);
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
  function onCenter() {
    const r = getRenderer();
    if (!r) return;
    const state = useEditor.getState();
    const bounds = computeSkeletonBounds(
      state.doc.data,
      r.getFullPose(),
      state.hiddenBones.length ? new Set(state.hiddenBones) : undefined,
      state.hiddenSlots.length ? new Set(state.hiddenSlots) : undefined,
      state.activeSkin,
    );
    if (bounds) r.frameBounds(bounds);
  }
  return (
    <div className="zoom-control">
      <button
        className={showRulers ? 'active' : ''}
        title="Toggle rulers"
        onClick={() =>
          useEditor
            .getState()
            .setSettings({ showRulers: !useEditor.getState().settings.showRulers })
        }
      >
        <RulerIcon size={13} />
      </button>
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
      <button title="Center on skeleton" onClick={onCenter}>
        <FrameIcon size={13} />
      </button>
    </div>
  );
}
