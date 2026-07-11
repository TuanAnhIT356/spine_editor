import { useEffect, useState } from 'react';
import {
  deleteProject,
  getProject,
  listProjects,
  useServer,
  type ProjectSummary,
} from '../server/api.js';
import { saveToServer } from '../server/project-sync.js';
import { useEditor } from '../state/store.js';

export function ProjectsModal({ onClose }: { onClose: () => void }) {
  const bound = useServer((s) => s.projectId);
  const boundName = useServer((s) => s.projectName);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () =>
    listProjects()
      .then(setProjects)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    void reload();
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onSaveNew() {
    const name = window.prompt('Project name', boundName || 'Untitled');
    if (!name) return;
    void run(async () => {
      useServer.getState().bindProject(null);
      await saveToServer(name.trim());
      await reload();
    });
  }

  function onOpen(project: ProjectSummary) {
    void run(async () => {
      const full = await getProject(project.id);
      useEditor
        .getState()
        .replaceProject(full.data.spine, full.data.assets, full.data.audioAssets ?? []);
      useServer.getState().bindProject(full.id, full.name);
      onClose();
    });
  }

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-panel server-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">
          My Projects
          {bound !== null && (
            <span className="bound-note">
              {' '}
              · editing “{boundName}” (#{bound})
            </span>
          )}
        </div>
        <div className="projects-actions">
          <button disabled={busy || bound === null} onClick={() => void run(() => saveToServer())}>
            Save
          </button>
          <button disabled={busy} onClick={onSaveNew}>
            Save as new project
          </button>
        </div>
        {projects === null && !error && <div className="empty">Loading…</div>}
        {projects?.length === 0 && <div className="empty">No projects yet — save one above.</div>}
        <div className="projects-list">
          {projects?.map((p) => (
            <div key={p.id} className={`project-row ${p.id === bound ? 'selected' : ''}`}>
              {p.thumbnail ? (
                <img src={p.thumbnail} alt="" />
              ) : (
                <span className="thumb-placeholder" />
              )}
              <span className="project-name" title={`#${p.id}`}>
                {p.name}
              </span>
              <span className="project-date">{new Date(p.updated_at).toLocaleString()}</span>
              <button disabled={busy} onClick={() => onOpen(p)}>
                Open
              </button>
              <button
                disabled={busy}
                title="Delete project"
                onClick={() => {
                  if (!window.confirm(`Delete "${p.name}" from the server?`)) return;
                  void run(async () => {
                    await deleteProject(p.id);
                    if (p.id === bound) useServer.getState().bindProject(null);
                    await reload();
                  });
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
