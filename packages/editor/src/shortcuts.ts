export interface ShortcutEntry {
  keys: string;
  description: string;
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: '1 / 2 / 3 / 4', description: 'Select / Translate / Rotate / Create tool' },
  { keys: 'Space', description: 'Play or pause the current animation' },
  { keys: 'Ctrl/Cmd + Z', description: 'Undo' },
  { keys: 'Ctrl/Cmd + Shift + Z, or Ctrl/Cmd + Y', description: 'Redo' },
  { keys: 'Ctrl/Cmd + S', description: 'Save project file' },
  { keys: 'Ctrl/Cmd + A', description: 'Select all bones' },
  { keys: 'Delete / Backspace', description: 'Delete the selected bones and slots' },
  { keys: 'Escape', description: 'Clear the selection' },
  { keys: 'Shift/Ctrl + Click (bone)', description: 'Add or remove a bone from the selection' },
  { keys: 'Drag empty viewport (Select tool)', description: 'Marquee-select bones' },
  { keys: 'Ctrl/Cmd + Scroll (Timeline)', description: 'Zoom the timeline ruler' },
  { keys: '?', description: 'Toggle this shortcuts panel' },
];
