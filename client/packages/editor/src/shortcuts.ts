export interface ShortcutEntry {
  keys: string;
  description: string;
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: '1–6', description: 'Select / Translate / Rotate / Scale / Shear / Create tool' },
  { keys: 'Space', description: 'Play or pause the current animation' },
  { keys: '← / →', description: 'Step one frame back / forward (30fps)' },
  { keys: 'Ctrl/Cmd + Z', description: 'Undo' },
  { keys: 'Ctrl/Cmd + Shift + Z, or Ctrl/Cmd + Y', description: 'Redo' },
  { keys: 'Ctrl/Cmd + S', description: 'Save project file' },
  { keys: 'Ctrl/Cmd + A', description: 'Select all bones' },
  { keys: 'Delete / Backspace', description: 'Delete selected keys (timeline) or bones/slots' },
  { keys: 'Drag empty dopesheet area', description: 'Box-select keyframes' },
  { keys: 'Escape', description: 'Exit mesh editing, or clear the selection' },
  { keys: 'Shift/Ctrl + Click (bone)', description: 'Add or remove a bone from the selection' },
  { keys: 'Drag empty viewport (Select tool)', description: 'Marquee-select bones' },
  { keys: 'Ctrl/Cmd + Scroll (Timeline)', description: 'Zoom the timeline ruler' },
  { keys: '?', description: 'Toggle this shortcuts panel' },
];
