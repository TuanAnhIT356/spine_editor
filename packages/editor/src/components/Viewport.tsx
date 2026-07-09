import {
  AddBone,
  Composite,
  IDENTITY,
  SetBoneTransform,
  UpsertBoneKeyframe,
  applyLinear,
  applyMat,
  computeAnimatedAttachments,
  computeAnimatedColors,
  computeAnimatedDeforms,
  computeAnimatedDrawOrder,
  computeAnimatedLocals,
  createBone,
  getAnimationDuration,
  invertMat,
  type BoneData,
  type Command,
  type Mat2D,
  type SpineBoneKey,
} from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { bridgeRuntime } from '../bridge/runtime.js';
import { primarySelection, uniqueName, useEditor, type SelectionItem } from '../state/store.js';
import { SceneRenderer, type RenderInput } from '../viewport/renderer.js';

const RAD_DEG = 180 / Math.PI;
const round2 = (v: number) => Math.round(v * 100) / 100;

function makeKey(time: number, fields: Omit<SpineBoneKey, 'time'>): SpineBoneKey {
  return time > 0 ? { time: round2(time), ...fields } : { ...fields };
}

type DragState =
  | { kind: 'pan'; lastX: number; lastY: number }
  | {
      kind: 'marquee';
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      additive: boolean;
    }
  | {
      kind: 'translate';
      bones: string[];
      startWorld: { x: number; y: number };
      startLocals: Map<string, { x: number; y: number }>;
      invParents: Map<string, Mat2D>;
    }
  | {
      kind: 'rotate';
      bones: string[];
      origin: { x: number; y: number };
      startAngle: number;
      startRotations: Map<string, number>;
    }
  | {
      kind: 'create';
      invParent: Mat2D;
      start: { x: number; y: number };
      temp: BoneData;
    };

interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Viewport() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const overrideRef = useRef<BoneData[] | undefined>(undefined);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  const revision = useEditor((s) => s.revision);
  const selection = useEditor((s) => s.selection);
  const assets = useEditor((s) => s.assets);
  const mode = useEditor((s) => s.mode);
  const animCurrent = useEditor((s) => s.anim.current);
  const animTime = useEditor((s) => s.anim.time);
  const animGhost = useEditor((s) => s.anim.ghost);

  /** Locals the tools operate on: setup pose, or the animated pose in animate mode. */
  function baseLocals(): BoneData[] {
    const state = useEditor.getState();
    const { doc, mode: m, anim } = state;
    if (m === 'animate' && anim.current && doc.data.animations[anim.current]) {
      return computeAnimatedLocals(doc.data, anim.current, anim.time);
    }
    return doc.data.bones;
  }

  /** Onion-skin poses around the playhead: 2 past (blue) + 2 future (green). */
  function buildGhosts(): RenderInput['ghosts'] {
    const state = useEditor.getState();
    const { doc, anim } = state;
    if (!anim.ghost || !anim.current) return undefined;
    const animation = doc.getAnimation(anim.current);
    if (!animation) return undefined;
    const duration = getAnimationDuration(animation);
    const spacing = Math.max(duration / 12, 1 / 30);
    const ghosts: NonNullable<RenderInput['ghosts']> = [];
    for (const step of [-2, -1, 1, 2]) {
      const t = anim.time + step * spacing;
      if (t < 0 || t > duration || Math.abs(t - anim.time) < 1e-6) continue;
      ghosts.push({
        bones: computeAnimatedLocals(doc.data, anim.current, t),
        color: step < 0 ? 0x5b87b5 : 0x5bb587,
      });
    }
    return ghosts.length > 0 ? ghosts : undefined;
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
      slotOrder: animating
        ? computeAnimatedDrawOrder(state.doc.data, state.anim.current!, state.anim.time)
        : undefined,
      ghosts: animating ? buildGhosts() : undefined,
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

  useEffect(redraw, [revision, selection, assets, mode, animCurrent, animTime, animGhost]);

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
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const primary = primarySelection(state.selection);

    switch (state.tool) {
      case 'select': {
        if (hit) {
          if (additive) state.toggleSelection({ kind: 'bone', name: hit });
          else state.select({ kind: 'bone', name: hit });
        } else {
          if (!additive) state.select(null);
          dragRef.current = {
            kind: 'marquee',
            startX: p.x,
            startY: p.y,
            endX: p.x,
            endY: p.y,
            additive,
          };
        }
        return;
      }
      case 'translate':
      case 'rotate': {
        const name = hit ?? (primary?.kind === 'bone' ? primary.name : null);
        if (!name) return;
        const alreadySelected = state.selection.some((s) => s.kind === 'bone' && s.name === name);
        if (additive && !alreadySelected) state.addToSelection({ kind: 'bone', name });
        else if (!additive && !alreadySelected) state.select({ kind: 'bone', name });
        // If already part of a multi-selection, keep the whole group selected and drag it together.

        const bones = useEditor
          .getState()
          .selection.filter((s): s is SelectionItem & { kind: 'bone' } => s.kind === 'bone')
          .map((s) => s.name);
        const activeBones = bones.length > 0 ? bones : [name];

        if (state.tool === 'translate') {
          const startLocals = new Map<string, { x: number; y: number }>();
          const invParents = new Map<string, Mat2D>();
          for (const boneName of activeBones) {
            const bone = base.find((b) => b.name === boneName);
            if (!bone) continue;
            const parentWorld = bone.parent !== null ? r.getBoneWorld(bone.parent) : undefined;
            startLocals.set(boneName, { x: bone.x, y: bone.y });
            invParents.set(boneName, invertMat(parentWorld ?? IDENTITY));
          }
          dragRef.current = {
            kind: 'translate',
            bones: [...startLocals.keys()],
            startWorld: world,
            startLocals,
            invParents,
          };
        } else {
          const m = r.getBoneWorld(name);
          if (!m) return;
          const startRotations = new Map<string, number>();
          for (const boneName of activeBones) {
            const bone = base.find((b) => b.name === boneName);
            if (bone) startRotations.set(boneName, bone.rotation);
          }
          dragRef.current = {
            kind: 'rotate',
            bones: [...startRotations.keys()],
            origin: { x: m.tx, y: m.ty },
            startAngle: Math.atan2(world.y - m.ty, world.x - m.tx),
            startRotations,
          };
        }
        return;
      }
      case 'create': {
        if (state.mode === 'animate') return; // rig edits belong to setup mode
        const parentName = hit ?? (primary?.kind === 'bone' ? primary.name : 'root');
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
    if (drag.kind === 'marquee') {
      drag.endX = p.x;
      drag.endY = p.y;
      setMarquee({
        x: Math.min(drag.startX, drag.endX),
        y: Math.min(drag.startY, drag.endY),
        w: Math.abs(drag.endX - drag.startX),
        h: Math.abs(drag.endY - drag.startY),
      });
      return;
    }
    const world = r.screenToWorld(p.x, p.y);
    const base = baseLocals();
    if (drag.kind === 'translate') {
      const wx = world.x - drag.startWorld.x;
      const wy = world.y - drag.startWorld.y;
      overrideRef.current = base.map((b) => {
        const start = drag.startLocals.get(b.name);
        const inv = drag.invParents.get(b.name);
        if (!start || !inv) return b;
        const d = applyLinear(inv, wx, wy);
        return { ...b, x: start.x + d.x, y: start.y + d.y };
      });
    } else if (drag.kind === 'rotate') {
      const angle = Math.atan2(world.y - drag.origin.y, world.x - drag.origin.x);
      const deltaDeg = (angle - drag.startAngle) * RAD_DEG;
      overrideRef.current = base.map((b) => {
        const startRotation = drag.startRotations.get(b.name);
        return startRotation === undefined ? b : { ...b, rotation: startRotation + deltaDeg };
      });
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

    if (drag.kind === 'marquee') {
      const r = rendererRef.current;
      setMarquee(null);
      if (!r) return;
      const x0 = Math.min(drag.startX, drag.endX);
      const x1 = Math.max(drag.startX, drag.endX);
      const y0 = Math.min(drag.startY, drag.endY);
      const y1 = Math.max(drag.startY, drag.endY);
      if (x1 - x0 < 2 && y1 - y0 < 2) return; // treat as a plain click, already handled
      const hits: SelectionItem[] = [];
      for (const bone of state.doc.data.bones) {
        const w = r.getBoneWorld(bone.name);
        if (!w) continue;
        const s = r.worldToScreen(w.tx, w.ty);
        if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1)
          hits.push({ kind: 'bone', name: bone.name });
      }
      if (hits.length === 0) return;
      if (drag.additive) {
        const merged = [...state.selection];
        for (const h of hits) {
          if (!merged.some((m) => m.kind === h.kind && m.name === h.name)) merged.push(h);
        }
        useEditor.setState({ selection: merged });
      } else {
        useEditor.setState({ selection: hits });
      }
      return;
    }

    if (drag.kind === 'translate' && override) {
      const commands: Command[] = [];
      for (const boneName of drag.bones) {
        const b = override.find((x) => x.name === boneName);
        if (!b) continue;
        if (animating && state.anim.current) {
          // Auto-key: timeline stores offsets from the setup pose.
          const setup = state.doc.findBone(boneName);
          if (!setup) continue;
          commands.push(
            new UpsertBoneKeyframe(
              state.anim.current,
              boneName,
              'translate',
              makeKey(state.anim.time, { x: round2(b.x - setup.x), y: round2(b.y - setup.y) }),
            ),
          );
        } else {
          commands.push(new SetBoneTransform(boneName, { x: round2(b.x), y: round2(b.y) }));
        }
      }
      if (commands.length === 1) state.execute(commands[0]!);
      else if (commands.length > 1)
        state.execute(new Composite(`Move ${commands.length} bones`, commands));
    } else if (drag.kind === 'rotate' && override) {
      const commands: Command[] = [];
      for (const boneName of drag.bones) {
        const b = override.find((x) => x.name === boneName);
        if (!b) continue;
        if (animating && state.anim.current) {
          const setup = state.doc.findBone(boneName);
          if (!setup) continue;
          commands.push(
            new UpsertBoneKeyframe(
              state.anim.current,
              boneName,
              'rotate',
              makeKey(state.anim.time, { value: round2(b.rotation - setup.rotation) }),
            ),
          );
        } else {
          commands.push(new SetBoneTransform(boneName, { rotation: round2(b.rotation) }));
        }
      }
      if (commands.length === 1) state.execute(commands[0]!);
      else if (commands.length > 1)
        state.execute(new Composite(`Rotate ${commands.length} bones`, commands));
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
    >
      {marquee && (
        <div
          className="marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}
    </div>
  );
}
