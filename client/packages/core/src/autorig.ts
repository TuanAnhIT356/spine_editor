/**
 * Auto-rig: turn canonically-named part boxes (head, torso, upper/lower
 * arm/leg L+R — axis-aligned, T-pose) into a skeleton plan. Joints are
 * inferred with a closest-edge rule; bones follow the +X-along-bone
 * convention. Pure logic — the editor op maps the plan to commands.
 */

import { createBone } from './model/factories.js';
import type { BoneData, IkConstraintData } from './model/types.js';

export interface PartBox {
  name: string;
  x: number; // center, world Y-up
  y: number;
  width: number;
  height: number;
}

export interface SlotBinding {
  slot: string;
  bone: string;
  attachment: { x: number; y: number; rotation: number };
}

export interface RigPlan {
  bones: BoneData[];
  slotBindings: SlotBinding[];
  ik: IkConstraintData[];
  drawOrder: string[];
}

type XY = { x: number; y: number };
type World = { x: number; y: number; rot: number };

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const DRAW_ORDER = [
  'upper_leg_l',
  'lower_leg_l',
  'upper_leg_r',
  'lower_leg_r',
  'torso',
  'upper_arm_l',
  'lower_arm_l',
  'upper_arm_r',
  'lower_arm_r',
  'head',
];

const LIMBS: {
  upper: string;
  lower: string;
  ikName: string;
  target: string;
  bendPositive: boolean;
}[] = [
  {
    upper: 'upper_arm_l',
    lower: 'lower_arm_l',
    ikName: 'ik_arm_l',
    target: 'ik_hand_l',
    bendPositive: false,
  },
  {
    upper: 'upper_arm_r',
    lower: 'lower_arm_r',
    ikName: 'ik_arm_r',
    target: 'ik_hand_r',
    bendPositive: true,
  },
  {
    upper: 'upper_leg_l',
    lower: 'lower_leg_l',
    ikName: 'ik_leg_l',
    target: 'ik_foot_l',
    bendPositive: true,
  },
  {
    upper: 'upper_leg_r',
    lower: 'lower_leg_r',
    ikName: 'ik_leg_r',
    target: 'ik_foot_r',
    bendPositive: true,
  },
];

function edgeCenters(p: PartBox): XY[] {
  const hw = p.width / 2;
  const hh = p.height / 2;
  return [
    { x: p.x - hw, y: p.y }, // left
    { x: p.x + hw, y: p.y }, // right
    { x: p.x, y: p.y + hh }, // top
    { x: p.x, y: p.y - hh }, // bottom
  ];
}

function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestEdge(p: PartBox, to: XY): XY {
  return edgeCenters(p).reduce((best, e) => (dist(e, to) < dist(best, to) ? e : best));
}

function farthestEdge(p: PartBox, from: XY): XY {
  return edgeCenters(p).reduce((best, e) => (dist(e, from) > dist(best, from) ? e : best));
}

function mid(a: XY, b: XY): XY {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Local transform of a world point/rotation into a parent's world frame. */
function toLocal(parent: World, point: XY): XY {
  const dx = point.x - parent.x;
  const dy = point.y - parent.y;
  const r = -parent.rot * RAD;
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
}

export function buildRigFromParts(parts: PartBox[], opts: { ik?: boolean } = {}): RigPlan {
  const byName = new Map(parts.map((p) => [p.name, p]));
  const torso = byName.get('torso');
  if (!torso) throw new Error('Cannot rig: missing "torso" part');
  const torsoCenter: XY = { x: torso.x, y: torso.y };

  // --- joints ---
  const legL = byName.get('upper_leg_l');
  const legR = byName.get('upper_leg_r');
  const hipJoint: XY =
    legL && legR
      ? mid(closestEdge(legL, torsoCenter), closestEdge(legR, torsoCenter))
      : { x: torso.x, y: torso.y - torso.height / 2 };
  const head = byName.get('head');
  const torsoTop: XY = { x: torso.x, y: torso.y + torso.height / 2 };
  const neckJoint: XY = head ? mid(closestEdge(head, torsoCenter), torsoTop) : torsoTop;

  const bones: BoneData[] = [];
  const worlds = new Map<string, World>();
  worlds.set('root', { x: 0, y: 0, rot: 0 });

  function addBone(name: string, parent: string, from: XY, to: XY | null): void {
    const parentWorld = worlds.get(parent)!;
    const local = toLocal(parentWorld, from);
    const worldRot = to ? Math.atan2(to.y - from.y, to.x - from.x) * DEG : 0;
    bones.push(
      createBone(name, parent, {
        x: local.x,
        y: local.y,
        rotation: worldRot - parentWorld.rot,
        length: to ? dist(from, to) : 0,
      }),
    );
    worlds.set(name, { x: from.x, y: from.y, rot: worldRot });
  }

  addBone('hip', 'root', hipJoint, null);
  addBone('spine', 'hip', hipJoint, neckJoint);
  if (head) {
    addBone('head', 'spine', neckJoint, { x: head.x, y: head.y });
  }

  const partToBone = new Map<string, string>([['torso', 'spine']]);
  if (head) partToBone.set('head', 'head');

  const ik: IkConstraintData[] = [];
  let ikOrder = 0;
  for (const limb of LIMBS) {
    const upper = byName.get(limb.upper);
    const lower = byName.get(limb.lower);
    if (!upper) continue;
    const isArm = limb.upper.includes('arm');
    const upperParent = isArm ? 'spine' : 'hip';
    const startJoint = closestEdge(upper, torsoCenter);
    if (lower) {
      const midJoint = mid(
        closestEdge(upper, { x: lower.x, y: lower.y }),
        closestEdge(lower, { x: upper.x, y: upper.y }),
      );
      const endJoint = farthestEdge(lower, { x: upper.x, y: upper.y });
      addBone(limb.upper, upperParent, startJoint, midJoint);
      addBone(limb.lower, limb.upper, midJoint, endJoint);
      partToBone.set(limb.upper, limb.upper);
      partToBone.set(limb.lower, limb.lower);
      if (opts.ik !== false) {
        addBone(limb.target, 'root', endJoint, null);
        ik.push({
          name: limb.ikName,
          order: ikOrder++,
          skinRequired: false,
          bones: [limb.upper, limb.lower],
          target: limb.target,
          mix: 1,
          softness: 0,
          bendPositive: limb.bendPositive,
          compress: false,
          stretch: false,
          uniform: false,
        });
      }
    } else {
      const endJoint = farthestEdge(upper, torsoCenter);
      addBone(limb.upper, upperParent, startJoint, endJoint);
      partToBone.set(limb.upper, limb.upper);
    }
  }

  const slotBindings: SlotBinding[] = [];
  for (const part of parts) {
    const bone = partToBone.get(part.name);
    if (!bone) continue;
    const world = worlds.get(bone)!;
    const local = toLocal(world, { x: part.x, y: part.y });
    slotBindings.push({
      slot: part.name,
      bone,
      attachment: { x: local.x, y: local.y, rotation: -world.rot },
    });
  }

  return {
    bones,
    slotBindings,
    ik,
    drawOrder: DRAW_ORDER.filter((n) => byName.has(n)),
  };
}
