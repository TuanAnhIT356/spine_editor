import { RemoveBone } from '@spine-editor/core';
import { useEffect } from 'react';
import { HierarchyPanel } from './components/HierarchyPanel.js';
import { PropertiesPanel } from './components/PropertiesPanel.js';
import { Toolbar } from './components/Toolbar.js';
import { Viewport } from './components/Viewport.js';
import { loadAutosave, saveAutosave } from './state/persistence.js';
import { useEditor } from './state/store.js';

export function App() {
  const error = useEditor((s) => s.error);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
      const s = useEditor.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.key === '1') s.setTool('select');
      else if (e.key === '2') s.setTool('translate');
      else if (e.key === '3') s.setTool('rotate');
      else if (e.key === '4') s.setTool('create');
      else if (e.key === 'Delete' && s.selection) {
        if (s.selection.kind === 'bone') {
          if (s.execute(new RemoveBone(s.selection.name))) s.select(null);
        } else {
          s.removeSlotCascade(s.selection.name);
        }
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

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <HierarchyPanel />
        <Viewport />
        <PropertiesPanel />
      </div>
      {error && (
        <div className="error-banner" onClick={() => useEditor.getState().setError(null)}>
          {error} <span className="dismiss">(click to dismiss)</span>
        </div>
      )}
    </div>
  );
}
