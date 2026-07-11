/**
 * Deterministic 4-track animation mixer for the Preview view. Blends BONE
 * LOCALS only (computeAnimatedLocals per animation): track 0 replaces the
 * setup pose, higher tracks layer by alpha (replace-lerp) or additively.
 * An approximation of runtime AnimationState — good for previewing, no
 * exact-parity claim (no deform/attachment/draworder/event timelines).
 */

import { computeAnimatedLocals, getAnimationDuration } from './evaluate.js';
import type { BoneData, SkeletonData } from './model/types.js';

export interface TrackState {
  animation: string | null;
  prev: string | null;
  time: number;
  prevTime: number;
  mixDuration: number;
  mixElapsed: number;
  speed: number;
  loop: boolean;
  alpha: number;
  holdPrevious: boolean;
  additive: boolean;
}

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/** Shortest-arc angle interpolation in degrees. */
function lerpAngle(a: number, b: number, w: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return a + d * w;
}

function blendLocals(from: BoneData[], to: BoneData[], w: number): BoneData[] {
  const byName = new Map(to.map((b) => [b.name, b]));
  return from.map((a) => {
    const b = byName.get(a.name);
    if (!b) return a;
    if (w >= 1) return b;
    if (w <= 0) return a;
    return {
      ...a,
      x: lerp(a.x, b.x, w),
      y: lerp(a.y, b.y, w),
      rotation: lerpAngle(a.rotation, b.rotation, w),
      scaleX: lerp(a.scaleX, b.scaleX, w),
      scaleY: lerp(a.scaleY, b.scaleY, w),
      shearX: lerp(a.shearX, b.shearX, w),
      shearY: lerp(a.shearY, b.shearY, w),
    };
  });
}

function newTrack(): TrackState {
  return {
    animation: null,
    prev: null,
    time: 0,
    prevTime: 0,
    mixDuration: 0.2,
    mixElapsed: 0,
    speed: 1,
    loop: true,
    alpha: 1,
    holdPrevious: false,
    additive: false,
  };
}

export class TrackMixer {
  readonly tracks: TrackState[];

  constructor(
    private readonly data: SkeletonData,
    trackCount = 4,
  ) {
    this.tracks = Array.from({ length: trackCount }, newTrack);
  }

  setAnimation(track: number, name: string | null, mixDuration?: number): void {
    const t = this.tracks[track];
    if (!t) return;
    t.prev = t.animation;
    t.prevTime = t.time;
    t.animation = name;
    t.time = 0;
    t.mixElapsed = 0;
    if (mixDuration !== undefined) t.mixDuration = mixDuration;
  }

  setTrackProps(
    track: number,
    patch: Partial<
      Pick<TrackState, 'speed' | 'loop' | 'alpha' | 'holdPrevious' | 'additive' | 'mixDuration'>
    >,
  ): void {
    const t = this.tracks[track];
    if (t) Object.assign(t, patch);
  }

  update(dt: number): void {
    for (const t of this.tracks) {
      if (!t.animation && !t.prev) continue;
      const step = dt * t.speed;
      t.mixElapsed += dt;
      if (t.animation) t.time = this.advance(t.animation, t.time + step, t.loop);
      if (t.prev && !t.holdPrevious) {
        t.prevTime = this.advance(t.prev, t.prevTime + step, t.loop);
      }
      if (t.prev && t.mixDuration > 0 && t.mixElapsed >= t.mixDuration) t.prev = null;
      if (t.prev && t.mixDuration <= 0) t.prev = null;
    }
  }

  private advance(name: string, time: number, loop: boolean): number {
    const anim = this.data.animations[name];
    if (!anim) return time;
    const dur = Math.max(getAnimationDuration(anim), 0.001);
    if (time <= dur) return time;
    return loop ? time % dur : dur;
  }

  /** Pose of a single track relative to `under` (the pose below it). */
  private trackPose(t: TrackState, under: BoneData[]): BoneData[] | null {
    const current = t.animation
      ? computeAnimatedLocals(this.data, t.animation, t.time)
      : t.prev
        ? under
        : null;
    if (!current) return null;
    if (!t.prev) return current;
    const prevPose = computeAnimatedLocals(this.data, t.prev, t.prevTime);
    const w = t.mixDuration > 0 ? Math.min(t.mixElapsed / t.mixDuration, 1) : 1;
    return blendLocals(prevPose, current, w);
  }

  /** Blended locals for the current state. */
  pose(): BoneData[] {
    let result = this.data.bones.map((b) => ({ ...b }));
    const setup = this.data.bones;
    this.tracks.forEach((t, i) => {
      const p = this.trackPose(t, i === 0 ? setup : result);
      if (!p) return;
      if (i === 0) {
        result = p.map((b) => ({ ...b }));
        return;
      }
      if (t.additive) {
        const setupByName = new Map(setup.map((b) => [b.name, b]));
        const byName = new Map(p.map((b) => [b.name, b]));
        result = result.map((r) => {
          const tp = byName.get(r.name);
          const s = setupByName.get(r.name);
          if (!tp || !s) return r;
          return {
            ...r,
            x: r.x + (tp.x - s.x) * t.alpha,
            y: r.y + (tp.y - s.y) * t.alpha,
            rotation: r.rotation + (tp.rotation - s.rotation) * t.alpha,
            scaleX: r.scaleX * (1 + (tp.scaleX / (s.scaleX || 1) - 1) * t.alpha),
            scaleY: r.scaleY * (1 + (tp.scaleY / (s.scaleY || 1) - 1) * t.alpha),
            shearX: r.shearX + (tp.shearX - s.shearX) * t.alpha,
            shearY: r.shearY + (tp.shearY - s.shearY) * t.alpha,
          };
        });
      } else {
        result = blendLocals(result, p, t.alpha);
      }
    });
    return result;
  }
}
