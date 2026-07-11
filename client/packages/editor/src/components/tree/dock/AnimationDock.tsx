import { RemoveAnimation, RenameAnimation } from '@spine-editor/core';
import { useEffect, useState } from 'react';
import { useEditor } from '../../../state/store.js';

/** Animation card: rename, open in animate mode, delete. */
export function AnimationDock({ name }: { name: string }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const commitRename = () => {
    const to = text.trim();
    if (!to || to === name) {
      setText(name);
      return;
    }
    const s = useEditor.getState();
    if (s.execute(new RenameAnimation(name, to))) {
      if (s.anim.current === name) s.setAnimation(to);
      s.select({ kind: 'animation', name: to });
    } else {
      setText(name);
    }
  };
  return (
    <>
      <div className="panel-title">Animation</div>
      <label className="field">
        <span>Name</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <button
        onClick={() => {
          useEditor.getState().setAnimation(name);
          useEditor.getState().setMode('animate');
        }}
      >
        Open in Animate
      </button>
      <button
        className="danger"
        onClick={() => {
          const s = useEditor.getState();
          if (s.anim.current === name) s.setAnimation(null);
          if (s.execute(new RemoveAnimation(name))) s.select(null);
        }}
      >
        Delete Animation
      </button>
    </>
  );
}
