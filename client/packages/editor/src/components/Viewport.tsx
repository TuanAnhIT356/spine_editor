import {
  AddBone,
  Composite,
  IDENTITY,
  PhysicsSimulator,
  SetAttachmentVertices,
  SetBoneTransform,
  SetMeshGeometry,
  UpsertBoneKeyframe,
  UpsertDeformKeyframe,
  addMeshVertex,
  adjustVertexWeight,
  applyLinear,
  applyMat,
  boneWeightPerVertex,
  boundBoneIndices,
  computeAnimatedAttachments,
  computeAnimatedColors,
  computeAnimatedDarkColors,
  computeAnimatedDeforms,
  computeAnimatedDrawOrder,
  computeAnimatedLocals,
  computeAnimatedPath,
  computeVertexWorldPositions,
  createBone,
  getAnimationDuration,
  invertMat,
  isWeightedVertices,
  meshVertexCount,
  removeMeshVertex,
  type BoneData,
  type Command,
  type Mat2D,
  type SpineBoneKey,
  type SpineDeformKey,
} from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { bridgeRuntime } from '../bridge/runtime.js';
import { primarySelection, uniqueName, useEditor, type SelectionItem } from '../state/store.js';
import { SceneRenderer, attachmentVertexCount, type RenderInput } from '../viewport/renderer.js';
import { Breadcrumb } from './Breadcrumb.js';
import { ModeBanner } from './ModeBanner.js';
import { WEIGHT_COLORS } from './weight-colors.js';
import { ToolCluster } from './ToolCluster.js';
import { ZoomControl } from './ZoomControl.js';

const RAD_DEG = 180 / Math.PI;
const round2 = (v: number) => Math.round(v * 100) / 100;

function makeKey(time: number, fields: Omit<SpineBoneKey, 'time'>): SpineBoneKey {
  return time > 0 ? { time: round2(time), ...fields } : { ...fields };
}

/** Bound bones → palette colors for the weights overlay (order = boundBoneIndices). */
function weightColorMap(
  state: ReturnType<typeof useEditor.getState>,
): Map<string, number> | undefined {
  const edit = state.meshEdit;
  if (!edit) return undefined;
  const att = state.doc.data.skins.find((s) => s.name === 'default')?.attachments?.[edit.slot]?.[
    edit.attachment
  ];
  if (!att || att.type !== 'mesh') return undefined;
  const count = meshVertexCount(att);
  if (!isWeightedVertices(att.vertices, count)) return undefined;
  const map = new Map<string, number>();
  boundBoneIndices(att.vertices, count).forEach((bi, i) => {
    const name = state.doc.data.bones[bi]?.name;
    if (name) map.set(name, WEIGHT_COLORS[i % WEIGHT_COLORS.length]!);
  });
  return map;
}

type DragState =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'vertex'; index: number }
  | { kind: 'paint' }
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
      kind: 'scale';
      bones: string[];
      startX: number;
      startY: number;
      startScales: Map<string, { x: number; y: number }>;
    }
  | {
      kind: 'shear';
      bones: string[];
      startX: number;
      startY: number;
      startShears: Map<string, { x: number; y: number }>;
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
  /** Uncommitted vertex array during a mesh-edit drag or paint stroke. */
  const editVertsRef = useRef<number[] | null>(null);
  /** Deterministic physics preview; rebuilt whenever the document changes. */
  const physicsRef = useRef<PhysicsSimulator | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  const revision = useEditor((s) => s.revision);
  const selection = useEditor((s) => s.selection);
  const assets = useEditor((s) => s.assets);
  const mode = useEditor((s) => s.mode);
  const meshEdit = useEditor((s) => s.meshEdit);
  const activeSkin = useEditor((s) => s.activeSkin);
  const animCurrent = useEditor((s) => s.anim.current);
  const animTime = useEditor((s) => s.anim.time);
  const animGhost = useEditor((s) => s.anim.ghost);
  const ghostConfig = useEditor((s) => s.ghostConfig);
  const viewFilters = useEditor((s) => s.viewFilters);
  const hiddenBones = useEditor((s) => s.hiddenBones);
  const hiddenSlots = useEditor((s) => s.hiddenSlots);
  const posePreview = useEditor((s) => s.posePreview);

  /** Locals the tools operate on: setup pose, or the animated pose in animate mode. */
  function baseLocals(): BoneData[] {
    const state = useEditor.getState();
    const { doc, mode: m, anim } = state;
    const overlay = (locals: BoneData[]): BoneData[] => {
      const preview = state.posePreview;
      if (!preview) return locals;
      return locals.map((b) => (preview[b.name] ? { ...b, ...preview[b.name] } : b));
    };
    if (m === 'animate' && anim.current && doc.data.animations[anim.current]) {
      if (doc.data.physics.length > 0) {
        physicsRef.current ??= new PhysicsSimulator(doc.data);
        return overlay(physicsRef.current.localsAt(anim.current, anim.time));
      }
      return overlay(computeAnimatedLocals(doc.data, anim.current, anim.time));
    }
    return doc.data.bones;
  }

  /** Onion-skin poses around the playhead: past (blue) + future (green) per ghostConfig. */
  function buildGhosts(): RenderInput['ghosts'] {
    const state = useEditor.getState();
    const { doc, anim, ghostConfig } = state;
    if (!anim.ghost || !anim.current) return undefined;
    const animation = doc.getAnimation(anim.current);
    if (!animation) return undefined;
    const duration = getAnimationDuration(animation);
    const spacing = Math.max(ghostConfig.spacingFrames, 1) / 30;
    const alpha = 0.7 * ghostConfig.opacity;
    const steps: number[] = [];
    for (let i = -Math.round(ghostConfig.before); i < 0; i++) steps.push(i);
    for (let i = 1; i <= Math.round(ghostConfig.after); i++) steps.push(i);
    const ghosts: NonNullable<RenderInput['ghosts']> = [];
    for (const step of steps) {
      const t = anim.time + step * spacing;
      if (t < 0 || t > duration || Math.abs(t - anim.time) < 1e-6) continue;
      ghosts.push({
        bones: computeAnimatedLocals(doc.data, anim.current, t),
        color: step < 0 ? 0x5b87b5 : 0x5bb587,
        alpha,
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
      slotDarks: animating
        ? computeAnimatedDarkColors(state.doc.data, state.anim.current!, state.anim.time)
        : undefined,
      deforms: animating
        ? computeAnimatedDeforms(state.doc.data, state.anim.current!, state.anim.time)
        : undefined,
      slotOrder: animating
        ? computeAnimatedDrawOrder(state.doc.data, state.anim.current!, state.anim.time)
        : undefined,
      pathOverrides: animating
        ? computeAnimatedPath(state.doc.data, state.anim.current!, state.anim.time)
        : undefined,
      ghosts: animating ? buildGhosts() : undefined,
      editTarget: state.meshEdit
        ? {
            slot: state.meshEdit.slot,
            attachment: state.meshEdit.attachment,
            overrideVertices: editVertsRef.current ?? undefined,
            weightBone: state.meshEdit.mode === 'weights' ? state.meshEdit.paintBone : null,
            weightColors: state.meshEdit.mode === 'weights' ? weightColorMap(state) : undefined,
          }
        : undefined,
      activeSkin: state.activeSkin,
      assets: state.assets,
      selection: state.selection,
      hiddenBones: state.hiddenBones.length ? new Set(state.hiddenBones) : undefined,
      hiddenSlots: state.hiddenSlots.length ? new Set(state.hiddenSlots) : undefined,
    };
  }

  function redraw() {
    const r = rendererRef.current;
    if (!r?.ready) return;
    r.setViewFilters(useEditor.getState().viewFilters);
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

  // Document edits invalidate the physics state (constraints/anim changed).
  useEffect(() => {
    physicsRef.current = null;
  }, [revision]);

  useEffect(redraw, [
    revision,
    selection,
    assets,
    mode,
    meshEdit,
    activeSkin,
    animCurrent,
    animTime,
    animGhost,
    ghostConfig,
    viewFilters,
    hiddenBones,
    hiddenSlots,
    posePreview,
  ]);

  function localPoint(e: React.PointerEvent): { x: number; y: number } {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Attachment/pose context for the active mesh-edit session, or null. */
  function editContext() {
    const state = useEditor.getState();
    const r = rendererRef.current;
    const edit = state.meshEdit;
    if (!edit || !r) return null;
    const slot = state.doc.findSlot(edit.slot);
    const att = state.doc.data.skins.find((s) => s.name === 'default')?.attachments?.[edit.slot]?.[
      edit.attachment
    ];
    const boneWorld = slot ? r.getBoneWorld(slot.bone) : undefined;
    if (!slot || !att || !boneWorld) return null;
    const count = attachmentVertexCount(att);
    if (count === null) return null;
    const vertices = (att as { vertices: number[] }).vertices;
    return {
      edit,
      slot,
      att,
      count,
      vertices,
      boneWorld,
      weighted: isWeightedVertices(vertices, count),
      renderer: r,
    };
  }

  /** Deform offsets active at the playhead for the edit target (animate mode). */
  function currentDeform(
    ctx: NonNullable<ReturnType<typeof editContext>>,
  ): Float32Array | undefined {
    const state = useEditor.getState();
    if (ctx.att.type !== 'mesh' || state.mode !== 'animate' || !state.anim.current) {
      return undefined;
    }
    return computeAnimatedDeforms(state.doc.data, state.anim.current, state.anim.time)
      .get(ctx.edit.slot)
      ?.get(ctx.edit.attachment);
  }

  /** World x,y per vertex for the edit target (uses the working copy if any). */
  function editWorldPositions(ctx: NonNullable<ReturnType<typeof editContext>>): Float32Array {
    const state = useEditor.getState();
    return computeVertexWorldPositions(
      editVertsRef.current ?? ctx.vertices,
      ctx.count,
      ctx.boneWorld,
      state.doc.data.bones,
      // Renderer's last pose matches what's on screen (incl. animation).
      new Map(state.doc.data.bones.map((b) => [b.name, ctx.renderer.getBoneWorld(b.name)!])),
      currentDeform(ctx),
    );
  }

  /** One weight-brush dab at screen point p (radius 30px, falloff to edge). */
  function paintDab(
    ctx: NonNullable<ReturnType<typeof editContext>>,
    p: { x: number; y: number },
    subtract = false,
  ) {
    const state = useEditor.getState();
    const boneName = ctx.edit.paintBone;
    if (!boneName) return;
    const boneIndex = state.doc.data.bones.findIndex((b) => b.name === boneName);
    const paintBoneWorld = ctx.renderer.getBoneWorld(boneName);
    if (boneIndex < 0 || !paintBoneWorld) return;
    const invPaint = invertMat(paintBoneWorld);
    const radius = 30;
    const amount = state.meshEdit?.paintAmount ?? 0.2;
    const mode = state.meshEdit?.paintMode ?? 'add';
    let working = editVertsRef.current ?? [...ctx.vertices];
    // Replace mode targets an absolute weight, so it needs the start-of-dab weights.
    const curWeights =
      mode === 'replace' ? boneWeightPerVertex(working, ctx.count, boneIndex) : null;
    const positions = editWorldPositions(ctx);
    for (let v = 0; v < ctx.count; v++) {
      const s = ctx.renderer.worldToScreen(positions[v * 2]!, positions[v * 2 + 1]!);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      const delta = curWeights
        ? amount * falloff - curWeights[v]!
        : (subtract ? -1 : 1) * amount * falloff;
      const local = applyMat(invPaint, positions[v * 2]!, positions[v * 2 + 1]!);
      try {
        working = adjustVertexWeight(working, ctx.count, v, boneIndex, delta, {
          x: Math.round(local.x * 100) / 100,
          y: Math.round(local.y * 100) / 100,
        });
      } catch {
        return; // unweighted — Properties panel guides the user to bind first
      }
    }
    editVertsRef.current = working;
    redraw();
  }

  function onPointerDown(e: React.PointerEvent) {
    const r = rendererRef.current;
    if (!r?.ready) return;
    // Shell overlays (banner, tool cluster, breadcrumb, zoom) handle their own
    // clicks — capturing their pointers here would swallow the button events.
    if (
      (e.target as HTMLElement).closest?.('.mode-banner, .tool-cluster, .breadcrumb, .zoom-control')
    ) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    if (e.button === 1 || e.button === 2) {
      dragRef.current = { kind: 'pan', lastX: p.x, lastY: p.y };
      return;
    }
    if (e.button !== 0) return;

    const state = useEditor.getState();

    // Mesh-edit session: vertex dragging / weight painting replaces the tools.
    const ctx = editContext();
    if (ctx) {
      if (ctx.edit.mode === 'create' || ctx.edit.mode === 'delete') {
        if (state.mode !== 'setup') {
          state.setError('Add/remove mesh vertices in setup mode only.');
          return;
        }
        if (ctx.att.type !== 'mesh') {
          state.setError('Add/remove vertices works on meshes only.');
          return;
        }
        const mesh = ctx.att;
        try {
          let next;
          if (ctx.edit.mode === 'create') {
            const wpt = r.screenToWorld(p.x, p.y);
            const inv = invertMat(ctx.boneWorld);
            const lp = applyMat(inv, wpt.x, wpt.y);
            next = addMeshVertex(state.doc.data, ctx.edit.slot, mesh, lp.x, lp.y);
          } else {
            const positions = editWorldPositions(ctx);
            let best = -1;
            let bestDist = 12;
            for (let v = 0; v < ctx.count; v++) {
              const sp = r.worldToScreen(positions[v * 2]!, positions[v * 2 + 1]!);
              const d = Math.hypot(sp.x - p.x, sp.y - p.y);
              if (d < bestDist) {
                bestDist = d;
                best = v;
              }
            }
            if (best < 0) return;
            next = removeMeshVertex(state.doc.data, ctx.edit.slot, mesh, best);
          }
          state.execute(
            new SetMeshGeometry('default', ctx.edit.slot, ctx.edit.attachment, {
              vertices: next.vertices,
              uvs: next.uvs,
              triangles: next.triangles,
              hull: next.hull ?? next.uvs.length / 2,
            }),
          );
        } catch (err) {
          state.setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (ctx.edit.mode === 'weights') {
        if (!ctx.weighted) {
          state.setError('Bind bones first (Weights section in the Properties panel).');
          return;
        }
        if (!ctx.edit.paintBone) {
          state.setError('Pick a bone to paint in the Properties panel.');
          return;
        }
        dragRef.current = { kind: 'paint' };
        paintDab(ctx, p, e.shiftKey);
        return;
      }
      // Vertices mode: grab the nearest handle within 12px.
      const positions = editWorldPositions(ctx);
      let best = -1;
      let bestDist = 12;
      for (let v = 0; v < ctx.count; v++) {
        const s = r.worldToScreen(positions[v * 2]!, positions[v * 2 + 1]!);
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = v;
        }
      }
      if (best < 0) return;
      if (ctx.weighted) {
        state.setError(
          'Weighted vertices follow their bones — switch to Weights mode to adjust influence.',
        );
        return;
      }
      dragRef.current = { kind: 'vertex', index: best };
      editVertsRef.current = [...ctx.vertices];
      return;
    }

    const base = baseLocals();
    // Selection filter: bones ignored by picking when their select dot is off.
    const hit = state.viewFilters.bones.select ? r.hitTest(p.x, p.y) : null;
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
      case 'rotate':
      case 'scale':
      case 'shear': {
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

        if (state.tool === 'scale' || state.tool === 'shear') {
          const startVals = new Map<string, { x: number; y: number }>();
          for (const boneName of activeBones) {
            const bone = base.find((b) => b.name === boneName);
            if (!bone) continue;
            startVals.set(
              boneName,
              state.tool === 'scale'
                ? { x: bone.scaleX, y: bone.scaleY }
                : { x: bone.shearX, y: bone.shearY },
            );
          }
          dragRef.current =
            state.tool === 'scale'
              ? {
                  kind: 'scale',
                  bones: [...startVals.keys()],
                  startX: p.x,
                  startY: p.y,
                  startScales: startVals,
                }
              : {
                  kind: 'shear',
                  bones: [...startVals.keys()],
                  startX: p.x,
                  startY: p.y,
                  startShears: startVals,
                };
          return;
        }

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
    if (drag.kind === 'vertex') {
      const ctx = editContext();
      const working = editVertsRef.current;
      if (!ctx || !working) return;
      const world = r.screenToWorld(p.x, p.y);
      const local = applyMat(invertMat(ctx.boneWorld), world.x, world.y);
      // The overlay adds the current deform on top of the working copy, so
      // store the handle position minus the deform to keep it under the cursor.
      const deform = currentDeform(ctx);
      const i = drag.index * 2;
      working[i] = Math.round((local.x - (deform?.[i] ?? 0)) * 100) / 100;
      working[i + 1] = Math.round((local.y - (deform?.[i + 1] ?? 0)) * 100) / 100;
      redraw();
      return;
    }
    if (drag.kind === 'paint') {
      const ctx = editContext();
      if (ctx) paintDab(ctx, p, e.shiftKey);
      return;
    }
    const world = r.screenToWorld(p.x, p.y);
    const base = baseLocals();
    if (drag.kind === 'translate') {
      let wx = world.x - drag.startWorld.x;
      let wy = world.y - drag.startWorld.y;
      if (e.shiftKey) {
        // Shift constrains the drag to the dominant axis of the chosen frame
        // (Local = bone axes, Parent = parent axes, World = screen axes).
        const s = useEditor.getState();
        let ax = { x: 1, y: 0 };
        let ay = { x: 0, y: 1 };
        if (s.axesMode !== 'world') {
          const ref =
            s.axesMode === 'local'
              ? drag.bones[0]!
              : (s.doc.findBone(drag.bones[0]!)?.parent ?? null);
          const m = ref ? r.getBoneWorld(ref) : undefined;
          if (m) {
            const lx = Math.hypot(m.a, m.b) || 1;
            const ly = Math.hypot(m.c, m.d) || 1;
            ax = { x: m.a / lx, y: m.b / lx };
            ay = { x: m.c / ly, y: m.d / ly };
          }
        }
        const dot = (v: { x: number; y: number }) => wx * v.x + wy * v.y;
        const px = dot(ax);
        const py = dot(ay);
        if (Math.abs(px) >= Math.abs(py)) {
          wx = ax.x * px;
          wy = ax.y * px;
        } else {
          wx = ay.x * py;
          wy = ay.y * py;
        }
      }
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
    } else if (drag.kind === 'scale') {
      // Horizontal drag scales X, vertical scales Y (up = grow); 120px = ×2.
      const fx = 1 + (p.x - drag.startX) / 120;
      const fy = 1 + (drag.startY - p.y) / 120;
      overrideRef.current = base.map((b) => {
        const s0 = drag.startScales.get(b.name);
        return s0 ? { ...b, scaleX: s0.x * fx, scaleY: s0.y * fy } : b;
      });
    } else if (drag.kind === 'shear') {
      const dx = (p.x - drag.startX) / 2;
      const dy = (drag.startY - p.y) / 2;
      overrideRef.current = base.map((b) => {
        const s0 = drag.startShears.get(b.name);
        return s0 ? { ...b, shearX: s0.x + dx, shearY: s0.y + dy } : b;
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
    if (animating && !state.autoKey && drag.kind === 'vertex') {
      state.setError('Auto Key is off — enable it to key deform changes.');
      redraw();
      return;
    }
    if (
      animating &&
      !state.autoKey &&
      (drag.kind === 'translate' ||
        drag.kind === 'rotate' ||
        drag.kind === 'scale' ||
        drag.kind === 'shear') &&
      override
    ) {
      // Transient pose (Spine-style): show the pose without keying it.
      for (const boneName of drag.bones) {
        const b = override.find((x) => x.name === boneName);
        if (!b) continue;
        if (drag.kind === 'translate') state.setPosePreview(boneName, { x: b.x, y: b.y });
        else if (drag.kind === 'rotate') state.setPosePreview(boneName, { rotation: b.rotation });
        else if (drag.kind === 'scale')
          state.setPosePreview(boneName, { scaleX: b.scaleX, scaleY: b.scaleY });
        else state.setPosePreview(boneName, { shearX: b.shearX, shearY: b.shearY });
      }
      redraw();
      return;
    }

    if (drag.kind === 'vertex' || drag.kind === 'paint') {
      const ctx = editContext();
      const working = editVertsRef.current;
      editVertsRef.current = null;
      if (!ctx || !working) {
        redraw();
        return;
      }
      if (drag.kind === 'vertex' && animating && state.anim.current && ctx.att.type === 'mesh') {
        // Auto-key: deform offsets are relative to the setup vertices; the
        // working copy excludes the sampled deform, so add it back in.
        const deform = currentDeform(ctx);
        const offsets = working.map(
          (v, i) => Math.round((v + (deform?.[i] ?? 0) - (ctx.vertices[i] ?? 0)) * 100) / 100,
        );
        const time = Math.round(state.anim.time * 100) / 100;
        const key: SpineDeformKey = { vertices: offsets };
        if (time > 0) key.time = time;
        state.execute(
          new UpsertDeformKeyframe(
            state.anim.current,
            'default',
            ctx.edit.slot,
            ctx.edit.attachment,
            key,
          ),
        );
      } else {
        state.execute(
          new SetAttachmentVertices('default', ctx.edit.slot, ctx.edit.attachment, working),
        );
      }
      redraw();
      return;
    }

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
      if (!state.viewFilters.bones.select) return;
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
    } else if (drag.kind === 'scale' && override) {
      const commands: Command[] = [];
      for (const boneName of drag.bones) {
        const b = override.find((x) => x.name === boneName);
        if (!b) continue;
        if (animating && state.anim.current) {
          const setup = state.doc.findBone(boneName);
          if (!setup) continue;
          // Scale keys are FACTORS multiplied with the setup scale.
          commands.push(
            new UpsertBoneKeyframe(
              state.anim.current,
              boneName,
              'scale',
              makeKey(state.anim.time, {
                x: round2(b.scaleX / (setup.scaleX || 1)),
                y: round2(b.scaleY / (setup.scaleY || 1)),
              }),
            ),
          );
        } else {
          commands.push(
            new SetBoneTransform(boneName, {
              scaleX: round2(b.scaleX),
              scaleY: round2(b.scaleY),
            }),
          );
        }
      }
      if (commands.length === 1) state.execute(commands[0]!);
      else if (commands.length > 1)
        state.execute(new Composite(`Scale ${commands.length} bones`, commands));
    } else if (drag.kind === 'shear' && override) {
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
              'shear',
              makeKey(state.anim.time, {
                x: round2(b.shearX - setup.shearX),
                y: round2(b.shearY - setup.shearY),
              }),
            ),
          );
        } else {
          commands.push(
            new SetBoneTransform(boneName, {
              shearX: round2(b.shearX),
              shearY: round2(b.shearY),
            }),
          );
        }
      }
      if (commands.length === 1) state.execute(commands[0]!);
      else if (commands.length > 1)
        state.execute(new Composite(`Shear ${commands.length} bones`, commands));
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
      <ModeBanner />
      <Breadcrumb />
      <ToolCluster />
      <ZoomControl getRenderer={() => rendererRef.current} />
    </div>
  );
}
