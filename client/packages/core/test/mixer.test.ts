import { describe, expect, it } from 'vitest';
import { TrackMixer, createBone, createEmptySkeleton } from '../src/index.js';

function data() {
  const d = createEmptySkeleton();
  d.bones.push(createBone('b', 'root'));
  d.animations['spin'] = { bones: { b: { rotate: [{ value: 0 }, { time: 1, value: 90 }] } } };
  d.animations['lift'] = {
    bones: {
      b: {
        translate: [
          { x: 0, y: 0 },
          { time: 1, y: 100 },
        ],
      },
    },
  };
  d.animations['still'] = { bones: { b: { rotate: [{ value: 30 }, { time: 1, value: 30 }] } } };
  return d;
}

const bone = (m: TrackMixer) => m.pose().find((b) => b.name === 'b')!;

describe('TrackMixer', () => {
  it('plays track 0 and loops', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin');
    m.update(0.5);
    expect(bone(m).rotation).toBeCloseTo(45, 1);
    m.update(0.75); // t=1.25 → wraps to 0.25
    expect(bone(m).rotation).toBeCloseTo(22.5, 1);
  });

  it('respects speed', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin');
    m.setTrackProps(0, { speed: 2 });
    m.update(0.25); // effective 0.5
    expect(bone(m).rotation).toBeCloseTo(45, 1);
  });

  it('crossfades between animations on one track', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'still'); // rotation 30 constant
    m.update(0.2);
    m.setAnimation(0, 'spin', 1); // fade 1s from still→spin
    m.update(0.5); // w=0.5; spin at t=0.5 → 45; still → 30 → blend 37.5
    expect(bone(m).rotation).toBeCloseTo(37.5, 1);
  });

  it('holdPrevious freezes the previous pose during the fade', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin'); // advancing animation as prev
    m.setTrackProps(0, { holdPrevious: true });
    m.update(0.5); // spin at 45
    m.setAnimation(0, 'still', 1); // fade to constant 30
    m.update(0.5); // hold: prev frozen at t=0.5 (45); w=0.5 → lerp(45, 30, 0.5) = 37.5
    expect(bone(m).rotation).toBeCloseTo(37.5, 1);
    // Without hold, prev would have advanced to t=1 (90): lerp(90,30,.5)=60.
  });

  it('layers track 1 with alpha (replace mix)', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin');
    m.setAnimation(1, 'still'); // rotation 30
    m.setTrackProps(1, { alpha: 0.5 });
    m.update(0.5); // track0 → 45; track1 target 30 → lerp(45,30,0.5)=37.5
    expect(bone(m).rotation).toBeCloseTo(37.5, 1);
  });

  it('additive track adds offsets scaled by alpha', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'spin');
    m.setAnimation(1, 'lift');
    m.setTrackProps(1, { additive: true, alpha: 0.5 });
    m.update(0.5); // lift y offset at 0.5 = 50 → +25 additively
    expect(bone(m).rotation).toBeCloseTo(45, 1);
    expect(bone(m).y).toBeCloseTo(25, 1);
  });

  it('clearing an animation fades back to the underlying pose', () => {
    const m = new TrackMixer(data());
    m.setAnimation(0, 'still');
    m.update(0.2);
    m.setAnimation(0, null, 1);
    m.update(0.5); // fade out: lerp(30, 0(setup), 0.5) = 15
    expect(bone(m).rotation).toBeCloseTo(15, 1);
  });
});
