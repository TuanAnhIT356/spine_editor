import type { SceneRenderer } from '../viewport/renderer.js';

/**
 * Registry the Viewport fills in so the MCP bridge can reach the renderer
 * (for screenshots) and force a synchronous redraw before capturing.
 */
export const bridgeRuntime: {
  renderer: SceneRenderer | null;
  renderNow: (() => Promise<void>) | null;
} = {
  renderer: null,
  renderNow: null,
};
