import { describe, expect, it } from 'vitest';
import { IDENTITY, type Mat2D } from '@spine-editor/core';
import {
  computeFrame,
  frameToScreen,
  hitTestGizmo,
  projectScreen,
  projectWorld,
} from '../src/viewport/gizmo.js';

const ROT90: Mat2D = { a: 0, b: -1, c: 1, d: 0, tx: 5, ty: 7 };

describe('computeFrame', () => {
  it('world mode always returns the fixed screen axes at the target origin', () => {
    const f = computeFrame('world', ROT90, undefined);
    expect(f.origin).toEqual({ x: 5, y: 7 });
    expect(f.axisX).toEqual({ x: 1, y: 0 });
    expect(f.axisY).toEqual({ x: 0, y: 1 });
  });

  it('local mode extracts the target matrix columns as world-space axis directions', () => {
    const f = computeFrame('local', ROT90, undefined);
    expect(f.axisX.x).toBeCloseTo(0);
    expect(f.axisX.y).toBeCloseTo(1);
    expect(f.axisY.x).toBeCloseTo(-1);
    expect(f.axisY.y).toBeCloseTo(0);
  });

  it('parent mode uses the parent matrix, falling back to target if absent', () => {
    const f1 = computeFrame('parent', ROT90, IDENTITY);
    expect(f1.axisX).toEqual({ x: 1, y: 0 });
    expect(f1.axisY).toEqual({ x: 0, y: 1 });
    const f2 = computeFrame('parent', ROT90, undefined);
    expect(f2.axisX.y).toBeCloseTo(1);
  });
});

describe('projectWorld / projectScreen', () => {
  it('projects a delta onto one frame axis, zeroing the other component', () => {
    const f = computeFrame('world', IDENTITY, undefined);
    const p = projectWorld(3, 4, f, 'x');
    expect(p).toEqual({ x: 3, y: 0 });
    const q = projectWorld(3, 4, f, 'y');
    expect(q).toEqual({ x: 0, y: 4 });
  });

  it('projectScreen returns a signed scalar along a unit axis', () => {
    expect(projectScreen(10, 0, { x: 1, y: 0 })).toBeCloseTo(10);
    expect(projectScreen(10, 0, { x: -1, y: 0 })).toBeCloseTo(-10);
    expect(projectScreen(0, 5, { x: 0, y: -1 })).toBeCloseTo(-5);
  });
});

describe('frameToScreen', () => {
  it('flips the Y axis to match a Y-down worldToScreen', () => {
    const f = computeFrame('world', IDENTITY, undefined);
    const worldToScreen = (x: number, y: number) => ({ x, y: -y });
    const screen = frameToScreen(f, worldToScreen);
    expect(screen.origin.x).toBeCloseTo(0);
    expect(screen.origin.y).toBeCloseTo(0);
    expect(screen.axisX).toEqual({ x: 1, y: 0 });
    expect(screen.axisY).toEqual({ x: 0, y: -1 });
  });
});

describe('hitTestGizmo', () => {
  const origin = { x: 100, y: 100 };
  const axisX = { x: 1, y: 0 };
  const axisY = { x: 0, y: -1 };

  it('hits the rotate ring within threshold, misses outside it', () => {
    expect(hitTestGizmo('rotate', origin, axisX, axisY, 40, 28, 8, { x: 128, y: 100 })).toEqual({
      tool: 'rotate',
    });
    expect(hitTestGizmo('rotate', origin, axisX, axisY, 40, 28, 8, { x: 100, y: 100 })).toBeNull();
  });

  it('hits the X handle segment and the Y handle segment', () => {
    expect(hitTestGizmo('translate', origin, axisX, axisY, 40, 28, 8, { x: 120, y: 102 })).toEqual({
      tool: 'axis',
      axis: 'x',
    });
    expect(hitTestGizmo('translate', origin, axisX, axisY, 40, 28, 8, { x: 102, y: 80 })).toEqual({
      tool: 'axis',
      axis: 'y',
    });
  });

  it('misses when the point is far from both handles and the ring', () => {
    expect(hitTestGizmo('scale', origin, axisX, axisY, 40, 28, 8, { x: 300, y: 300 })).toBeNull();
  });
});
