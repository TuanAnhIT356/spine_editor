import { useEditor } from '../state/store.js';
import { AnimateIcon, SetupIcon } from './icons.js';

/** Spine-style mode label in the viewport's top-left; click toggles mode. */
export function ModeBanner() {
  const mode = useEditor((s) => s.mode);
  return (
    <button
      className="mode-banner"
      title="Switch mode"
      onClick={() => useEditor.getState().setMode(mode === 'setup' ? 'animate' : 'setup')}
    >
      {mode === 'setup' ? <SetupIcon size={28} /> : <AnimateIcon size={28} />}
      <span>{mode === 'setup' ? 'SETUP' : 'ANIMATE'}</span>
    </button>
  );
}
