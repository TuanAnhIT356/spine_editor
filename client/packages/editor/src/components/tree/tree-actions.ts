import {
  ReorderSlot,
  UpsertDrawOrderKeyframe,
  computeAnimatedDrawOrder,
  computeDrawOrderOffsets,
} from '@spine-editor/core';
import { useEditor, type SelectionItem } from '../../state/store.js';

export function clickSelect(e: React.MouseEvent, item: SelectionItem) {
  if (e.shiftKey || e.ctrlKey || e.metaKey) useEditor.getState().toggleSelection(item);
  else useEditor.getState().select(item);
}

/**
 * Moves a slot one step in the draw order. In setup mode this edits the slot
 * array; in animate mode (with an animation open) it keys the draw order at
 * the playhead instead, like Spine.
 */
export function moveSlotInDrawOrder(slotName: string, dir: -1 | 1) {
  const state = useEditor.getState();
  const setupOrder = state.doc.data.slots.map((s) => s.name);
  if (state.mode === 'animate' && state.anim.current) {
    const current = computeAnimatedDrawOrder(
      state.doc.data,
      state.anim.current,
      state.anim.time,
    ) ?? [...setupOrder];
    const idx = current.indexOf(slotName);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= current.length) return;
    const target = [...current];
    target.splice(idx, 1);
    target.splice(to, 0, slotName);
    const time = Math.round(state.anim.time * 100) / 100;
    const key: { time?: number; offsets?: { slot: string; offset: number }[] } = {
      offsets: computeDrawOrderOffsets(setupOrder, target),
    };
    if (time > 0) key.time = time;
    state.execute(new UpsertDrawOrderKeyframe(state.anim.current, key));
    return;
  }
  const idx = setupOrder.indexOf(slotName);
  state.execute(new ReorderSlot(slotName, idx + dir));
}
