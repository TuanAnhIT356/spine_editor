import {
  AddBone,
  IDENTITY,
  SetBoneTransform,
  applyLinear,
  applyMat,
  createBone,
  invertMat,
  type BoneData,
  type Mat2D,
} from '@spine-editor/core';
import { useEffect, useRef } from 'react';
import { uniqueName, useEditor } from '../state/store.js';
import { SceneRenderer } from '../viewport/renderer.js';

const RAD_DEG = 180 / Math.PI;
const round2 = (v: number) => Math.round(v * 100) / 100;

type DragState =
  | { kind: 'pan'; lastX: number; lastY: number }
  | {
      kind: 'translate';
      bone: string;
      startWorld: { x: number; y: number };
      startLocal: { x: number; y: number };
      invParent: Mat2D;
    }
  | {
      kind: 'rotate';
      bone: string;
      origin: { x: number; y: number };
      startAngle: number;
      startRotation: number;
    }
  | {
      kind: 'create';
      invParent: Mat2D;
      start: { x: number; y: number };
      temp: BoneData;
    };

export function Viewport() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const overrideRef = useRef<BoneData[] | undefined>(undefined);

  const revision = useEditor((s) => s.revision);
  const selection = useEditor((s) => s.selection);
  const assets = useEditor((s) => s.assets);

  function redraw() {
    const r = rendererRef.current;
    if (!r?.ready) return;
    const state = useEditor.getState();
    void r.render({
      data: state.doc.data,
      bonesOverride: overrideRef.current,
      assets: state.assets,
      selection: state.selection,
    });
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new SceneRenderer();
    rendererRef.current = renderer;
    void renderer.init(host).then(() => redraw());
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      renderer.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      redraw();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(redraw, [revision, selection, assets]);

  function localPoint(e: React.PointerEvent): { x: number; y: number } {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent) {
    const r = rendererRef.current;
    if (!r?.ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    if (e.button === 1 || e.button === 2) {
      dragRef.current = { kind: 'pan', lastX: p.x, lastY: p.y };
      return;
    }
    if (e.button !== 0) return;

    const state = useEditor.getState();
    const data = state.doc.data;
    const hit = r.hitTest(p.x, p.y);
    const world = r.screenToWorld(p.x, p.y);

    switch (state.tool) {
      case 'select': {
        if (hit) state.select({ kind: 'bone', name: hit });
        else {
          state.select(null);
          dragRef.current = { kind: 'pan', lastX: p.x, lastY: p.y };
        }
        return;
      }
      case 'translate':
      case 'rotate': {
        const name = hit ?? (state.selection?.kind === 'bone' ? state.selection.name : null);
        if (!name) return;
        state.select({ kind: 'bone', name });
        const bone = data.bones.find((b) => b.name === name);
        if (!bone) return;
        if (state.tool === 'translate') {
          const parentWorld = bone.parent !== null ? r.getBoneWorld(bone.parent) : undefined;
          dragRef.current = {
            kind: 'translate',
            bone: name,
            startWorld: world,
            startLocal: { x: bone.x, y: bone.y },
            invParent: invertMat(parentWorld ?? IDENTITY),
          };
        } else {
          const m = r.getBoneWorld(name);
          if (!m) return;
          dragRef.current = {
            kind: 'rotate',
            bone: name,
            origin: { x: m.tx, y: m.ty },
            startAngle: Math.atan2(world.y - m.ty, world.x - m.tx),
            startRotation: bone.rotation,
          };
        }
        return;
      }
      case 'create': {
        const parentName =
          hit ?? (state.selection?.kind === 'bone' ? state.selection.name : 'root');
        const invParent = invertMat(r.getBoneWorld(parentName) ?? IDENTITY);
        const start = applyMat(invParent, world.x, world.y);
        const name = uniqueName('bone', (n) => data.bones.some((b) => b.name === n));
        const temp = createBone(name, parentName, { x: start.x, y: start.y });
        dragRef.current = { kind: 'create', invParent, start, temp };
        overrideRef.current = [...data.bones, temp];
        redraw();
        return;
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const r = rendererRef.current;
    const drag = dragRef.current;
    if (!r?.ready || !drag) return;
    const p = localPoint(e);
    if (drag.kind === 'pan') {
      r.panBy(p.x - drag.lastX, p.y - drag.lastY);
      drag.lastX = p.x;
      drag.lastY = p.y;
      redraw();
      return;
    }
    const world = r.screenToWorld(p.x, p.y);
    const data = useEditor.getState().doc.data;
    if (drag.kind === 'translate') {
      const d = applyLinear(
        drag.invParent,
        world.x - drag.startWorld.x,
        world.y - drag.startWorld.y,
      );
      overrideRef.current = data.bones.map((b) =>
        b.name === drag.bone ? { ...b, x: drag.startLocal.x + d.x, y: drag.startLocal.y + d.y } : b,
      );
    } else if (drag.kind === 'rotate') {
      const angle = Math.atan2(world.y - drag.origin.y, world.x - drag.origin.x);
      const rotation = drag.startRotation + (angle - drag.startAngle) * RAD_DEG;
      overrideRef.current = data.bones.map((b) => (b.name === drag.bone ? { ...b, rotation } : b));
    } else {
      const lp = applyMat(drag.invParent, world.x, world.y);
      const dx = lp.x - drag.start.x;
      const dy = lp.y - drag.start.y;
      drag.temp.length = Math.hypot(dx, dy);
      drag.temp.rotation = Math.atan2(dy, dx) * RAD_DEG;
      overrideRef.current = [...data.bones, { ...drag.temp }];
    }
    redraw();
  }

  function onPointerUp() {
    const drag = dragRef.current;
    const override = overrideRef.current;
    dragRef.current = null;
    overrideRef.current = undefined;
    if (!drag || drag.kind === 'pan') return;
    const state = useEditor.getState();
    if (drag.kind === 'translate' && override) {
      const b = override.find((x) => x.name === drag.bone);
      if (b) state.execute(new SetBoneTransform(drag.bone, { x: round2(b.x), y: round2(b.y) }));
    } else if (drag.kind === 'rotate' && override) {
      const b = override.find((x) => x.name === drag.bone);
      if (b) state.execute(new SetBoneTransform(drag.bone, { rotation: round2(b.rotation) }));
    } else if (drag.kind === 'create') {
      if (drag.temp.length > 4) {
        const ok = state.execute(
          new AddBone({
            ...drag.temp,
            x: round2(drag.temp.x),
            y: round2(drag.temp.y),
            rotation: round2(drag.temp.rotation),
            length: round2(drag.temp.length),
          }),
        );
        if (ok) {
          state.select({ kind: 'bone', name: drag.temp.name });
          return;
        }
      }
      redraw();
    }
  }

  return (
    <div
      ref={hostRef}
      className="viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
