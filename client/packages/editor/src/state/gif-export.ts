/**
 * GIF export: steps the current animation on a fixed fps grid, screenshots
 * the viewport for each frame and encodes them with gifenc. Runs entirely
 * client-side; the playhead is restored afterwards.
 */

import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { captureFrames, type FrameProgress } from './frame-export.js';
import { downloadBlob } from './persistence.js';
import { useEditor } from './store.js';

export async function exportGif(fps = 20, onProgress?: FrameProgress): Promise<void> {
  const name = useEditor.getState().anim.current;
  if (!name) throw new Error('Open an animation first.');
  const gif = GIFEncoder();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  await captureFrames(fps, (img, i, total) => {
    onProgress?.(i + 1, total);
    if (i === 0) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    // GIF has no partial alpha — composite on the viewport background color.
    ctx.fillStyle = '#232327';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay: Math.round(1000 / fps) });
  });
  gif.finish();
  downloadBlob(
    `${name}.gif`,
    new Blob([gif.bytes() as unknown as BlobPart], { type: 'image/gif' }),
  );
}
