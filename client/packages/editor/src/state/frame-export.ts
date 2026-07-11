/**
 * Shared frame-stepping loop for animation exports (GIF/WebM/PNG sequence):
 * steps the current animation on a fixed fps grid, screenshots the viewport
 * per frame, and restores the playhead afterwards.
 */

import { getAnimationDuration } from '@spine-editor/core';
import { zipSync } from 'fflate';
import { bridgeRuntime } from '../bridge/runtime.js';
import { downloadBlob } from './persistence.js';
import { useEditor } from './store.js';

export type FrameProgress = (frame: number, total: number) => void;

export async function captureFrames(
  fps: number,
  onFrame: (img: HTMLImageElement, index: number, total: number) => Promise<void> | void,
): Promise<{ width: number; height: number; frames: number }> {
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
  let width = 0;
  let height = 0;
  try {
    for (let i = 0; i < frames; i++) {
      useEditor.getState().setAnimTime(i / fps);
      await renderNow();
      const dataUrl = await renderer.screenshot();
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      width = img.naturalWidth;
      height = img.naturalHeight;
      await onFrame(img, i, frames);
    }
  } finally {
    const s = useEditor.getState();
    s.setAnimTime(prevTime);
    if (wasPlaying) s.setPlaying(true);
    await renderNow();
  }
  return { width, height, frames };
}

/** Exports the current animation as a zip of transparent PNG frames. */
export async function exportPngSequence(fps = 30, onProgress?: FrameProgress): Promise<void> {
  const name = useEditor.getState().anim.current ?? 'animation';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  const files: Record<string, Uint8Array> = {};
  await captureFrames(fps, async (img, i, total) => {
    onProgress?.(i + 1, total);
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encode failed.');
    files[`frame-${String(i + 1).padStart(4, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
  });
  const zipped = zipSync(files);
  downloadBlob(
    `${name}-frames.zip`,
    new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }),
  );
}

/** Exports the current animation as a WebM video (vp9 → vp8 fallback). */
export async function exportWebm(fps = 30, onProgress?: FrameProgress): Promise<void> {
  const name = useEditor.getState().anim.current ?? 'animation';
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is not supported in this browser.');
  }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
  if (!mime) throw new Error('WebM recording is not supported in this browser.');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  // Manual frame pacing when supported (exact timing); realtime stream otherwise.
  const manual = 'CanvasCaptureMediaStreamTrack' in window;
  const stream = canvas.captureStream(manual ? 0 : fps);
  const track = stream.getVideoTracks()[0] as unknown as { requestFrame?: () => void } | undefined;
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  let started = false;
  await captureFrames(fps, async (img, i, total) => {
    onProgress?.(i + 1, total);
    if (!started) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      recorder.start();
      started = true;
    }
    // Video has no alpha: composite on the viewport background.
    ctx.fillStyle = '#232327';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    if (manual) track?.requestFrame?.();
    await new Promise((r) => setTimeout(r, 1000 / fps));
  });
  recorder.stop();
  await stopped;
  downloadBlob(`${name}.webm`, new Blob(chunks, { type: 'video/webm' }));
}
