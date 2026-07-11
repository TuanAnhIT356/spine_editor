/**
 * Texture atlas packing: shelf (row) packing plus the libgdx-style `.atlas`
 * text format that Spine runtimes load. Image composition happens in the
 * editor (canvas); this module is pure layout/text.
 */

export interface AtlasRegionInput {
  name: string;
  width: number;
  height: number;
}

export interface AtlasRegionPlacement extends AtlasRegionInput {
  x: number;
  y: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  regions: AtlasRegionPlacement[];
}

export interface PackOptions {
  maxWidth?: number;
  padding?: number;
}

function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p *= 2;
  return p;
}

/**
 * Packs regions into a single page using shelf packing (rows, tallest first).
 * Deterministic; page width is the smallest power of two that fits the
 * widest region (capped at maxWidth), height grows as needed.
 */
export function packAtlas(inputs: AtlasRegionInput[], options: PackOptions = {}): AtlasLayout {
  const maxWidth = options.maxWidth ?? 1024;
  const padding = options.padding ?? 2;
  if (inputs.length === 0) return { width: 0, height: 0, regions: [] };

  const widest = Math.max(...inputs.map((r) => r.width));
  if (widest + padding * 2 > maxWidth) {
    throw new Error(`Region wider than the atlas page (max ${maxWidth}px).`);
  }
  const pageWidth = Math.min(maxWidth, nextPow2(widest + padding * 2));

  const sorted = [...inputs].sort((a, b) => b.height - a.height || b.width - a.width);
  const regions: AtlasRegionPlacement[] = [];
  let x = padding;
  let y = padding;
  let shelfHeight = 0;
  for (const input of sorted) {
    if (x + input.width + padding > pageWidth) {
      x = padding;
      y += shelfHeight + padding;
      shelfHeight = 0;
    }
    regions.push({ ...input, x, y });
    x += input.width + padding;
    shelfHeight = Math.max(shelfHeight, input.height);
  }
  return { width: pageWidth, height: nextPow2(y + shelfHeight + padding), regions };
}

/** Renders the libgdx `.atlas` text for a packed page. */
export function atlasToText(pngName: string, layout: AtlasLayout): string {
  const lines: string[] = [
    '',
    pngName,
    `size: ${layout.width}, ${layout.height}`,
    'format: RGBA8888',
    'filter: Linear, Linear',
    'repeat: none',
  ];
  for (const r of [...layout.regions].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(
      r.name,
      '  rotate: false',
      `  xy: ${r.x}, ${r.y}`,
      `  size: ${r.width}, ${r.height}`,
      `  orig: ${r.width}, ${r.height}`,
      '  offset: 0, 0',
      '  index: -1',
    );
  }
  return lines.join('\n') + '\n';
}
