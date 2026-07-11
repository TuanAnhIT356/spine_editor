import { RemoveBone } from '@spine-editor/core';
import { useEffect, useState } from 'react';
import { HierarchyPanel } from './components/HierarchyPanel.js';
import { PropertiesPanel } from './components/PropertiesPanel.js';
import { Resizer } from './components/Resizer.js';
import { ShortcutsHelp } from './components/ShortcutsHelp.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { Toolbar } from './components/Toolbar.js';
import { Viewport } from './components/Viewport.js';
import { saveProjectFile } from './state/actions.js';
import { loadAutosave, saveAutosave } from './state/persistence.js';
import { tryRefresh } from './server/api.js';
import { startServerAutosave } from './server/project-sync.js';
import { useEditor } from './state/store.js';

export function App() {
  const error = useEditor((s) => s.error);
  const mode = useEditor((s) => s.mode);
  const panels = useEditor((s) => s.panelVisibility);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProjectFile();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.selectAllBones();
      } else if (e.key === '1') s.setTool('select');
      else if (e.key === '2') s.setTool('translate');
      else if (e.key === '3') s.setTool('rotate');
      else if (e.key === '4') s.setTool('create');
      else if (e.key === ' ' && s.mode === 'animate' && s.anim.current) {
        e.preventDefault();
        s.setPlaying(!s.anim.playing);
      } else if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        s.mode === 'animate' &&
        s.anim.current
      ) {
        e.preventDefault();
        s.stepFrame(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'Escape') {
        if (s.meshEdit) s.endMeshEdit();
        else s.select(null);
      } else if (e.key === '?') {
        setShowShortcuts((v) => !v);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length > 0) {
        e.preventDefault();
        // Bones must be removed deepest-first (children before parents) so RemoveBone's
        // "has children" guard doesn't reject a parent that's also being deleted.
        const boneOrder = new Map(s.doc.data.bones.map((b, i) => [b.name, i]));
        const bones = s.selection
          .filter((sel) => sel.kind === 'bone')
          .map((sel) => sel.name)
          .sort((a, b) => (boneOrder.get(b) ?? 0) - (boneOrder.get(a) ?? 0));
        const slots = s.selection.filter((sel) => sel.kind === 'slot').map((sel) => sel.name);
        for (const slot of slots) s.removeSlotCascade(slot);
        for (const bone of bones) s.execute(new RemoveBone(bone));
        s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    void loadAutosave().then((payload) => {
      if (payload) useEditor.getState().replaceProject(payload.spine, payload.assets);
    });
    const unsub = useEditor.subscribe((state, prev) => {
      if (state.revision === prev.revision && state.assets === prev.assets) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const s = useEditor.getState();
        void saveAutosave({
          format: 'spine-editor-project',
          version: 1,
          spine: s.doc.toJson(),
          assets: Object.values(s.assets),
        }).catch(() => undefined);
      }, 800);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    // Restore the server session from the refresh cookie (no-op when the
    // opt-in backend is not running) and push edits to the bound project.
    void tryRefresh();
    return startServerAutosave();
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        {panels.hierarchy && (
          <>
            <HierarchyPanel />
            <Resizer axis="x" onResize={(d) => useEditor.getState().resizeHierarchy(d)} />
          </>
        )}
        <Viewport />
        {panels.properties && (
          <>
            <Resizer axis="x" onResize={(d) => useEditor.getState().resizeProperties(d)} />
            <PropertiesPanel />
          </>
        )}
      </div>
      {mode === 'animate' && panels.timeline && (
        <>
          <Resizer axis="y" onResize={(d) => useEditor.getState().resizeTimeline(d)} />
          <TimelinePanel />
        </>
      )}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
      <button
        className="shortcuts-toggle"
        title="Keyboard shortcuts (?)"
        onClick={() => setShowShortcuts((v) => !v)}
      >
        ?
      </button>
      {error && (
        <div className="error-banner" onClick={() => useEditor.getState().setError(null)}>
          {error} <span className="dismiss">(click to dismiss)</span>
        </div>
      )}
    </div>
  );
}
