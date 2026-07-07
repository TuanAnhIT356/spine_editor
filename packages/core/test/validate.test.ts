import { describe, expect, it } from 'vitest';
import { createBone, createEmptySkeleton, createSlot, validateSkeleton } from '../src/index.js';

describe('validateSkeleton', () => {
  it('accepts an empty document', () => {
    expect(validateSkeleton(createEmptySkeleton())).toEqual([]);
  });

  it('flags slots referencing missing bones', () => {
    const data = createEmptySkeleton();
    data.slots.push(createSlot('body', 'nope'));
    const issues = validateSkeleton(data);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', path: 'slots[0].bone' });
  });

  it('flags duplicate bone names and bad parent ordering', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'b'), createBone('b', 'root'), createBone('b', 'root'));
    const issues = validateSkeleton(data);
    expect(issues.some((i) => i.message.includes('Duplicate bone name "b"'))).toBe(true);
    expect(issues.some((i) => i.message.includes('must come after its parent'))).toBe(true);
  });

  it('flags animation timelines targeting missing objects', () => {
    const data = createEmptySkeleton();
    data.animations['walk'] = {
      bones: { ghost: { rotate: [{ value: 1 }] } },
      events: [{ time: 0, name: 'undefined-event' }],
    };
    const issues = validateSkeleton(data);
    expect(issues.some((i) => i.path === 'animations.walk.bones.ghost')).toBe(true);
    expect(issues.some((i) => i.path === 'animations.walk.events[0]')).toBe(true);
  });

  it('flags IK constraints with wrong bone counts or missing targets', () => {
    const data = createEmptySkeleton();
    data.ik.push({
      name: 'ik1',
      order: 0,
      skinRequired: false,
      bones: [],
      target: 'nope',
      mix: 1,
      softness: 0,
      bendPositive: true,
      compress: false,
      stretch: false,
      uniform: false,
    });
    const issues = validateSkeleton(data);
    expect(issues.some((i) => i.message.includes('must have 1 or 2 bones'))).toBe(true);
    expect(issues.some((i) => i.path === 'ik[0].target')).toBe(true);
  });
});
