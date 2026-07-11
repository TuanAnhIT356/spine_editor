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
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (let ry = 0; ry <= rows; ry++) {
    for (let cx = 0; cx <= cols; cx++) {
      const u = cx / cols;
      const v = ry / rows;
      // v=0 is the image top; vertex y is up, so the top row sits at +height/2.
      vertices.push(-width / 2 + u * width, height / 2 - v * height);
      uvs.push(u, v);
    }
  }
  const triangles: number[] = [];
  const stride = cols + 1;
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const tl = ry * stride + cx;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      triangles.push(tl, tr, br, tl, br, bl);
    }
  }
  return {
    type: 'mesh',
    uvs,
    triangles,
    vertices,
    hull: 2 * (cols + rows),
    width,
    height,
  };
}
