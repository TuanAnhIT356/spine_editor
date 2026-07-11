import { useEffect, useRef, useState } from 'react';
import { getProject, listProjects, useServer, type ProjectSummary } from '../server/api.js';
import { importSpineJsonFile, openProjectFile } from '../state/actions.js';
import { useEditor } from '../state/store.js';

/** First-run overlay: create/open/import + server projects. */
export function WelcomeScreen({ onClose }: { onClose: () => void }) {
  const settings = useEditor((s) => s.settings);
  const setSettings = useEditor((s) => s.setSettings);
  const user = useServer((s) => s.user);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const openInput = useRef<HTMLInputElement | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user) return;
    void listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [user]);

  const run = (fn: () => Promise<void>) => {
    void fn()
      .then(onClose)
      .catch((err) =>
        useEditor.getState().setError(err instanceof Error ? err.message : String(err)),
      );
  };

  return (
    <div className="welcome-overlay">
      <div className="welcome-panel">
        <div className="welcome-title">Spine Editor</div>
        <div className="welcome-sub">Web-based 2D skeletal animation</div>
        <div className="welcome-actions">
          <button onClick={onClose}>New Project</button>
          <button onClick={() => openInput.current?.click()}>Open Project…</button>
          <button onClick={() => importInput.current?.click()}>Import Spine JSON…</button>
        </div>
        {user ? (
          <div className="welcome-projects">
            <div className="panel-title">Server projects</div>
            {projects === null && <div className="empty">Loading…</div>}
            {projects?.length === 0 && <div className="empty">No projects yet.</div>}
            {projects?.map((p) => (
              <button
                key={p.id}
                className="welcome-project"
                onClick={() =>
                  run(async () => {
                    const full = await getProject(p.id);
                    useEditor
                      .getState()
                      .replaceProject(
                        full.data.spine,
                        full.data.assets,
                        full.data.audioAssets ?? [],
                      );
                  })
                }
              >
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">Sign in (Server) to sync projects.</div>
        )}
        <label className="welcome-startup">
          <input
            type="checkbox"
            checked={settings.welcome}
            onChange={(e) => setSettings({ welcome: e.target.checked })}
          />
          Show on startup
        </label>
        <button className="close welcome-close" onClick={onClose}>
          ×
        </button>
        <input
          ref={openInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) run(() => openProjectFile(f));
            e.target.value = '';
          }}
        />
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) run(() => importSpineJsonFile(f));
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
