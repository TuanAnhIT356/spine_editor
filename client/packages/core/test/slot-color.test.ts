import { describe, expect, it } from 'vitest';
import {
  SetSlotProperties,
  SpineDocument,
  UpsertSlotColorKeyframe,
  computeAnimatedColors,
  computeAnimatedDarkColors,
  createBone,
  createEmptySkeleton,
  createSlot,
  parseSpineJson,
  serializeSpineJson,
} from '../src/index.js';

function docWithSlot() {
  const data = createEmptySkeleton();
  data.bones.push(createBone('b', 'root'));
  data.slots.push(createSlot('s', 'b'));
  return new SpineDocument(data);
}

describe('SetSlotProperties color/dark', () => {
  it('sets color and dark, disables with null, undoes', () => {
    const doc = docWithSlot();
    doc.execute(new SetSlotProperties('s', { color: 'ff8800ff', dark: '332211' }));
    expect(doc.data.slots[0]!.color).toBe('ff8800ff');
    expect(doc.data.slots[0]!.dark).toBe('332211');
    doc.execute(new SetSlotProperties('s', { dark: null }));
    expect(doc.data.slots[0]!.dark).toBeNull();
    doc.undo();
    expect(doc.data.slots[0]!.dark).toBe('332211');
    doc.undo();
    expect(doc.data.slots[0]!.color).toBe('ffffffff');
    expect(doc.data.slots[0]!.dark).toBeNull();
  });

  it('rejects malformed hex', () => {
    const doc = docWithSlot();
    expect(() => doc.execute(new SetSlotProperties('s', { color: 'red' }))).toThrow(/8-digit/);
    expect(() => doc.execute(new SetSlotProperties('s', { dark: 'ff00' }))).toThrow(/6-digit/);
  });
});

describe('two-color timelines', () => {
  function dataWithRgba2() {
    const doc = docWithSlot();
    doc.data.animations['a'] = {
      slots: {
        s: {
          rgba2: [
            { light: 'ff0000ff', dark: '000000' },
            { time: 1, light: '00ff00ff', dark: 'ffffff' },
          ],
        },
      },
    };
    return doc.data;
  }

  it('samples dark colors at the midpoint', () => {
    const dark = computeAnimatedDarkColors(dataWithRgba2(), 'a', 0.5).get('s')!;
    const r = parseInt(dark.slice(0, 2), 16);
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(129);
  });

  it('rgba2 light overrides the slot color in computeAnimatedColors', () => {
    const light = computeAnimatedColors(dataWithRgba2(), 'a', 0).get('s');
    expect(light).toBe('ff0000ff');
  });

  it('slots without two-color timelines have no dark entry', () => {
    expect(computeAnimatedDarkColors(dataWithRgba2(), 'a', 0).has('missing')).toBe(false);
  });
});

describe('UpsertSlotColorKeyframe with dark', () => {
  it('writes an rgba2 key and undoes', () => {
    const doc = docWithSlot();
    doc.data.animations['a'] = {};
    doc.execute(new UpsertSlotColorKeyframe('a', 's', { time: 0.5, color: 'ff0000ff' }, '112233'));
    const keys = doc.data.animations['a']!.slots?.['s']?.rgba2;
    expect(keys).toHaveLength(1);
    expect(keys![0]).toMatchObject({ time: 0.5, light: 'ff0000ff', dark: '112233' });
    expect(doc.data.animations['a']!.slots?.['s']?.rgba).toBeUndefined();
    doc.undo();
    expect(doc.data.animations['a']!.slots?.['s']?.rgba2).toBeUndefined();
  });

  it('rejects malformed dark', () => {
    const doc = docWithSlot();
    doc.data.animations['a'] = {};
    expect(() =>
      doc.execute(new UpsertSlotColorKeyframe('a', 's', { color: 'ff0000ff' }, 'xyz')),
    ).toThrow(/6-digit/);
  });
});

describe('round-trip', () => {
  it('keeps slot.dark and rgba2 keys through serialize/parse', () => {
    const doc = docWithSlot();
    doc.data.animations['flick'] = {};
    doc.execute(new SetSlotProperties('s', { color: 'ff8800ff', dark: '332211' }));
    doc.execute(new UpsertSlotColorKeyframe('flick', 's', { color: 'ffffffff' }, 'abcdef'));
    const json = serializeSpineJson(doc.data);
    const { data } = parseSpineJson(json);
    expect(data.slots[0]!.dark).toBe('332211');
    expect(data.animations['flick']!.slots?.['s']?.rgba2?.[0]).toMatchObject({
      light: 'ffffffff',
      dark: 'abcdef',
    });
  });
});
