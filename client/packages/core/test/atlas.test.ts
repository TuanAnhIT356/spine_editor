import { describe, expect, it } from 'vitest';
import { atlasToText, packAtlas } from '../src/index.js';

describe('packAtlas', () => {
  it('packs regions without overlap inside the page', () => {
    const layout = packAtlas([
      { name: 'a', width: 100, height: 200 },
      { name: 'b', width: 100, height: 150 },
      { name: 'c', width: 60, height: 60 },
    ]);
    expect(layout.regions).toHaveLength(3);
    for (const r of layout.regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(layout.width);
      expect(r.y + r.height).toBeLessThanOrEqual(layout.height);
    }
    for (const a of layout.regions) {
      for (const b of layout.regions) {
        if (a === b) continue;
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it('rejects regions wider than the page and handles empty input', () => {
    expect(() => packAtlas([{ name: 'x', width: 5000, height: 10 }])).toThrow(/wider/);
    expect(packAtlas([])).toEqual({ width: 0, height: 0, regions: [] });
  });
});

describe('atlasToText', () => {
  it('renders the libgdx atlas format', () => {
    const text = atlasToText('skeleton.png', packAtlas([{ name: 'arm', width: 64, height: 128 }]));
    expect(text).toContain('skeleton.png');
    expect(text).toMatch(/size: \d+, \d+/);
    expect(text).toContain('arm');
    expect(text).toMatch(/ {2}xy: \d+, \d+/);
    expect(text).toContain('  size: 64, 128');
  });
});
