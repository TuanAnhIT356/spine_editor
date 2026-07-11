import { downloadText, type ProjectPayload } from './persistence.js';
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
