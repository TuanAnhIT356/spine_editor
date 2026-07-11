import { useRef } from 'react';

/** Draggable divider that reports pointer movement deltas along one axis. */
export function Resizer({
  axis,
  onResize,
}: {
  axis: 'x' | 'y';
  onResize: (deltaPx: number) => void;
}) {
  const lastPos = useRef<number | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPos.current = axis === 'x' ? e.clientX : e.clientY;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (lastPos.current === null) return;
    const pos = axis === 'x' ? e.clientX : e.clientY;
    onResize(pos - lastPos.current);
    lastPos.current = pos;
  }

  function onPointerUp() {
    lastPos.current = null;
  }

  return (
    <div
      className={`resizer resizer-${axis}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
