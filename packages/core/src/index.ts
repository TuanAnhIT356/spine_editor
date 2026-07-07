/**
 * @spine-editor/core — framework-agnostic heart of the editor.
 *
 * Will contain (Phase 1+): the document model (skeleton/slots/skins/animations),
 * the command system with undo/redo, the animation evaluator, and the
 * Spine JSON serializer/parser. No UI dependencies are allowed in this package.
 */

export { SPINE_JSON_TARGET_VERSION } from '@spine-editor/shared';
export type { SpineJson, SpineSkeletonMeta, SpineBone } from './spine-json/types.js';
