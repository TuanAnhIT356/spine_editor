import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSpineJson, serializeSpineJson, type SpineJson } from '../src/index.js';

const FIXTURES_DIR = join(import.meta.dirname, '../../../examples/fixtures');
const FIXTURES = ['simple-skeleton.json', 'full-featured.json'];

describe.each(FIXTURES)('round-trip %s', (name) => {
  const original = JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as SpineJson;

  it('parses without errors', () => {
    const { issues } = parseSpineJson(original);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('serializes back to the exact original document', () => {
    const { data } = parseSpineJson(original);
    expect(serializeSpineJson(data)).toEqual(original);
  });

  it('does not share references with the input', () => {
    const copy = structuredClone(original);
    const { data } = parseSpineJson(copy);
    const out = serializeSpineJson(data);
    copy.skeleton.spine = 'mutated';
    if (copy.animations) delete copy.animations[Object.keys(copy.animations)[0]!];
    expect(out).toEqual(original);
  });
});
