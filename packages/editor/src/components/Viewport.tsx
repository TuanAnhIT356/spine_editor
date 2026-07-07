import {
  AddBone,
  IDENTITY,
  SetBoneTransform,
  UpsertBoneKeyframe,
  applyLinear,
  applyMat,
  computeAnimatedAttachments,
  computeAnimatedColors,
  computeAnimatedDeforms,
  computeAnimatedLocals,
  createBone,
  invertMat,
  type BoneData,
  type Mat2D,
  type SpineBoneKey,
} from '@spine-editor/core';
import { useEffect, useRef } from 'react';
import { bridgeRuntime } from '../bridge/runtime.js';
import { uniqueName, useEditor } from '../state/store.js';
import { SceneRenderer, type RenderInput } from '../viewport/renderer.js';

const RAD_DEG = 180 / Math.PI;
const round2 = (v: number) => Math.round(v * 100) / 100;

function makeKey(time: number, fields: Omit<SpineBoneKey, 'time'>): SpineBoneKey {
  return time > 0 ? { time: round2(time), ...fields } : { ...fields };
}

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
  const mode = useEditor((s) => s.mode);
  const animCurrent = useEditor((s) => s.anim.current);
  const animTime = useEditor((s) => s.anim.time);

  /** Locals the tools operate on: setup pose, or the animated pose in animate mode. */
  function baseLocals(): BoneData[] {
    const state = useEditor.getState();
    const { doc, mode: m, anim } = state;
    if (m === 'animate' && anim.current && doc.data.animations[anim.current]) {
      return computeAnimatedLocals(doc.data, anim.current, anim.time);
    }
    return doc.data.bones;
  }

  function buildRenderInput(): RenderInput {
    const state = useEditor.getState();
    const animating = state.mode === 'animate' && state.anim.current;
    const base = overrideRef.current ?? (state.mode === 'animate' ? baseLocals() : undefined);
    return {
      data: state.doc.data,
      bonesOverride: base,
      slotAttachments: animating
        ? computeAnimatedAttachments(state.doc.data, state.anim.current!, state.anim.time)
        : undefined,
      slotColors: animating
        ? computeAnimatedColors(state.doc.data, state.anim.current!, state.anim.time)
        : undefined,
      deforms: animating
        ? computeAnimatedDeforms(state.doc.data, state.anim.current!, state.anim.time)
        : undefined,
      assets: state.assets,
      selection: state.selection,
    };
  }

  function redraw() {
    const r = rendererRef.current;
    if (!r?.ready) return;
    void r.render(buildRenderInput());
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new SceneRenderer();
    rendererRef.current = renderer;
    void renderer.init(host).then(() => redraw());
    bridgeRuntime.renderer = renderer;
    bridgeRuntime.renderNow = async () => {
      if (renderer.ready) await renderer.render(buildRenderInput());
    };
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
      bridgeRuntime.renderer = null;
      bridgeRuntime.renderNow = null;
    };
  }, []);

  useEffect(redraw, [revision, selection, assets, mode, animCurrent, animTime]);

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
    const base = baseLocals();
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
        const bone = base.find((b) => b.name === name);
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
        if (state.mode === 'animate') return; // rig edits belong to setup mode
        const parentName =
          hit ?? (state.selection?.kind === 'bone' ? state.selection.name : 'root');
        const invParent = invertMat(r.getBoneWorld(parentName) ?? IDENTITY);
        const start = applyMat(invParent, world.x, world.y);
        const name = uniqueName('bone', (n) => state.doc.data.bones.some((b) => b.name === n));
        const temp = createBone(name, parentName, { x: start.x, y: start.y });
        dragRef.current = { kind: 'create', invParent, start, temp };
        overrideRef.current = [...state.doc.data.bones, temp];
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
    const base = baseLocals();
    if (drag.kind === 'translate') {
      const d = applyLinear(
        drag.invParent,
        world.x - drag.startWorld.x,
        world.y - drag.startWorld.y,
      );
      overrideRef.current = base.map((b) =>
        b.name === drag.bone ? { ...b, x: drag.startLocal.x + d.x, y: drag.startLocal.y + d.y } : b,
      );
    } else if (drag.kind === 'rotate') {
      const angle = Math.atan2(world.y - drag.origin.y, world.x - drag.origin.x);
      const rotation = drag.startRotation + (angle - drag.startAngle) * RAD_DEG;
      overrideRef.current = base.map((b) => (b.name === drag.bone ? { ...b, rotation } : b));
    } else {
      const lp = applyMat(drag.invParent, world.x, world.y);
      const dx = lp.x - drag.start.x;
      const dy = lp.y - drag.start.y;
      drag.temp.length = Math.hypot(dx, dy);
      drag.temp.rotation = Math.atan2(dy, dx) * RAD_DEG;
      overrideRef.current = [...useEditor.getState().doc.data.bones, { ...drag.temp }];
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
    const animating = state.mode === 'animate' && state.anim.current !== null;

    if (drag.kind === 'translate' && override) {
      const b = override.find((x) => x.name === drag.bone);
      if (!b) return;
      if (animating && state.anim.current) {
        // Auto-key: timeline stores offsets from the setup pose.
        const setup = state.doc.findBone(drag.bone);
        if (!setup) return;
        state.execute(
          new UpsertBoneKeyframe(
            state.anim.current,
            drag.bone,
            'translate',
            makeKey(state.anim.time, { x: round2(b.x - setup.x), y: round2(b.y - setup.y) }),
          ),
        );
      } else {
        state.execute(new SetBoneTransform(drag.bone, { x: round2(b.x), y: round2(b.y) }));
      }
    } else if (drag.kind === 'rotate' && override) {
      const b = override.find((x) => x.name === drag.bone);
      if (!b) return;
      if (animating && state.anim.current) {
        const setup = state.doc.findBone(drag.bone);
        if (!setup) return;
        state.execute(
          new UpsertBoneKeyframe(
            state.anim.current,
            drag.bone,
            'rotate',
            makeKey(state.anim.time, { value: round2(b.rotation - setup.rotation) }),
          ),
        );
      } else {
        state.execute(new SetBoneTransform(drag.bone, { rotation: round2(b.rotation) }));
      }
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
