import { describe, expect, it } from 'vitest';
import {
  CreateAnimation,
  RemoveEventDef,
  SetEventDef,
  SpineDocument,
  UpsertEventKeyframe,
} from '../src/index.js';

describe('event commands', () => {
  it('defines, keys, and protects events, undoably', () => {
    const doc = new SpineDocument();
    doc.execute(new SetEventDef('footstep', { int: 1, audio: 'step.wav' }));
    expect(doc.data.events['footstep']).toEqual({ int: 1, audio: 'step.wav' });

    doc.execute(new CreateAnimation('walk'));
    doc.execute(new UpsertEventKeyframe('walk', { time: 0.5, name: 'footstep' }));
    doc.execute(new UpsertEventKeyframe('walk', { time: 0.25, name: 'footstep', int: 2 }));
    expect(doc.getAnimation('walk')?.events?.map((k) => k.time)).toEqual([0.25, 0.5]);

    // Replacing a key at the same time+name:
    doc.execute(new UpsertEventKeyframe('walk', { time: 0.5, name: 'footstep', volume: 0.5 }));
    expect(doc.getAnimation('walk')?.events).toHaveLength(2);

    // Removal is blocked while keyed:
    expect(() => doc.execute(new RemoveEventDef('footstep'))).toThrow(/keyed in animation/);

    doc.undo(); // un-replace
    doc.undo(); // remove 0.25 key
    doc.undo(); // remove 0.5 key
    expect(doc.getAnimation('walk')?.events).toBeUndefined();

    doc.undo(); // remove animation
    doc.execute(new RemoveEventDef('footstep'));
    expect(doc.data.events['footstep']).toBeUndefined();
    doc.undo();
    expect(doc.data.events['footstep']).toBeDefined();
  });

  it('rejects keys for undefined events', () => {
    const doc = new SpineDocument();
    doc.execute(new CreateAnimation('walk'));
    expect(() => doc.execute(new UpsertEventKeyframe('walk', { name: 'nope' }))).toThrow(
      /not defined/,
    );
  });
});
