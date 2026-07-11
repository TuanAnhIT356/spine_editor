import { atlasToText, packAtlas, type AtlasLayout } from '@spine-editor/core';
import type { ImageAsset } from './store.js';

export interface BuiltAtlas {
  layout: AtlasLayout;
  atlasText: string;
  pngDataUrl: string;
}

/** Packs all imported images into one page and composites the PNG. */
export async function buildAtlas(assets: ImageAsset[], pngName: string): Promise<BuiltAtlas> {
  if (assets.length === 0) throw new Error('No images imported; nothing to pack.');
  const layout = packAtlas(assets.map((a) => ({ name: a.name, width: a.width, height: a.height })));
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  for (const region of layout.regions) {
    const asset = assets.find((a) => a.name === region.name);
    if (!asset) continue;
    const img = new Image();
    img.src = asset.dataUrl;
    await img.decode();
    ctx.drawImage(img, region.x, region.y);
  }
  return {
    layout,
    atlasText: atlasToText(pngName, layout),
    pngDataUrl: canvas.toDataURL('image/png'),
  };
}
