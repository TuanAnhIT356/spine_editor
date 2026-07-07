import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { useEditor } from './state/store.js';
import './styles.css';

// Exposed for e2e tests and (later) the MCP WebSocket bridge.
window.__spineEditor = useEditor;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
