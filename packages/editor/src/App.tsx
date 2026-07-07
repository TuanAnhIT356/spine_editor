import { SPINE_JSON_TARGET_VERSION } from '@spine-editor/core';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Spine Editor</h1>
      <p>
        Web-based 2D skeletal animation editor targeting the Spine JSON format{' '}
        <strong>{SPINE_JSON_TARGET_VERSION}</strong>.
      </p>
      <p>Phase 0 scaffold — the editor shell (viewport, hierarchy, timeline) arrives in Phase 2.</p>
    </main>
  );
}
