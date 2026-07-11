/**
 * Mesh helpers: builds a grid mesh attachment covering an image, centered on
 * the slot's bone origin (matching how region attachments render). The grid
 * gives deform timelines vertices to move.
 */

import type { SpineMeshAttachment } from './spine-json/types.js';

export function buildGridMeshAttachment(
  width: number,
  height: number,
  cols = 3,
  rows = 3,
): SpineMeshAttachment {
  if (cols < 1 || rows < 1) throw new Error('Grid mesh needs at least 1x1 cells.');
  const stride = cols + 1;
  const total = (cols + 1) * (rows + 1);
  // Spine hull convention: the first `hull` vertices trace the outline in order.
  const ring: number[] = [];
  for (let cx = 0; cx <= cols; cx++) ring.push(cx); // top row →
  for (let ry = 1; ry <= rows; ry++) ring.push(ry * stride + cols); // right col ↓
  for (let cx = cols - 1; cx >= 0; cx--) ring.push(rows * stride + cx); // bottom ←
  for (let ry = rows - 1; ry >= 1; ry--) ring.push(ry * stride); // left ↑
  const inRing = new Set(ring);
  const order: number[] = [...ring];
  for (let i = 0; i < total; i++) if (!inRing.has(i)) order.push(i);
  const newIndex = new Map(order.map((gridIdx, idx) => [gridIdx, idx]));
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (const gridIdx of order) {
    const cx = gridIdx % stride;
    const ry = Math.floor(gridIdx / stride);
    const u = cx / cols;
    const v = ry / rows;
    // v=0 is the image top; vertex y is up, so the top row sits at +height/2.
    vertices.push(-width / 2 + u * width, height / 2 - v * height);
    uvs.push(u, v);
  }
  const triangles: number[] = [];
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const tl = ry * stride + cx;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      triangles.push(
        newIndex.get(tl)!,
        newIndex.get(tr)!,
        newIndex.get(br)!,
        newIndex.get(tl)!,
        newIndex.get(br)!,
        newIndex.get(bl)!,
      );
    }
  }
  return { type: 'mesh', uvs, triangles, vertices, hull: 2 * (cols + rows), width, height };
}
