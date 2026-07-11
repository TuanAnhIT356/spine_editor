/**
 * Atlas import: slices a packed page image back into one ImageAsset per
 * region using the parsed `.atlas` data. Region names keep their full path
 * (e.g. "goblin/left-arm") so attachments referencing them keep rendering.
 */

import { parseAtlas } from '@spine-editor/core';
import type { ImageAsset } from './store.js';

async function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

/**
 * `pageImages` maps page file names (e.g. "skeleton.png") to data URLs; when
 * a page is missing by name the first provided image is used (single-page
 * atlases renamed by the user still work).
 */
export async function sliceAtlas(
  atlasText: string,
  pageImages: ReadonlyMap<string, string>,
): Promise<ImageAsset[]> {
  const pages = parseAtlas(atlasText);
  if (pages.length === 0) throw new Error('No pages found in the atlas file.');
  const out: ImageAsset[] = [];
  for (const page of pages) {
    const dataUrl = pageImages.get(page.name) ?? [...pageImages.values()][0];
    if (!dataUrl) throw new Error(`Missing image for atlas page "${page.name}".`);
    const img = await decodeImage(dataUrl);
    for (const r of page.regions) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, r.origWidth);
      canvas.height = Math.max(1, r.origHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable.');
      // Whitespace-strip offsets are measured from the original's bottom-left;
      // canvas coordinates run from the top-left.
      const dx = r.offsetX;
      const dy = r.origHeight - r.height - r.offsetY;
      if (!r.rotate) {
        ctx.drawImage(img, r.x, r.y, r.width, r.height, dx, dy, r.width, r.height);
      } else {
        // Rotated regions are stored 90° clockwise: the page rect has swapped
        // dimensions; rotate it back counter-clockwise around the dest center.
        ctx.save();
        ctx.translate(dx + r.width / 2, dy + r.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(
          img,
          r.x,
          r.y,
          r.height,
          r.width,
          -r.height / 2,
          -r.width / 2,
          r.height,
          r.width,
        );
        ctx.restore();
      }
      out.push({
        name: r.name,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      });
    }
  }
  return out;
}
