/**
 * GIF export: steps the current animation on a fixed fps grid, screenshots
 * the viewport for each frame and encodes them with gifenc. Runs entirely
 * client-side; the playhead is restored afterwards.
 */

import { getAnimationDuration } from '@spine-editor/core';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { bridgeRuntime } from '../bridge/runtime.js';
import { downloadBlob } from './persistence.js';
import { useEditor } from './store.js';

export async function exportGif(fps = 20): Promise<void> {
  const state = useEditor.getState();
  const name = state.anim.current;
  if (!name) throw new Error('Open an animation first.');
  const renderer = bridgeRuntime.renderer;
  const renderNow = bridgeRuntime.renderNow;
  if (!renderer?.ready || !renderNow) throw new Error('Viewport is not ready.');
  const animation = state.doc.getAnimation(name);
  const duration = Math.max(animation ? getAnimationDuration(animation) : 0, 1 / fps);
  const frames = Math.max(1, Math.round(duration * fps));

  const prevTime = state.anim.time;
  const wasPlaying = state.anim.playing;
  useEditor.getState().setPlaying(false);

  const gif = GIFEncoder();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  try {
    for (let i = 0; i < frames; i++) {
      useEditor.getState().setAnimTime(i / fps);
      await renderNow();
      const dataUrl = await renderer.screenshot();
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
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
    }
    gif.finish();
    downloadBlob(
      `${name}.gif`,
      new Blob([gif.bytes() as unknown as BlobPart], { type: 'image/gif' }),
    );
  } finally {
    const s = useEditor.getState();
    s.setAnimTime(prevTime);
    if (wasPlaying) s.setPlaying(true);
    await renderNow();
  }
}
