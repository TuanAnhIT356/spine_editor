import { describe, expect, it } from 'vitest';
import {
  createBone,
  createEmptySkeleton,
  createSlot,
  serializeSpineJson,
  SPINE_EXPORT_VERSION,
} from '../src/index.js';

describe('serializeSpineJson', () => {
  it('writes a minimal document with defaults omitted', () => {
    const data = createEmptySkeleton();
    expect(serializeSpineJson(data)).toEqual({
      skeleton: { spine: SPINE_EXPORT_VERSION },
      bones: [{ name: 'root' }],
      skins: [{ name: 'default' }],
    });
  });

  it('omits default bone fields and keeps non-defaults', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('hip', 'root', { y: 100, scaleX: 2, inherit: 'noScale' }));
    const json = serializeSpineJson(data);
    expect(json.bones?.[1]).toEqual({
      name: 'hip',
      parent: 'root',
      y: 100,
      scaleX: 2,
      inherit: 'noScale',
    });
  });

  it('omits default slot fields and keeps non-defaults', () => {
    const data = createEmptySkeleton();
    data.slots.push(createSlot('a', 'root'));
    data.slots.push(
      createSlot('b', 'root', { color: 'ff0000ff', blend: 'additive', attachment: 'img' }),
    );
    const json = serializeSpineJson(data);
    expect(json.slots?.[0]).toEqual({ name: 'a', bone: 'root' });
    expect(json.slots?.[1]).toEqual({
      name: 'b',
      bone: 'root',
      color: 'ff0000ff',
      blend: 'additive',
      attachment: 'img',
    });
  });

  it('omits empty top-level sections', () => {
    const data = createEmptySkeleton();
    const json = serializeSpineJson(data);
    expect(json).not.toHaveProperty('slots');
    expect(json).not.toHaveProperty('ik');
    expect(json).not.toHaveProperty('events');
    expect(json).not.toHaveProperty('animations');
  });
});
