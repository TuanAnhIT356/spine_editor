import type { Mat2D } from '@spine-editor/core';
import type { AxesMode } from '../state/store.js';

export const GIZMO_HANDLE_PX = 40;
export const GIZMO_RING_PX = 28;
export const GIZMO_HIT_PX = 8;
export const GIZMO_SCALE_BOX_PX = 6;

/** World-space reference frame a gizmo's handles are drawn/dragged along. */
export interface GizmoFrame {
  origin: { x: number; y: number };
  /** Unit vector: world-space direction of the frame's +X axis. */
  axisX: { x: number; y: number };
  /** Unit vector: world-space direction of the frame's +Y axis. */
  axisY: { x: number; y: number };
}

/**
 * Frame per `axesMode` (Spine-style Local/Parent/World), matching the
 * `Mat2D` convention `x' = a·x + b·y + tx, y' = c·x + d·y + ty`: the local
 * +X direction in world space is `(a, c)` and +Y is `(b, d)`.
 */
export function computeFrame(
  axesMode: AxesMode,
  targetWorld: Mat2D,
  parentWorld: Mat2D | undefined,
): GizmoFrame {
  const origin = { x: targetWorld.tx, y: targetWorld.ty };
  if (axesMode === 'world') {
    return { origin, axisX: { x: 1, y: 0 }, axisY: { x: 0, y: 1 } };
  }
  const ref = axesMode === 'local' ? targetWorld : (parentWorld ?? targetWorld);
  const lx = Math.hypot(ref.a, ref.c) || 1;
  const ly = Math.hypot(ref.b, ref.d) || 1;
  return {
    origin,
    axisX: { x: ref.a / lx, y: ref.c / lx },
    axisY: { x: ref.b / ly, y: ref.d / ly },
  };
}

/** A `GizmoFrame` re-expressed in screen-space (unit axis directions, for hit-testing). */
export interface ScreenGizmo {
  origin: { x: number; y: number };
  axisX: { x: number; y: number };
  axisY: { x: number; y: number };
}

export function frameToScreen(
  frame: GizmoFrame,
  worldToScreen: (x: number, y: number) => { x: number; y: number },
): ScreenGizmo {
  const origin = worldToScreen(frame.origin.x, frame.origin.y);
  const px = worldToScreen(frame.origin.x + frame.axisX.x, frame.origin.y + frame.axisX.y);
  const py = worldToScreen(frame.origin.x + frame.axisY.x, frame.origin.y + frame.axisY.y);
  const normalize = (v: { x: number; y: number }) => {
    const len = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / len, y: v.y / len };
  };
  return {
    origin,
    axisX: normalize({ x: px.x - origin.x, y: px.y - origin.y }),
    axisY: normalize({ x: py.x - origin.x, y: py.y - origin.y }),
  };
}

export type GizmoHit = { tool: 'rotate' } | { tool: 'axis'; axis: 'x' | 'y' };

/**
 * Hit-tests a SCREEN-space `point` against the gizmo for `tool`. `origin`/
 * `axisX`/`axisY` are screen-space (from `frameToScreen`); `handleLength`/
 * `ringRadius`/`threshold` are screen pixels.
 */
export function hitTestGizmo(
  tool: 'rotate' | 'translate' | 'scale' | 'shear',
  origin: { x: number; y: number },
  axisX: { x: number; y: number },
  axisY: { x: number; y: number },
  handleLength: number,
  ringRadius: number,
  threshold: number,
  point: { x: number; y: number },
): GizmoHit | null {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (tool === 'rotate') {
    return Math.abs(Math.hypot(dx, dy) - ringRadius) <= threshold ? { tool: 'rotate' } : null;
  }
  const distToHandle = (axis: { x: number; y: number }): number => {
    const t = Math.max(0, Math.min(handleLength, dx * axis.x + dy * axis.y));
    return Math.hypot(dx - axis.x * t, dy - axis.y * t);
  };
  const dX = distToHandle(axisX);
  const dY = distToHandle(axisY);
  if (dX > threshold && dY > threshold) return null;
  return { tool: 'axis', axis: dX <= dY ? 'x' : 'y' };
}

/** World-space displacement of `(dx,dy)` projected onto one frame axis. */
export function projectWorld(
  dx: number,
  dy: number,
  frame: GizmoFrame,
  axis: 'x' | 'y',
): { x: number; y: number } {
  const v = axis === 'x' ? frame.axisX : frame.axisY;
  const amount = dx * v.x + dy * v.y;
  return { x: v.x * amount, y: v.y * amount };
}

/** Signed scalar: `(dx,dy)` projected onto a unit axis vector. */
export function projectScreen(dx: number, dy: number, axis: { x: number; y: number }): number {
  return dx * axis.x + dy * axis.y;
}
