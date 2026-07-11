import { describe, expect, it } from 'vitest';
import { buildRigFromParts, type BoneData, type PartBox } from '../src/index.js';

// T-pose figure, world Y-up. Derived joints (closest-edge rule):
// hip(0,0) neck(0,253.5) shoulder_l(-60,224) elbow_l(-140,224) wrist_l(-220,224)
// hip_l(-32,0) knee_l(-32,-160) ankle_l(-32,-320)  (right side mirrored)
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

/** World position of a bone's origin by walking the parent chain. */
function worldOf(bones: BoneData[], name: string): { x: number; y: number; rot: number } {
  const byName = new Map(bones.map((b) => [b.name, b]));
  const chain: BoneData[] = [];
  for (let b = byName.get(name); b; b = b.parent ? byName.get(b.parent) : undefined) {
    chain.unshift(b);
  }
  let x = 0,
    y = 0,
    rot = 0;
  for (const b of chain) {
    const r = (rot * Math.PI) / 180;
    const wx = x + b.x * Math.cos(r) - b.y * Math.sin(r);
    const wy = y + b.x * Math.sin(r) + b.y * Math.cos(r);
    x = wx;
    y = wy;
    rot += b.rotation;
  }
  return { x, y, rot };
}

describe('buildRigFromParts', () => {
  const plan = buildRigFromParts(PARTS);
  const names = plan.bones.map((b) => b.name);

  it('creates the full bone set with parents before children', () => {
    expect(names).toContain('hip');
    expect(names).toContain('spine');
    expect(names).toContain('head');
    for (const limb of [
      'upper_arm_l',
      'lower_arm_l',
      'upper_arm_r',
      'lower_arm_r',
      'upper_leg_l',
      'lower_leg_l',
      'upper_leg_r',
      'lower_leg_r',
    ]) {
      expect(names).toContain(limb);
    }
    for (const t of ['ik_hand_l', 'ik_hand_r', 'ik_foot_l', 'ik_foot_r']) {
      expect(names).toContain(t);
    }
    // parent precedes child in the array
    for (const b of plan.bones) {
      if (b.parent && b.parent !== 'root') {
        expect(names.indexOf(b.parent)).toBeLessThan(names.indexOf(b.name));
      }
    }
  });

  it('places joints where the box geometry says', () => {
    const hip = worldOf(plan.bones, 'hip');
    expect(hip.x).toBeCloseTo(0, 1);
    expect(hip.y).toBeCloseTo(0, 1);
    const elbowL = worldOf(plan.bones, 'lower_arm_l'); // lower arm origin = elbow
    expect(elbowL.x).toBeCloseTo(-140, 1);
    expect(elbowL.y).toBeCloseTo(224, 1);
    const kneeL = worldOf(plan.bones, 'lower_leg_l');
    expect(kneeL.x).toBeCloseTo(-32, 1);
    expect(kneeL.y).toBeCloseTo(-160, 1);
    const wristTarget = worldOf(plan.bones, 'ik_hand_l');
    expect(wristTarget.x).toBeCloseTo(-220, 1);
    expect(wristTarget.y).toBeCloseTo(224, 1);
  });

  it('points +X along each bone with correct length', () => {
    const upperArmL = plan.bones.find((b) => b.name === 'upper_arm_l')!;
    expect(upperArmL.length).toBeCloseTo(80, 1); // shoulder(-60) -> elbow(-140)
    const w = worldOf(plan.bones, 'upper_arm_l');
    // bone runs left: world rotation ~180°
    expect(Math.abs(((w.rot % 360) + 360) % 360)).toBeCloseTo(180, 1);
    const upperLegL = plan.bones.find((b) => b.name === 'upper_leg_l')!;
    expect(upperLegL.length).toBeCloseTo(160, 1);
  });

  it('rebinds slots with art kept upright', () => {
    const torso = plan.slotBindings.find((s) => s.slot === 'torso')!;
    expect(torso.bone).toBe('spine');
    const spineWorld = worldOf(plan.bones, 'spine');
    expect(torso.attachment.rotation).toBeCloseTo(-spineWorld.rot, 1);
    expect(plan.slotBindings).toHaveLength(10);
  });

  it('adds four 2-bone IK constraints, skippable via opts', () => {
    expect(plan.ik.map((c) => c.name).sort()).toEqual([
      'ik_arm_l',
      'ik_arm_r',
      'ik_leg_l',
      'ik_leg_r',
    ]);
    expect(plan.ik.every((c) => c.bones.length === 2 && c.mix === 1)).toBe(true);
    expect(buildRigFromParts(PARTS, { ik: false }).ik).toHaveLength(0);
  });

  it('tolerates missing limbs and requires torso', () => {
    const noLeftArm = buildRigFromParts(PARTS.filter((p) => !p.name.startsWith('upper_arm_l')));
    expect(noLeftArm.bones.map((b) => b.name)).not.toContain('upper_arm_l');
    expect(noLeftArm.ik.map((c) => c.name)).not.toContain('ik_arm_l');
    expect(() => buildRigFromParts(PARTS.filter((p) => p.name !== 'torso'))).toThrow(/torso/);
  });

  it('emits the canonical draw order', () => {
    expect(plan.drawOrder[0]).toBe('upper_leg_l');
    expect(plan.drawOrder[plan.drawOrder.length - 1]).toBe('head');
  });
});
