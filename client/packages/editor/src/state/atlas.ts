import {
  atlasToText,
  packAtlas,
  type AtlasLayout,
  type AtlasRegionInput,
} from '@spine-editor/core';
import type { ImageAsset } from './store.js';

export interface BuiltAtlas {
  layout: AtlasLayout;
  atlasText: string;
  pngDataUrl: string;
}

export interface AtlasOptions {
  /** Pixels between packed regions. */
  padding: number;
  /** Maximum page edge in px. */
  maxSize: 1024 | 2048 | 4096;
  /** Round the page size up to powers of two. */
  powerOfTwo: boolean;
  /** Crop transparent borders (writes offset/orig so regions keep their size). */
  trim: boolean;
}

export const DEFAULT_ATLAS_OPTIONS: AtlasOptions = {
  padding: 2,
  maxSize: 2048,
  powerOfTwo: false,
  trim: false,
};

/** Alpha>0 bounding box of a decoded image (whole image when fully opaque). */
function trimBox(img: HTMLImageElement): { x: number; y: number; w: number; h: number } {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let yPix = 0; yPix < height; yPix++) {
    for (let xPix = 0; xPix < width; xPix++) {
      if (data[(yPix * width + xPix) * 4 + 3]! > 0) {
        if (xPix < minX) minX = xPix;
        if (xPix > maxX) maxX = xPix;
        if (yPix < minY) minY = yPix;
        if (yPix > maxY) maxY = yPix;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1 }; // fully transparent: keep 1px
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Packs all imported images into one page and composites the PNG. */
export async function buildAtlas(
  assets: ImageAsset[],
  pngName: string,
  options: AtlasOptions = DEFAULT_ATLAS_OPTIONS,
): Promise<BuiltAtlas> {
  if (assets.length === 0) throw new Error('No images imported; nothing to pack.');
  const images = new Map<string, HTMLImageElement>();
  const inputs: AtlasRegionInput[] = [];
  for (const asset of assets) {
    const img = new Image();
    img.src = asset.dataUrl;
    await img.decode();
    images.set(asset.name, img);
    if (options.trim) {
      const box = trimBox(img);
      inputs.push({
        name: asset.name,
        width: box.w,
        height: box.h,
        origWidth: img.naturalWidth,
        origHeight: img.naturalHeight,
        offsetX: box.x,
        // libgdx offset Y is measured from the BOTTOM of the original image.
        offsetY: img.naturalHeight - (box.y + box.h),
      });
    } else {
      inputs.push({ name: asset.name, width: img.naturalWidth, height: img.naturalHeight });
    }
  }
  const layout = packAtlas(inputs, {
    maxWidth: options.maxSize,
    padding: options.padding,
    powerOfTwo: options.powerOfTwo,
  });
  if (layout.width > options.maxSize || layout.height > options.maxSize) {
    throw new Error(
      `Atlas ${layout.width}x${layout.height} exceeds max size ${options.maxSize}; remove images or raise Max size.`,
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  for (const region of layout.regions) {
    const img = images.get(region.name);
    if (!img) continue;
    if (options.trim && region.origWidth !== undefined) {
      const srcY = region.origHeight! - (region.offsetY ?? 0) - region.height;
      ctx.drawImage(
        img,
        region.offsetX ?? 0,
        srcY,
        region.width,
        region.height,
        region.x,
        region.y,
        region.width,
        region.height,
      );
    } else {
      ctx.drawImage(img, region.x, region.y);
    }
  }
  return {
    layout,
    atlasText: atlasToText(pngName, layout),
    pngDataUrl: canvas.toDataURL('image/png'),
  };
}
