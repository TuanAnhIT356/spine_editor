import { describe, expect, it } from 'vitest';
import { BRIDGE_OPS, TOOL_DEFS, toolJsonSchemas } from '../src/index.js';

describe('TOOL_DEFS', () => {
  it('has 65 uniquely named tools with valid ops and descriptions', () => {
    expect(TOOL_DEFS).toHaveLength(65);
    const names = TOOL_DEFS.map((d) => d.name);
    expect(new Set(names).size).toBe(65);
    for (const d of TOOL_DEFS) {
      expect(BRIDGE_OPS).toContain(d.op);
      expect(d.description.length).toBeGreaterThan(10);
    }
  });

  it('maps exactly two non-text presenter tools', () => {
    const shot = TOOL_DEFS.find((d) => d.name === 'screenshot_viewport');
    expect(shot).toMatchObject({ op: 'screenshot', result: 'image' });
    const atlas = TOOL_DEFS.find((d) => d.name === 'export_atlas');
    expect(atlas).toMatchObject({ op: 'export_atlas', result: 'atlas' });
    expect(TOOL_DEFS.filter((d) => d.result !== 'text')).toHaveLength(2);
  });

  it('produces anthropic-ready object schemas', () => {
    const schemas = toolJsonSchemas();
    expect(schemas).toHaveLength(65);
    for (const s of schemas) {
      expect(s.input_schema['type']).toBe('object');
      expect(s.input_schema['$schema']).toBeUndefined();
    }
    const kf = schemas.find((s) => s.name === 'set_bone_keyframe')!;
    const props = kf.input_schema['properties'] as Record<string, unknown>;
    expect(props['animation']).toBeDefined();
    expect(props['curve']).toBeDefined();
  });
});
