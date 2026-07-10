import { describe, expect, it } from 'vitest';
import { atlasToText, packAtlas, parseAtlas } from '../src/index.js';

describe('atlas pack → text → parse round-trip', () => {
  it('preserves every region name, size and position', () => {
    const layout = packAtlas(
      [
        { name: 'head', width: 64, height: 80 },
        { name: 'torso', width: 100, height: 120 },
        { name: 'hand', width: 30, height: 30 },
      ],
      { maxWidth: 256, padding: 2 },
    );
    const text = atlasToText('page.png', layout);
    const pages = parseAtlas(text);
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.name).toBe('page.png');
    expect(page.regions).toHaveLength(3);
    for (const placed of layout.regions) {
      const parsed = page.regions.find((r) => r.name === placed.name);
      expect(parsed, placed.name).toBeDefined();
      expect(parsed!.x).toBe(placed.x);
      expect(parsed!.y).toBe(placed.y);
      expect(parsed!.width).toBe(placed.width);
      expect(parsed!.height).toBe(placed.height);
      expect(parsed!.rotate).toBe(false);
      expect(parsed!.origWidth).toBe(placed.width);
      expect(parsed!.origHeight).toBe(placed.height);
    }
  });

  // The shelf packer never rotates regions (atlasToText always writes
  // "rotate: false"), so rotated regions are exercised by the import fixtures
  // in phase10.test.ts — this suite intentionally covers the writer's output.
});
