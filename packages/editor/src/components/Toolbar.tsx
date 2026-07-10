import { createEmptySkeleton, serializeSpineJson, type SpineJson } from '@spine-editor/core';
import { useRef, useState } from 'react';
import { buildAtlas } from '../state/atlas.js';
import { sliceAtlas } from '../state/atlas-slice.js';
import { saveProjectFile } from '../state/actions.js';
import {
  downloadDataUrl,
  downloadText,
  loadImageAsset,
  readFileAsDataUrl,
  readFileAsText,
  type ProjectPayload,
} from '../state/persistence.js';
import { useEditor, type Tool } from '../state/store.js';
import { useServer } from '../server/api.js';
import { GenerateModal } from './GenerateModal.js';
import { ProjectsModal } from './ProjectsModal.js';
import { ServerModal } from './ServerModal.js';

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
  const serverUser = useServer((s) => s.user);
  const [showServer, setShowServer] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const imagesInput = useRef<HTMLInputElement | null>(null);
  const projectInput = useRef<HTMLInputElement | null>(null);
  const spineJsonInput = useRef<HTMLInputElement | null>(null);
  const atlasInput = useRef<HTMLInputElement | null>(null);
  void revision; // subscribe so undo/redo enabled state stays fresh

  async function onImportImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const assets = await Promise.all([...files].map(loadImageAsset));
    useEditor.getState().addAssets(assets);
  }

  /** Select the .atlas file together with its page PNG(s) in one pick. */
  async function onImportAtlas(files: FileList | null) {
    if (!files || files.length === 0) return;
    const state = useEditor.getState();
    try {
      const list = [...files];
      const atlasFile = list.find((f) => f.name.endsWith('.atlas') || f.name.endsWith('.txt'));
      if (!atlasFile) throw new Error('Pick the .atlas file together with its PNG page(s).');
      const pngs = list.filter((f) => f !== atlasFile);
      if (pngs.length === 0) throw new Error('Pick the atlas PNG page(s) together with .atlas.');
      const atlasText = await readFileAsText(atlasFile);
      const pages = new Map<string, string>();
      for (const png of pngs) pages.set(png.name, await readFileAsDataUrl(png));
      const assets = await sliceAtlas(atlasText, pages);
      state.addAssets(assets);
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
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

  async function onExportAtlas() {
    const state = useEditor.getState();
    try {
      const built = await buildAtlas(Object.values(state.assets), 'skeleton.png');
      downloadText('skeleton.atlas', built.atlasText, 'text/plain');
      downloadDataUrl('skeleton.png', built.pngDataUrl);
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onImportSpineJson(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const state = useEditor.getState();
    try {
      const json = JSON.parse(await readFileAsText(file)) as SpineJson;
      if (!json.skeleton) throw new Error('Not a Spine JSON file (missing "skeleton").');
      // Keep imported images so same-named attachments keep rendering.
      const issues = state.replaceProject(json, Object.values(state.assets));
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        state.setError(`Imported with errors: ${errors.map((e) => e.message).join(' | ')}`);
      }
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
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
        <button onClick={() => spineJsonInput.current?.click()} title="Load a Spine JSON skeleton">
          Import JSON
        </button>
        <button
          onClick={() => atlasInput.current?.click()}
          title="Pick a .atlas file plus its PNG page(s) — regions become separate images"
        >
          Import Atlas
        </button>
        <button onClick={onExportJson}>Export JSON</button>
        <button
          onClick={() => void onExportAtlas()}
          title="Pack images into skeleton.atlas + skeleton.png"
        >
          Export Atlas
        </button>
      </div>
      <div className="group">
        <button onClick={onNewProject}>New</button>
        <button onClick={saveProjectFile} title="Ctrl+S">
          Save Project
        </button>
        <button onClick={() => projectInput.current?.click()}>Open Project</button>
      </div>
      <div className="group">
        <button
          className={serverUser ? 'server-on' : ''}
          title={serverUser ? `Signed in as ${serverUser.email}` : 'Server account & API keys'}
          onClick={() => setShowServer(true)}
        >
          {serverUser ? '● Server' : 'Server'}
        </button>
        <button
          disabled={!serverUser}
          title={serverUser ? 'Open/save projects on the server' : 'Sign in first (Server)'}
          onClick={() => setShowProjects(true)}
        >
          Projects
        </button>
        <button
          disabled={!serverUser}
          title={serverUser ? 'Generate character art with AI (BYOK)' : 'Sign in first (Server)'}
          onClick={() => setShowGenerate(true)}
        >
          Generate
        </button>
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
      <input
        ref={spineJsonInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void onImportSpineJson(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={atlasInput}
        type="file"
        accept=".atlas,.txt,image/png"
        multiple
        hidden
        onChange={(e) => {
          void onImportAtlas(e.target.files);
          e.target.value = '';
        }}
      />
      {showServer && <ServerModal onClose={() => setShowServer(false)} />}
      {showProjects && <ProjectsModal onClose={() => setShowProjects(false)} />}
      {showGenerate && <GenerateModal onClose={() => setShowGenerate(false)} />}
    </div>
  );
}
