import { describe, expect, it } from 'vitest';
import {
  createBone,
  createEmptySkeleton,
  createSlot,
  SetAttachmentTransform,
} from '../src/index.js';

describe('SetAttachmentTransform', () => {
  function setupData() {
    const data = createEmptySkeleton();
    data.bones.push(createBone('a', 'root'));
    data.slots.push(createSlot('s', 'a', { attachment: 'img' }));
    data.skins[0]!.attachments = {
      s: {
        img: { type: 'region', x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
        pt: { type: 'point', x: 3, y: 4, rotation: 0 },
        m: { type: 'mesh', uvs: [0, 0], triangles: [], vertices: [0, 0], hull: 1 },
      },
    };
    return data;
  }

  it('patches x/y/rotation/scaleX/scaleY on a region attachment', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'img', { x: 10, rotation: 45 });
    cmd.execute(data);
    const att = data.skins[0]!.attachments!.s!.img as { x?: number; y?: number; rotation?: number };
    expect(att.x).toBe(10);
    expect(att.rotation).toBe(45);
    expect(att.y).toBe(2); // untouched field kept
  });

  it('undoes back to the prior values', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'img', { x: 10 });
    cmd.execute(data);
    cmd.undo(data);
    const att = data.skins[0]!.attachments!.s!.img as { x?: number };
    expect(att.x).toBe(1);
  });

  it('patches x/y/rotation on a point attachment', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'pt', { x: 9 });
    cmd.execute(data);
    const att = data.skins[0]!.attachments!.s!.pt as { x?: number };
    expect(att.x).toBe(9);
  });

  it('throws when the patch includes a field the type does not support', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'pt', { scaleX: 2 });
    expect(() => cmd.execute(data)).toThrow(/no "scaleX" field/);
  });

  it('throws for a type with no transform fields at all', () => {
    const data = setupData();
    const cmd = new SetAttachmentTransform('default', 's', 'm', { x: 1 });
    expect(() => cmd.execute(data)).toThrow(/no transform fields/);
  });

  it('throws when the skin/slot/attachment does not exist', () => {
    const data = setupData();
    expect(() => new SetAttachmentTransform('nope', 's', 'img', { x: 1 }).execute(data)).toThrow(
      /Skin "nope"/,
    );
    expect(() =>
      new SetAttachmentTransform('default', 'nope', 'img', { x: 1 }).execute(data),
    ).toThrow(/does not exist/);
  });
});
