/**
 * Preset motion library (idle/walk/wave) + retargeting. Preset values are
 * OFFSETS relative to the setup pose (evaluator semantics): rotations copy
 * verbatim across rigs; translate offsets scale with bone length.
 */

import type { SkeletonData } from './model/types.js';
import type { SpineAnimation, SpineBoneKey } from './spine-json/types.js';

export type PresetName = 'idle' | 'walk' | 'wave';
export const PRESET_NAMES: PresetName[] = ['idle', 'walk', 'wave'];

const REFERENCE_LENGTH = 100;
const EASE = [0.25, 0, 0.75, 1] as const;

interface PresetTracks {
  rotate?: SpineBoneKey[];
  translate?: SpineBoneKey[];
}

interface PresetAnimation {
  duration: number;
  bones: Record<string, PresetTracks>;
}

function rot(time: number, value: number, curve = true): SpineBoneKey {
  const key: SpineBoneKey = {};
  if (time > 0) key.time = time;
  if (value !== 0) key.value = value;
  if (curve) key.curve = [...EASE];
  return key;
}

function xy(time: number, x: number, y: number, curve = true): SpineBoneKey {
  const key: SpineBoneKey = {};
  if (time > 0) key.time = time;
  if (x !== 0) key.x = x;
  if (y !== 0) key.y = y;
  if (curve) key.curve = [...EASE, ...EASE];
  return key;
}

const PRESETS: Record<PresetName, PresetAnimation> = {
  idle: {
    duration: 1,
    bones: {
      spine: { rotate: [rot(0, 0), rot(0.5, 2), rot(1, 0, false)] },
      head: { rotate: [rot(0, 0), rot(0.5, -1.5), rot(1, 0, false)] },
      hip: { translate: [xy(0, 0, 0), xy(0.5, 0, -2), xy(1, 0, 0, false)] },
    },
  },
  walk: {
    duration: 1,
    bones: {
      upper_leg_l: { rotate: [rot(0, 25), rot(0.5, -25), rot(1, 25, false)] },
      upper_leg_r: { rotate: [rot(0, -25), rot(0.5, 25), rot(1, -25, false)] },
      lower_leg_l: {
        rotate: [rot(0, -15), rot(0.25, -40), rot(0.5, -5), rot(0.75, -15), rot(1, -15, false)],
      },
      lower_leg_r: {
        rotate: [rot(0, -5), rot(0.25, -15), rot(0.5, -15), rot(0.75, -40), rot(1, -5, false)],
      },
      upper_arm_l: { rotate: [rot(0, -20), rot(0.5, 20), rot(1, -20, false)] },
      upper_arm_r: { rotate: [rot(0, 20), rot(0.5, -20), rot(1, 20, false)] },
      hip: {
        translate: [
          xy(0, 0, 0),
          xy(0.25, 0, -4),
          xy(0.5, 0, 0),
          xy(0.75, 0, -4),
          xy(1, 0, 0, false),
        ],
      },
      spine: { rotate: [rot(0, 2), rot(0.5, -2), rot(1, 2, false)] },
    },
  },
  wave: {
    duration: 1.6,
    bones: {
      upper_arm_r: {
        rotate: [
          rot(0, 0),
          rot(0.3, 65),
          rot(0.6, 80),
          rot(0.9, 65),
          rot(1.2, 80),
          rot(1.6, 0, false),
        ],
      },
      lower_arm_r: {
        rotate: [
          rot(0, 0),
          rot(0.3, 20),
          rot(0.6, -10),
          rot(0.9, 20),
          rot(1.2, -10),
          rot(1.6, 0, false),
        ],
      },
      head: { rotate: [rot(0, 0), rot(0.8, 3), rot(1.6, 0, false)] },
    },
  },
};

export const PRESET_DURATIONS: Record<PresetName, number> = {
  idle: PRESETS.idle.duration,
  walk: PRESETS.walk.duration,
  wave: PRESETS.wave.duration,
};

/** Retargets a preset onto a skeleton: canonical bone names map to real ones
 * via `boneMap` (default 1:1); missing bones drop their tracks; translate
 * offsets scale by boneLength/100 (length 0 keeps the authored offset). */
export function retargetPreset(
  preset: PresetName,
  data: SkeletonData,
  boneMap?: Record<string, string>,
): SpineAnimation {
  const source = PRESETS[preset];
  if (!source) {
    throw new Error(`Unknown preset "${preset}". Valid: ${PRESET_NAMES.join(', ')}`);
  }
  const bones: NonNullable<SpineAnimation['bones']> = {};
  for (const [canonical, tracks] of Object.entries(source.bones)) {
    const target = boneMap?.[canonical] ?? canonical;
    const bone = data.bones.find((b) => b.name === target);
    if (!bone) continue;
    const out: PresetTracks = {};
    if (tracks.rotate) {
      out.rotate = tracks.rotate.map((k) => structuredClone(k));
    }
    if (tracks.translate) {
      const factor = bone.length > 0 ? bone.length / REFERENCE_LENGTH : 1;
      out.translate = tracks.translate.map((k) => {
        const c = structuredClone(k);
        if (c.x !== undefined) c.x *= factor;
        if (c.y !== undefined) c.y *= factor;
        return c;
      });
    }
    bones[target] = out;
  }
  return { bones };
}
