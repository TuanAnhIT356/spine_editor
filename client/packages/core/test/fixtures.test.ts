import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPINE_JSON_TARGET_VERSION, type SpineJson } from '../src/index.js';

const FIXTURES_DIR = join(import.meta.dirname, '../../../examples/fixtures');

function loadFixture(name: string): SpineJson {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as SpineJson;
}

describe('spine json fixtures', () => {
  it('simple-skeleton.json targets the project format version', () => {
    const json = loadFixture('simple-skeleton.json');
    expect(json.skeleton.spine.startsWith(SPINE_JSON_TARGET_VERSION)).toBe(true);
  });

  it('simple-skeleton.json has a consistent bone hierarchy', () => {
    const json = loadFixture('simple-skeleton.json');
    const bones = json.bones ?? [];
    const names = new Set(bones.map((b) => b.name));
    expect(names.size).toBe(bones.length);
    for (const bone of bones) {
      if (bone.parent !== undefined) {
        expect(names.has(bone.parent)).toBe(true);
      }
    }
    for (const slot of json.slots ?? []) {
      expect(names.has(slot.bone)).toBe(true);
    }
  });
});
