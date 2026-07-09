/**
 * @spine-editor/core — framework-agnostic heart of the editor.
 *
 * Contains the document model (skeleton/slots/skins/animations), the command
 * system with undo/redo, and the Spine JSON serializer/parser. The animation
 * evaluator arrives in Phase 3. No UI dependencies are allowed in this package.
 */

export { SPINE_JSON_TARGET_VERSION } from '@spine-editor/shared';

export * from './spine-json/types.js';
export * from './spine-json/parse.js';
export * from './spine-json/serialize.js';
export * from './model/types.js';
export * from './model/factories.js';
export * from './validate.js';
export * from './document.js';
export * from './pose.js';
export * from './evaluate.js';
export * from './commands/history.js';
export * from './commands/bones.js';
export * from './commands/slots.js';
export * from './commands/animations.js';
export * from './commands/composite.js';
export * from './commands/structure.js';
export * from './commands/constraints.js';
export * from './commands/events.js';
export * from './atlas.js';
export * from './mesh.js';
export * from './weights.js';
// path.ts registers the path-constraint applier with pose.ts on import.
export * from './path.js';
export * from './physics.js';
