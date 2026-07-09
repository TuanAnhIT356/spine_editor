import { describe, expect, it } from 'vitest';
import {
  CreateSkin,
  RemoveSkin,
  SpineDocument,
  createEmptySkeleton,
  parseAtlas,
} from '../src/index.js';

describe('parseAtlas', () => {
  it('parses the legacy libgdx layout (xy/size/orig/offset)', () => {
    const text = `
skeleton.png
size: 256,128
format: RGBA8888
filter: Linear,Linear
repeat: none
arm
  rotate: false
  xy: 2, 2
  size: 40, 60
  orig: 48, 64
  offset: 4, 2
  index: -1
torso
  rotate: true
  xy: 44, 2
  size: 80, 50
  orig: 80, 50
  offset: 0, 0
  index: -1
`;
    const pages = parseAtlas(text);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.name).toBe('skeleton.png');
    const [arm, torso] = pages[0]!.regions;
    expect(arm).toMatchObject({
      name: 'arm',
      x: 2,
      y: 2,
      width: 40,
      height: 60,
      rotate: false,
      offsetX: 4,
      offsetY: 2,
      origWidth: 48,
      origHeight: 64,
    });
    expect(torso).toMatchObject({ name: 'torso', rotate: true, width: 80, height: 50 });
  });

  it('parses the Spine 4.x layout (bounds/offsets, rotate: 90) and multiple pages', () => {
    const text = `page1.png
   size: 1024,1024
   filter: Linear,Linear
head
   bounds: 2,2,190,45
leg
   bounds: 194,2,30,80
   offsets: 1,3,32,86
   rotate: 90

page2.png
   size: 512,512
tail
   bounds: 4,4,60,20
`;
    const pages = parseAtlas(text);
    expect(pages.map((p) => p.name)).toEqual(['page1.png', 'page2.png']);
    const [head, leg] = pages[0]!.regions;
    expect(head).toMatchObject({ x: 2, y: 2, width: 190, height: 45, rotate: false });
    // orig defaults to the packed size when no offsets are given.
    expect(head!.origWidth).toBe(190);
    expect(leg).toMatchObject({
      rotate: true,
      offsetX: 1,
      offsetY: 3,
      origWidth: 32,
      origHeight: 86,
    });
    expect(pages[1]!.regions[0]!.name).toBe('tail');
  });
});

describe('skin commands', () => {
  it('creates, duplicates and removes skins with undo', () => {
    const data = createEmptySkeleton();
    data.skins[0]!.attachments = { arm: { img: { width: 10, height: 10 } } };
    const doc = new SpineDocument(data);

    doc.execute(new CreateSkin('red', 'default'));
    expect(doc.data.skins.map((s) => s.name)).toEqual(['default', 'red']);
    expect(doc.data.skins[1]!.attachments?.['arm']?.['img']).toBeDefined();
    // Deep copy: mutating the copy must not touch the source.
    doc.data.skins[1]!.attachments!['arm']!['img'] = { width: 99, height: 99 };
    expect((doc.data.skins[0]!.attachments!['arm']!['img'] as { width?: number }).width).toBe(10);

    expect(() => doc.execute(new CreateSkin('red'))).toThrow(/already exists/);
    expect(() => doc.execute(new RemoveSkin('default'))).toThrow(/cannot be removed/);

    doc.execute(new RemoveSkin('red'));
    expect(doc.data.skins.map((s) => s.name)).toEqual(['default']);
    doc.undo();
    expect(doc.data.skins.map((s) => s.name)).toEqual(['default', 'red']);
  });
});
