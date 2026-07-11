import { AddSkinAttachment, AddSlot, Composite, createSlot } from '@spine-editor/core';
import type { SegPartCut } from '../server/api.js';
import { uniqueName, useEditor, type ImageAsset } from '../state/store.js';

/** Imports segmented part cuts as assets (with source origin) and optionally
 * places each on the canvas as a root slot + region attachment — one undo step.
 * Shared by the Segment dialog and the segment_image bridge op. */
export function importParts(
  cuts: SegPartCut[],
  imgSize: { w: number; h: number },
  placeOnCanvas: boolean,
): { assets: string[]; slots: string[] } {
  const state = useEditor.getState();
  const newAssets: ImageAsset[] = [];
  const commands = [];
  const slots: string[] = [];
  for (const cut of cuts) {
    let name = cut.name;
    let n = 2;
    while (state.assets[name] || newAssets.some((a) => a.name === name)) {
      name = `${cut.name}-${n++}`;
    }
    newAssets.push({
      name,
      dataUrl: cut.image,
      width: cut.width,
      height: cut.height,
      origin: { x: cut.x, y: cut.y, sourceWidth: imgSize.w, sourceHeight: imgSize.h },
    });
    if (placeOnCanvas) {
      const slotName = uniqueName(name, (s) => state.doc.data.slots.some((sl) => sl.name === s));
      slots.push(slotName);
      commands.push(new AddSlot(createSlot(slotName, 'root', { attachment: name })));
      commands.push(
        new AddSkinAttachment('default', slotName, name, {
          x: cut.x + cut.width / 2 - imgSize.w / 2,
          y: imgSize.h / 2 - (cut.y + cut.height / 2),
          width: cut.width,
          height: cut.height,
        }),
      );
    }
  }
  if (newAssets.length === 0) return { assets: [], slots: [] };
  state.addAssets(newAssets);
  if (commands.length > 0) {
    state.execute(new Composite('Import segmented parts', commands));
  }
  return { assets: newAssets.map((a) => a.name), slots };
}
