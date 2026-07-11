import type { SpineJson } from '@spine-editor/core';
import { downloadText, readFileAsText, type ProjectPayload } from './persistence.js';
import { useEditor } from './store.js';

/** Downloads the current document + imported images as a project file (also bound to Ctrl/Cmd+S). */
export function saveProjectFile(): void {
  const state = useEditor.getState();
  const payload: ProjectPayload = {
    format: 'spine-editor-project',
    version: 1,
    spine: state.doc.toJson(),
    assets: Object.values(state.assets),
    audioAssets: Object.values(state.audioAssets),
  };
  downloadText('project.spine-editor.json', JSON.stringify(payload));
  state.markSaved();
}

/** Opens a .spine-editor project file into the store (throws on invalid). */
export async function openProjectFile(file: File): Promise<void> {
  const payload = JSON.parse(await readFileAsText(file)) as ProjectPayload;
  if (payload.format !== 'spine-editor-project') throw new Error('Not a project file.');
  useEditor.getState().replaceProject(payload.spine, payload.assets, payload.audioAssets ?? []);
}

/**
 * Imports a raw Spine JSON file, keeping current image/audio assets so
 * same-named attachments keep rendering. Throws on invalid files; reports
 * non-fatal validation errors via the error banner.
 */
export async function importSpineJsonFile(file: File): Promise<void> {
  const json = JSON.parse(await readFileAsText(file)) as SpineJson;
  if (!json.skeleton) throw new Error('Not a Spine JSON file (missing "skeleton").');
  const state = useEditor.getState();
  const issues = state.replaceProject(
    json,
    Object.values(state.assets),
    Object.values(state.audioAssets),
  );
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    state.setError(`Imported with errors: ${errors.map((e) => e.message).join(' | ')}`);
  }
}
