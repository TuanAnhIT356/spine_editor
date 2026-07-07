import { createEmptySkeleton, serializeSpineJson } from '@spine-editor/core';
import { useRef } from 'react';
import {
  downloadText,
  loadImageAsset,
  readFileAsText,
  type ProjectPayload,
} from '../state/persistence.js';
import { useEditor, type Tool } from '../state/store.js';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: '1 — click bones, drag empty space to pan' },
  { id: 'translate', label: 'Translate', hint: '2 — drag a bone to move it' },
  { id: 'rotate', label: 'Rotate', hint: '3 — drag around a bone to rotate it' },
  { id: 'create', label: 'Create', hint: '4 — drag from a bone to add a child bone' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.mode);
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const imagesInput = useRef<HTMLInputElement | null>(null);
  const projectInput = useRef<HTMLInputElement | null>(null);
  void revision; // subscribe so undo/redo enabled state stays fresh

  async function onImportImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const assets = await Promise.all([...files].map(loadImageAsset));
    useEditor.getState().addAssets(assets);
  }

  function onExportJson() {
    const state = useEditor.getState();
    const errors = state.doc.validate().filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      state.setError(`Export blocked: ${errors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`);
      return;
    }
    downloadText('skeleton.json', state.doc.toJsonString(2));
  }

  function onSaveProject() {
    const state = useEditor.getState();
    const payload: ProjectPayload = {
      format: 'spine-editor-project',
      version: 1,
      spine: state.doc.toJson(),
      assets: Object.values(state.assets),
    };
    downloadText('project.spine-editor.json', JSON.stringify(payload));
  }

  async function onOpenProject(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const state = useEditor.getState();
    try {
      const payload = JSON.parse(await readFileAsText(file)) as ProjectPayload;
      if (payload.format !== 'spine-editor-project') throw new Error('Not a project file.');
      state.replaceProject(payload.spine, payload.assets);
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onNewProject() {
    if (!window.confirm('Start a new project? Unsaved work is replaced.')) return;
    useEditor.getState().replaceProject(serializeSpineJson(createEmptySkeleton()), []);
  }

  return (
    <div className="toolbar">
      <span className="brand">Spine Editor</span>
      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'active' : ''}
            title={t.id === 'create' && mode === 'animate' ? 'Setup mode only' : t.hint}
            disabled={t.id === 'create' && mode === 'animate'}
            onClick={() => useEditor.getState().setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="group">
        <button
          disabled={!doc.history.canUndo}
          onClick={() => useEditor.getState().undo()}
          title="Ctrl+Z"
        >
          Undo
        </button>
        <button
          disabled={!doc.history.canRedo}
          onClick={() => useEditor.getState().redo()}
          title="Ctrl+Shift+Z"
        >
          Redo
        </button>
      </div>
      <div className="group">
        <button onClick={() => imagesInput.current?.click()}>Import Images</button>
        <button onClick={onExportJson}>Export JSON</button>
      </div>
      <div className="group">
        <button onClick={onNewProject}>New</button>
        <button onClick={onSaveProject}>Save Project</button>
        <button onClick={() => projectInput.current?.click()}>Open Project</button>
      </div>
      <div className="group modes">
        <button
          className={mode === 'setup' ? 'active' : ''}
          onClick={() => useEditor.getState().setMode('setup')}
        >
          Setup
        </button>
        <button
          className={mode === 'animate' ? 'active' : ''}
          onClick={() => useEditor.getState().setMode('animate')}
        >
          Animate
        </button>
      </div>
      <input
        ref={imagesInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void onImportImages(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void onOpenProject(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
