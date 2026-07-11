import { describe, expect, it } from 'vitest';
import {
  AddBone,
  AddSkinAttachment,
  AddSlot,
  Composite,
  RemoveSkinAttachment,
  ReorderSlot,
  ReparentBone,
  SpineDocument,
  createBone,
  createSlot,
} from '../src/index.js';

function rig(): SpineDocument {
  const doc = new SpineDocument();
  doc.execute(new AddBone(createBone('hip', 'root')));
  doc.execute(new AddBone(createBone('torso', 'hip')));
  doc.execute(new AddBone(createBone('arm', 'torso')));
  return doc;
}

describe('ReparentBone', () => {
  it('changes the parent and keeps parents-first ordering, undoably', () => {
    const doc = rig();
    doc.execute(new ReparentBone('arm', 'hip'));
    expect(doc.findBone('arm')?.parent).toBe('hip');
    expect(doc.validate()).toEqual([]);
    doc.undo();
    expect(doc.findBone('arm')?.parent).toBe('torso');
    expect(doc.validate()).toEqual([]);
  });

  it('rejects cycles and reparenting root', () => {
    const doc = rig();
    expect(() => doc.execute(new ReparentBone('hip', 'arm'))).toThrow(/descendant/);
    expect(() => doc.execute(new ReparentBone('root', 'hip'))).toThrow(/root bone/);
    expect(() => doc.execute(new ReparentBone('hip', 'hip'))).toThrow(/itself/);
  });
});

describe('ReorderSlot', () => {
  it('moves a slot within the draw order, undoably', () => {
    const doc = rig();
    doc.execute(new AddSlot(createSlot('a', 'hip')));
    doc.execute(new AddSlot(createSlot('b', 'hip')));
    doc.execute(new AddSlot(createSlot('c', 'hip')));
    doc.execute(new ReorderSlot('c', 0));
    expect(doc.data.slots.map((s) => s.name)).toEqual(['c', 'a', 'b']);
    doc.undo();
    expect(doc.data.slots.map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('skin attachment commands', () => {
  it('adds and removes a region attachment in the default skin', () => {
    const doc = rig();
    doc.execute(new AddSlot(createSlot('body', 'torso', { attachment: 'body' })));
    doc.execute(new AddSkinAttachment('default', 'body', 'body', { width: 50, height: 80 }));
    expect(doc.data.skins[0]?.attachments?.['body']?.['body']).toEqual({ width: 50, height: 80 });
    expect(doc.validate()).toEqual([]);

    doc.execute(new RemoveSkinAttachment('default', 'body', 'body'));
    expect(doc.data.skins[0]?.attachments).toBeUndefined();
    expect(doc.findSlot('body')?.attachment).toBeNull();
    doc.undo();
    expect(doc.data.skins[0]?.attachments?.['body']?.['body']).toBeDefined();
    expect(doc.findSlot('body')?.attachment).toBe('body');
  });

  it('rejects duplicates unless allowReplace', () => {
    const doc = rig();
    doc.execute(new AddSlot(createSlot('body', 'torso')));
    doc.execute(new AddSkinAttachment('default', 'body', 'img', { width: 1, height: 1 }));
    expect(() =>
      doc.execute(new AddSkinAttachment('default', 'body', 'img', { width: 2, height: 2 })),
    ).toThrow(/already exists/);
    doc.execute(new AddSkinAttachment('default', 'body', 'img', { width: 2, height: 2 }, true));
    expect(doc.data.skins[0]?.attachments?.['body']?.['img']).toEqual({ width: 2, height: 2 });
  });
});

describe('Composite', () => {
  it('is a single undo step and rolls back on mid-failure', () => {
    const doc = rig();
    doc.execute(
      new Composite('Attach image', [
        new AddSlot(createSlot('body', 'torso', { attachment: 'body' })),
        new AddSkinAttachment('default', 'body', 'body', { width: 10, height: 10 }),
      ]),
    );
    expect(doc.findSlot('body')).toBeDefined();
    doc.undo();
    expect(doc.findSlot('body')).toBeUndefined();
    expect(doc.data.skins[0]?.attachments).toBeUndefined();

    expect(() =>
      doc.execute(
        new Composite('Bad', [
          new AddSlot(createSlot('x', 'torso')),
          new AddSkinAttachment('default', 'missing-slot', 'img', { width: 1, height: 1 }),
        ]),
      ),
    ).toThrow(/does not exist/);
    expect(doc.findSlot('x')).toBeUndefined();
  });
});
