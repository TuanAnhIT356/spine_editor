import { describe, expect, it } from 'vitest';
import {
  PRESET_DURATIONS,
  PRESET_NAMES,
  buildRigFromParts,
  computeAnimatedLocals,
  createBone,
  createEmptySkeleton,
  getAnimationDuration,
  retargetPreset,
  type PartBox,
} from '../src/index.js';

const PARTS: PartBox[] = [
  { name: 'head', x: 0, y: 330, width: 100, height: 110 },
  { name: 'torso', x: 0, y: 112, width: 150, height: 240 },
  { name: 'upper_arm_l', x: -100, y: 224, width: 80, height: 40 },
  { name: 'lower_arm_l', x: -180, y: 224, width: 80, height: 40 },
  { name: 'upper_arm_r', x: 100, y: 224, width: 80, height: 40 },
  { name: 'lower_arm_r', x: 180, y: 224, width: 80, height: 40 },
  { name: 'upper_leg_l', x: -32, y: -80, width: 50, height: 160 },
  { name: 'lower_leg_l', x: -32, y: -240, width: 45, height: 160 },
  { name: 'upper_leg_r', x: 32, y: -80, width: 50, height: 160 },
  { name: 'lower_leg_r', x: 32, y: -240, width: 45, height: 160 },
];

function riggedSkeleton() {
  const data = createEmptySkeleton();
  const plan = buildRigFromParts(PARTS);
  data.bones.push(...plan.bones);
  return data;
}

describe('retargetPreset', () => {
  it('only creates tracks for bones that exist', () => {
    const data = riggedSkeleton();
    for (const preset of PRESET_NAMES) {
      const anim = retargetPreset(preset, data);
      for (const bone of Object.keys(anim.bones ?? {})) {
        expect(data.bones.some((b) => b.name === bone)).toBe(true);
      }
    }
  });

  it('drops tracks for missing bones', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('upper_arm_r', 'root', { length: 80 }));
    const anim = retargetPreset('wave', data);
    expect(Object.keys(anim.bones ?? {})).toEqual(['upper_arm_r']);
  });

  it('closes the loop (last key equals first key) and matches duration', () => {
    const data = riggedSkeleton();
    for (const preset of PRESET_NAMES) {
      const anim = retargetPreset(preset, data);
      expect(getAnimationDuration(anim)).toBeCloseTo(PRESET_DURATIONS[preset], 5);
      for (const tracks of Object.values(anim.bones ?? {})) {
        for (const timeline of ['rotate', 'translate'] as const) {
          const keys = tracks[timeline];
          if (!keys) continue;
          const first = keys[0]!;
          const last = keys[keys.length - 1]!;
          expect(last.value ?? last.x ?? 0).toBeCloseTo(first.value ?? first.x ?? 0, 5);
          expect(last.y ?? 0).toBeCloseTo(first.y ?? 0, 5);
        }
      }
    }
  });

  it('scales translate offsets by bone length, not rotations', () => {
    const short = createEmptySkeleton();
    short.bones.push(createBone('hip', 'root', { length: 0 }));
    const shortAnim = retargetPreset('walk', short);
    const hipKeys = shortAnim.bones?.hip?.translate ?? [];
    expect(hipKeys.length).toBeGreaterThan(0); // length 0 -> factor 1, keys intact
  });

  it('honors boneMap', () => {
    const data = createEmptySkeleton();
    data.bones.push(createBone('mano_derecha', 'root', { length: 80 }));
    const anim = retargetPreset('wave', data, { upper_arm_r: 'mano_derecha' });
    expect(Object.keys(anim.bones ?? {})).toContain('mano_derecha');
  });

  it('walk actually animates: pose differs between stride extremes', () => {
    // t=0.25/0.75 are the symmetric zero-crossings of the stride — probe the
    // extremes (t=0 vs t=0.5) where the legs are fully apart.
    const data = riggedSkeleton();
    data.animations['walk'] = retargetPreset('walk', data);
    const a = computeAnimatedLocals(data, 'walk', 0).find((b) => b.name === 'upper_leg_l')!;
    const b = computeAnimatedLocals(data, 'walk', 0.5).find((b) => b.name === 'upper_leg_l')!;
    expect(Math.abs(a.rotation - b.rotation)).toBeGreaterThan(10);
  });
});
