import { createEmptySkeleton, serializeSpineJson, type SpineJson } from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
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
import { useEditor } from '../state/store.js';
import { useServer } from '../server/api.js';
import { MenuIcon, OpenIcon, RedoIcon, SaveIcon, UndoIcon } from './icons.js';
import { GenerateModal } from './GenerateModal.js';
import { SegmentModal } from './SegmentModal.js';
import { ChatWindow } from './ChatWindow.js';
import { GhostingWindow } from './GhostingWindow.js';
import { PreviewWindow } from './PreviewWindow.js';
import { ColorWindow } from './ColorWindow.js';
import { MetricsWindow } from './MetricsWindow.js';
import { SettingsWindow } from './SettingsWindow.js';
import { WeightsWindow } from './WeightsWindow.js';
import { ProjectsModal } from './ProjectsModal.js';
import { ServerModal } from './ServerModal.js';

export function Toolbar() {
  const mode = useEditor((s) => s.mode);
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const serverUser = useServer((s) => s.user);
  const [showServer, setShowServer] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showSegment, setShowSegment] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showGhosting, setShowGhosting] = useState(false);
  const [showWeights, setShowWeights] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showColor, setShowColor] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  useEffect(() => {
    const open = () => setShowColor(true);
    window.addEventListener('spine-editor:open-color', open);
    return () => window.removeEventListener('spine-editor:open-color', open);
  }, []);
  const meshEditMode = useEditor((s) => s.meshEdit?.mode ?? null);
  const hasMeshEdit = meshEditMode !== null;
  useEffect(() => {
    if (meshEditMode === 'weights') setShowWeights(true);
  }, [meshEditMode]);
  const dirty = useEditor((s) => s.revision !== s.savedRevision);
  const panels = useEditor((s) => s.panelVisibility);
  const serverProjectName = useServer((s) => s.projectName);
  const projectName = serverProjectName || 'untitled';
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
      state.replaceProject(payload.spine, payload.assets, payload.audioAssets ?? []);
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onNewProject() {
    if (!window.confirm('Start a new project? Unsaved work is replaced.')) return;
    useEditor.getState().replaceProject(serializeSpineJson(createEmptySkeleton()), [], []);
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
      const issues = state.replaceProject(
        json,
        Object.values(state.assets),
        Object.values(state.audioAssets),
      );
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        state.setError(`Imported with errors: ${errors.map((e) => e.message).join(' | ')}`);
      }
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="toolbar titlebar">
      <span className="brand">spine editor</span>
      <div className="menu-wrap">
        <button className="icon-btn" title="Menu" onClick={() => setShowMenu((v) => !v)}>
          <MenuIcon />
        </button>
        {showMenu && (
          <div className="dropdown" onClick={() => setShowMenu(false)}>
            <button onClick={onNewProject}>New</button>
            <button onClick={() => projectInput.current?.click()}>Open Project</button>
            <button onClick={saveProjectFile}>Save Project</button>
            <hr />
            <button onClick={() => imagesInput.current?.click()}>Import Images</button>
            <button onClick={() => spineJsonInput.current?.click()}>Import JSON</button>
            <button onClick={() => atlasInput.current?.click()}>Import Atlas</button>
            <hr />
            <button onClick={onExportJson}>Export JSON</button>
            <button onClick={() => void onExportAtlas()}>Export Atlas</button>
          </div>
        )}
      </div>
      <button
        className="icon-btn"
        title="Open Project"
        onClick={() => projectInput.current?.click()}
      >
        <OpenIcon />
      </button>
      <button className="icon-btn" title="Save Project (Ctrl+S)" onClick={saveProjectFile}>
        <SaveIcon />
      </button>
      <button
        className="icon-btn"
        disabled={!doc.history.canUndo}
        onClick={() => useEditor.getState().undo()}
        title="Undo (Ctrl+Z)"
      >
        <UndoIcon />
      </button>
      <button
        className="icon-btn"
        disabled={!doc.history.canRedo}
        onClick={() => useEditor.getState().redo()}
        title="Redo (Ctrl+Shift+Z)"
      >
        <RedoIcon />
      </button>
      <span className="project-name">
        {dirty ? '*' : ''}
        {projectName}
      </span>
      <div className="spacer" />
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
        <button
          disabled={!serverUser}
          title={
            serverUser ? 'Segment a character image into parts (AI)' : 'Sign in first (Server)'
          }
          onClick={() => setShowSegment(true)}
        >
          Segment
        </button>
        <button
          disabled={!serverUser}
          title={
            serverUser ? 'AI chat: rig and animate by talking to Claude' : 'Sign in first (Server)'
          }
          onClick={() => setShowChat((v) => !v)}
        >
          Chat
        </button>
      </div>
      <div className="menu-wrap">
        <button className="icon-btn views-btn" onClick={() => setShowViews((v) => !v)}>
          Views ▾
        </button>
        {showViews && (
          <div className="dropdown">
            {(['tree', 'timeline'] as const).map((p) => (
              <label key={p} className="views-item">
                <input
                  type="checkbox"
                  checked={panels[p]}
                  disabled={p === 'timeline' && mode === 'setup'}
                  onChange={() => useEditor.getState().togglePanel(p)}
                />
                {p === 'tree' ? 'Tree' : 'Timeline'}
              </label>
            ))}
            <label className="views-item">
              <input
                type="checkbox"
                checked={showPreview}
                onChange={() => setShowPreview((v) => !v)}
              />
              Preview
            </label>
            <label className="views-item">
              <input
                type="checkbox"
                checked={showGhosting}
                onChange={() => setShowGhosting((v) => !v)}
              />
              Ghosting
            </label>
            <label className="views-item">
              <input
                type="checkbox"
                checked={showWeights}
                disabled={!hasMeshEdit}
                onChange={() => setShowWeights((v) => !v)}
              />
              Weights
            </label>
            <label className="views-item">
              <input
                type="checkbox"
                checked={showSettings}
                onChange={() => setShowSettings((v) => !v)}
              />
              Settings
            </label>
            <label className="views-item">
              <input type="checkbox" checked={showColor} onChange={() => setShowColor((v) => !v)} />
              Color
            </label>
            <label className="views-item">
              <input
                type="checkbox"
                checked={showMetrics}
                onChange={() => setShowMetrics((v) => !v)}
              />
              Metrics
            </label>
          </div>
        )}
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
      {showSegment && <SegmentModal onClose={() => setShowSegment(false)} />}
      {showChat && <ChatWindow onClose={() => setShowChat(false)} />}
      {showPreview && <PreviewWindow onClose={() => setShowPreview(false)} />}
      {showGhosting && <GhostingWindow onClose={() => setShowGhosting(false)} />}
      {showWeights && <WeightsWindow onClose={() => setShowWeights(false)} />}
      {showSettings && <SettingsWindow onClose={() => setShowSettings(false)} />}
      {showColor && <ColorWindow onClose={() => setShowColor(false)} />}
      {showMetrics && <MetricsWindow onClose={() => setShowMetrics(false)} />}
    </div>
  );
}
