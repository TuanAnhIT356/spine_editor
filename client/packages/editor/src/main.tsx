import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { startBridge } from './bridge/bridge.js';
import { useEditor } from './state/store.js';
import './styles.css';

// Exposed for e2e tests; the MCP bridge drives the same store.
window.__spineEditor = useEditor;
startBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
