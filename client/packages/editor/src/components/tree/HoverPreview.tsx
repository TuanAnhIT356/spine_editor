import type { ImageAsset } from '../../state/store.js';

/** Small floating thumbnail shown beside a tree row on hover. */
export function HoverPreview({ x, y, asset }: { x: number; y: number; asset: ImageAsset }) {
  return (
    <div className="hover-preview" style={{ left: x, top: y }}>
      <img src={asset.dataUrl} alt={asset.name} />
      <div className="hover-preview-meta">
        {asset.name} · {asset.width}×{asset.height}
      </div>
    </div>
  );
}
