/**
 * One write path for bone transform edits (numeric boxes now, more later):
 * setup mode patches the setup pose; animate mode with Auto Key writes
 * keyframes with the same offset/factor semantics the viewport drags use.
 */

import {
  Composite,
  SetBoneTransform,
  UpsertBoneKeyframe,
  type BoneTransformPatch,
  type Command,
  type SpineBoneKey,
} from '@spine-editor/core';
import { useEditor } from './store.js';

export type BonePatch = Partial<
  Record<'rotation' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY', number>
>;

const r2 = (v: number) => Math.round(v * 100) / 100;

function key(time: number, fields: Omit<SpineBoneKey, 'time'>): SpineBoneKey {
  const k: SpineBoneKey = { ...fields };
  if (time > 0) k.time = time;
  return k;
}

/** Applies ABSOLUTE local values. Returns false when blocked (Auto Key off in animate). */
export function applyBoneEdit(boneName: string, patch: BonePatch): boolean {
  const s = useEditor.getState();
  const setup = s.doc.findBone(boneName);
  if (!setup) return false;
  const anim = s.anim.current;
  if (s.mode !== 'animate' || anim === null) {
    const p: Record<string, number> = {};
    for (const [k, v] of Object.entries(patch)) p[k] = r2(v);
    return s.execute(new SetBoneTransform(boneName, p as BoneTransformPatch));
  }
  if (!s.autoKey) {
    s.setError('Auto Key is off — enable it to key changes in animate mode.');
    return false;
  }
  const t = s.anim.time;
  const cmds: Command[] = [];
  if (patch.rotation !== undefined) {
    cmds.push(
      new UpsertBoneKeyframe(
        anim,
        boneName,
        'rotate',
        key(t, { value: r2(patch.rotation - setup.rotation) }),
      ),
    );
  }
  if (patch.x !== undefined || patch.y !== undefined) {
    cmds.push(
      new UpsertBoneKeyframe(
        anim,
        boneName,
        'translate',
        key(t, {
          x: r2((patch.x ?? setup.x) - setup.x),
          y: r2((patch.y ?? setup.y) - setup.y),
        }),
      ),
    );
  }
  if (patch.scaleX !== undefined || patch.scaleY !== undefined) {
    cmds.push(
      new UpsertBoneKeyframe(
        anim,
        boneName,
        'scale',
        key(t, {
          x: r2((patch.scaleX ?? setup.scaleX) / (setup.scaleX || 1)),
          y: r2((patch.scaleY ?? setup.scaleY) / (setup.scaleY || 1)),
        }),
      ),
    );
  }
  if (patch.shearX !== undefined || patch.shearY !== undefined) {
    cmds.push(
      new UpsertBoneKeyframe(
        anim,
        boneName,
        'shear',
        key(t, {
          x: r2((patch.shearX ?? setup.shearX) - setup.shearX),
          y: r2((patch.shearY ?? setup.shearY) - setup.shearY),
        }),
      ),
    );
  }
  if (cmds.length === 0) return true;
  if (cmds.length === 1) return s.execute(cmds[0]!);
  return s.execute(new Composite(`Edit ${boneName}`, cmds));
}

/** Parses Spine-style numeric entry: "12", "+5" (add), "*2" (multiply), "/2" (divide). */
export function parseNumeric(input: string, current: number): number | null {
  const t = input.trim();
  const m = /^([+*/])?(-?\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[2]);
  if (m[1] === '+') return current + v;
  if (m[1] === '*') return current * v;
  if (m[1] === '/') return v === 0 ? null : current / v;
  return v;
}
