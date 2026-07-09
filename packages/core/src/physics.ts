/**
 * Physics constraint preview: a deterministic fixed-step spring-damper
 * simulation over the animated pose. Each constrained bone accumulates
 * translation offsets (x/y) and a rotation offset (pendulum-style, driven by
 * gravity/wind and the bone's own motion via inertia), blended by the
 * constraint's per-property factors and overall mix.
 *
 * Determinism: the simulation always advances on a fixed 1/60s grid from
 * t=0; scrubbing backward or switching animations re-simulates from zero, so
 * the same (animation, time) always produces the same pose. This mirrors the
 * runtime's behavior closely enough for previews; exact numeric parity with
 * the official runtime is not guaranteed (documented approximation). Exported
 * data is untouched — games run the real runtime simulation.
 */

import { computeAnimatedIk, computeAnimatedLocals } from './evaluate.js';
import type { BoneData, SkeletonData } from './model/types.js';
import { computePose, invertMat, worldRotationOf, type Mat2D } from './pose.js';

const STEP = 1 / 60;
const RAD_DEG = 180 / Math.PI;
/** World-unit scale for wind/gravity (the runtime's referenceScale default). */
const REFERENCE_SCALE = 100;

interface ConstraintState {
  initialized: boolean;
  ux: number;
  uy: number;
  ur: number;
  xOffset: number;
  xVelocity: number;
  yOffset: number;
  yVelocity: number;
  rotateOffset: number;
  rotateVelocity: number;
}

function freshState(): ConstraintState {
  return {
    initialized: false,
    ux: 0,
    uy: 0,
    ur: 0,
    xOffset: 0,
    xVelocity: 0,
    yOffset: 0,
    yVelocity: 0,
    rotateOffset: 0,
    rotateVelocity: 0,
  };
}

function normalizeDeg(a: number): number {
  a %= 360;
  if (a > 180) a -= 360;
  else if (a < -180) a += 360;
  return a;
}

export class PhysicsSimulator {
  private states = new Map<string, ConstraintState>();
  private lastAnimation: string | null = null;
  private simulatedTime = 0;

  constructor(private readonly data: SkeletonData) {}

  get hasConstraints(): boolean {
    return this.data.physics.length > 0;
  }

  reset(): void {
    this.states.clear();
    this.simulatedTime = 0;
    this.lastAnimation = null;
  }

  /**
   * Bone locals at `time` with physics offsets baked in. Advances the
   * simulation incrementally while time moves forward; re-simulates from 0
   * when time jumps backward or the animation changes.
   */
  localsAt(animation: string | null, time: number): BoneData[] {
    if (!this.hasConstraints) return this.baseLocals(animation, time);
    if (animation !== this.lastAnimation || time < this.simulatedTime - 1e-9) {
      this.states.clear();
      this.simulatedTime = 0;
      this.lastAnimation = animation;
    }
    while (this.simulatedTime + STEP <= time + 1e-9) {
      this.simulatedTime += STEP;
      this.step(animation, this.simulatedTime);
    }
    return this.applyOffsets(animation, time);
  }

  private baseLocals(animation: string | null, time: number): BoneData[] {
    return animation && this.data.animations[animation]
      ? computeAnimatedLocals(this.data, animation, time)
      : this.data.bones;
  }

  private poseAt(animation: string | null, time: number) {
    const locals = this.baseLocals(animation, time);
    const ik =
      animation && this.data.animations[animation]
        ? computeAnimatedIk(this.data, animation, time)
        : undefined;
    return { locals, world: computePose(this.data, locals, ik) };
  }

  private step(animation: string | null, t: number): void {
    const { world } = this.poseAt(animation, t);
    for (const c of this.data.physics) {
      const boneWorld = world.get(c.bone);
      const bone = this.data.bones.find((b) => b.name === c.bone);
      if (!boneWorld || !bone) continue;
      let st = this.states.get(c.name);
      if (!st) {
        st = freshState();
        this.states.set(c.name, st);
      }
      const bx = boneWorld.tx;
      const by = boneWorld.ty;
      const br = worldRotationOf(boneWorld);
      if (!st.initialized) {
        st.initialized = true;
        st.ux = bx;
        st.uy = by;
        st.ur = br;
        continue;
      }
      const inertia = c.inertia ?? 1;
      const strength = c.strength ?? 100;
      const damping = c.damping ?? 1;
      const massInv = 1 / Math.max(c.mass ?? 1, 1e-4);
      const wind = (c.wind ?? 0) * REFERENCE_SCALE;
      const gravity = (c.gravity ?? 0) * REFERENCE_SCALE;
      const limit = (c.limit ?? 5000) * REFERENCE_SCALE * 0.01;
      const dampFactor = Math.pow(Math.max(damping, 0), 60 * STEP);

      if ((c.x ?? 0) > 0 || (c.y ?? 0) > 0) {
        // Inertia: the bone's own movement leaves the offset behind.
        st.xOffset += (st.ux - bx) * inertia;
        st.yOffset += (st.uy - by) * inertia;
        // Spring toward zero offset plus wind/gravity forces.
        st.xVelocity += (wind - st.xOffset * strength) * massInv * STEP;
        st.yVelocity += (-gravity - st.yOffset * strength) * massInv * STEP;
        st.xOffset += st.xVelocity * STEP;
        st.yOffset += st.yVelocity * STEP;
        st.xVelocity *= dampFactor;
        st.yVelocity *= dampFactor;
        st.xOffset = Math.min(Math.max(st.xOffset, -limit), limit);
        st.yOffset = Math.min(Math.max(st.yOffset, -limit), limit);
      }
      st.ux = bx;
      st.uy = by;

      if ((c.rotate ?? 0) > 0 || (c.shearX ?? 0) > 0 || (c.scaleX ?? 0) > 0) {
        // Angular inertia from the bone's own rotation change.
        st.rotateOffset += normalizeDeg(st.ur - br) * inertia;
        // Pendulum: gravity/wind torque on the bone tip, spring back to rest.
        const rr = ((br + st.rotateOffset) / RAD_DEG) as number;
        const len = Math.max(bone.length, 1);
        const perpAccel = -gravity * Math.cos(rr) - wind * Math.sin(rr);
        st.rotateVelocity +=
          ((perpAccel / len) * RAD_DEG - st.rotateOffset * strength) * massInv * STEP;
        st.rotateOffset += st.rotateVelocity * STEP;
        st.rotateVelocity *= dampFactor;
        st.rotateOffset = Math.min(Math.max(st.rotateOffset, -360), 360);
      }
      st.ur = br;
    }
  }

  private applyOffsets(animation: string | null, time: number): BoneData[] {
    const { locals, world } = this.poseAt(animation, time);
    const out = locals.map((b) => ({ ...b }));
    for (const c of this.data.physics) {
      const st = this.states.get(c.name);
      if (!st?.initialized) continue;
      const bone = out.find((b) => b.name === c.bone);
      const boneWorld = world.get(c.bone);
      if (!bone || !boneWorld) continue;
      const mix = c.mix ?? 1;
      const fx = (c.x ?? 0) * mix;
      const fy = (c.y ?? 0) * mix;
      if (fx > 0 || fy > 0) {
        const parentWorld =
          (bone.parent !== null ? world.get(bone.parent) : undefined) ??
          ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as Mat2D);
        const inv = invertMat(parentWorld);
        // Convert the world-space offset into the parent's space (linear part).
        const local = {
          x: inv.a * (st.xOffset * fx) + inv.b * (st.yOffset * fy),
          y: inv.c * (st.xOffset * fx) + inv.d * (st.yOffset * fy),
        };
        bone.x += local.x;
        bone.y += local.y;
      }
      const fr = (c.rotate ?? 0) * mix;
      if (fr > 0) bone.rotation += st.rotateOffset * fr;
      const fs = (c.scaleX ?? 0) * mix;
      if (fs > 0) bone.scaleX *= 1 + (st.rotateVelocity / 360) * fs;
      const fsh = (c.shearX ?? 0) * mix;
      if (fsh > 0) bone.shearX += st.rotateOffset * fsh * 0.5;
    }
    return out;
  }
}

/** Convenience: world pose at a time with physics applied (fresh simulator). */
export function computePhysicsPose(
  data: SkeletonData,
  animation: string | null,
  time: number,
): { locals: BoneData[]; world: Map<string, Mat2D> } {
  const sim = new PhysicsSimulator(data);
  const locals = sim.localsAt(animation, time);
  const ik =
    animation && data.animations[animation] ? computeAnimatedIk(data, animation, time) : undefined;
  return { locals, world: computePose(data, locals, ik) };
}
