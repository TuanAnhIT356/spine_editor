/**
 * PSD import: parses a Photoshop file in the browser (@webtoon/psd) and turns
 * each visible raster layer into a SegPartCut (same shape the segmentation
 * flow uses), so importParts() can add assets + place them on the canvas.
 */

import Psd from '@webtoon/psd';
import type { SegPartCut } from '../server/api.js';

export async function parsePsdToCuts(
  buffer: ArrayBuffer,
): Promise<{ cuts: SegPartCut[]; width: number; height: number }> {
  const psd = Psd.parse(buffer);
  const cuts: SegPartCut[] = [];
  // @webtoon/psd lists layers TOP-most first (verified against the committed
  // e2e fixture); reverse so the bottom layer comes first and importParts
  // places slots in the right draw order. The bridge e2e asserts this order.
  for (const layer of [...psd.layers].reverse()) {
    if (layer.isHidden || layer.width <= 0 || layer.height <= 0) continue;
    const pixels = await layer.composite();
    const canvas = document.createElement('canvas');
    canvas.width = layer.width;
    canvas.height = layer.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), layer.width, layer.height), 0, 0);
    cuts.push({
      name: layer.name?.trim() || 'layer',
      image: canvas.toDataURL('image/png'),
      x: layer.left,
      y: layer.top,
      width: layer.width,
      height: layer.height,
    });
  }
  if (cuts.length === 0) throw new Error('No visible raster layers found in the PSD.');
  return { cuts, width: psd.width, height: psd.height };
}
