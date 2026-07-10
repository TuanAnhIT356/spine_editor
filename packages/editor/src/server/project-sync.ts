/** Editor ⇄ server project sync: payload collection, thumbnails, autosave. */
import { bridgeRuntime } from '../bridge/runtime.js';
import type { ProjectPayload } from '../state/persistence.js';
import { useEditor } from '../state/store.js';
import { createProject, updateProject, useServer } from './api.js';

export function collectPayload(): ProjectPayload {
  const s = useEditor.getState();
  return {
    format: 'spine-editor-project',
    version: 1,
    spine: s.doc.toJson(),
    assets: Object.values(s.assets),
  };
}

const THUMB_WIDTH = 200;

/** Downscaled viewport screenshot for the project list; '' when unavailable. */
export async function captureThumbnail(): Promise<string> {
  try {
    await bridgeRuntime.renderNow?.();
    const dataUrl = await bridgeRuntime.renderer?.screenshot();
    if (!dataUrl) return '';
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.max(1, Math.round((img.height / img.width) * THUMB_WIDTH));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#232327';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

/** Saves to the bound server project, or creates one when none is bound. */
export async function saveToServer(name?: string): Promise<void> {
  const server = useServer.getState();
  const payload = collectPayload();
  const thumbnail = await captureThumbnail();
  if (server.projectId !== null && !name) {
    await updateProject(server.projectId, { data: payload, thumbnail });
    return;
  }
  const created = await createProject(name ?? 'Untitled', payload, thumbnail);
  server.bindProject(created.id, created.name);
}

let autosaveTimer: number | undefined;

/**
 * Debounced autosave of document edits into the bound server project.
 * Call once at app start; it watches the editor store like the IndexedDB
 * autosave but pushes over the network at a gentler cadence.
 */
export function startServerAutosave(): () => void {
  const unsub = useEditor.subscribe((state, prev) => {
    if (state.revision === prev.revision && state.assets === prev.assets) return;
    const { user, projectId } = useServer.getState();
    if (!user || projectId === null) return;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      const bound = useServer.getState().projectId;
      if (bound === null) return;
      updateProject(bound, { data: collectPayload() }).catch(() => undefined);
    }, 3000);
  });
  return () => {
    unsub();
    window.clearTimeout(autosaveTimer);
  };
}
