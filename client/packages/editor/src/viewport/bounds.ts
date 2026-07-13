import {
  applyMat,
  computeVertexWorldPositions,
  type Mat2D,
  type SkeletonData,
  type SpineRegionAttachment,
} from '@spine-editor/core';
import { attachmentVertexCount, resolveAttachment } from './renderer.js';

/**
 * World-space AABB covering every visible bone (origin + tip) and every
 * visible slot's active attachment shape. Returns null for an empty/fully
 * hidden skeleton (the caller should treat that as a no-op).
 */
export function computeSkeletonBounds(
  data: SkeletonData,
  pose: Map<string, Mat2D>,
  hiddenBones: ReadonlySet<string> = new Set(),
  hiddenSlots: ReadonlySet<string> = new Set(),
  activeSkin = 'default',
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const bone of data.bones) {
    if (hiddenBones.has(bone.name)) continue;
    const m = pose.get(bone.name);
    if (!m) continue;
    extend(m.tx, m.ty);
    if (bone.length > 0) {
      const tip = applyMat(m, bone.length, 0);
      extend(tip.x, tip.y);
    }
  }

  for (const slot of data.slots) {
    if (hiddenSlots.has(slot.name) || !slot.attachment) continue;
    const boneWorld = pose.get(slot.bone);
    if (!boneWorld) continue;
    const att = resolveAttachment(data, slot.name, slot.attachment, activeSkin);
    if (!att) continue;
    if (
      att.type === 'mesh' ||
      att.type === 'boundingbox' ||
      att.type === 'clipping' ||
      att.type === 'path'
    ) {
      const count = attachmentVertexCount(att);
      if (count === null) continue;
      const verts = computeVertexWorldPositions(
        (att as { vertices: number[] }).vertices,
        count,
        boneWorld,
        data.bones,
        pose,
      );
      for (let i = 0; i < verts.length; i += 2) extend(verts[i]!, verts[i + 1]!);
    } else if (att.type === undefined || att.type === 'region') {
      const region = att as SpineRegionAttachment;
      const rot = ((region.rotation ?? 0) * Math.PI) / 180;
      const hw = ((region.width ?? 0) / 2) * (region.scaleX ?? 1);
      const hh = ((region.height ?? 0) / 2) * (region.scaleY ?? 1);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const cx = region.x ?? 0;
      const cy = region.y ?? 0;
      const corners: [number, number][] = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ];
      for (const [lx, ly] of corners) {
        const p = applyMat(boneWorld, cx + lx * cos - ly * sin, cy + lx * sin + ly * cos);
        extend(p.x, p.y);
      }
    } else if (att.type === 'point') {
      const p = applyMat(boneWorld, att.x ?? 0, att.y ?? 0);
      extend(p.x, p.y);
    }
  }

  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
