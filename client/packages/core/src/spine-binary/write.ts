/**
 * Spine .skel binary writer. Follows the public binary-format documentation
 * for every documented section; Spine 4.2 features the public page does not
 * cover use the [dialect] codes in constants.ts and the version marker
 * "4.2-se.1" (see constants.ts header note).
 */

import type { SkeletonData } from '../model/types.js';
import type {
  SpineAnimation,
  SpineAttachment,
  SpineAttachmentKey,
  SpineBoneKey,
  SpineBoundingBoxAttachment,
  SpineClippingAttachment,
  SpineColorKey,
  SpineCurve,
  SpineLinkedMeshAttachment,
  SpineMeshAttachment,
  SpinePathAttachment,
  SpinePointAttachment,
  SpineRegionAttachment,
  SpineSequence,
  SpineTransformKey,
  SpineTwoColorKey,
  SpineValueKey,
} from '../spine-json/types.js';
import { DataWriter } from './binary-io.js';
import {
  ATTACHMENT_TYPES,
  BLEND_MODES,
  BONE_TIMELINES,
  CURVE_BEZIER,
  CURVE_LINEAR,
  CURVE_STEPPED,
  INHERIT_MODES,
  PATH_TIMELINES,
  PHYSICS_TIMELINES,
  POSITION_MODES,
  ROTATE_MODES,
  SKEL_VERSION,
  SLOT_TIMELINES,
  SPACING_MODES,
} from './constants.js';

class SkelWriter {
  readonly w = new DataWriter();
  private strings = new Map<string, number>();

  constructor(private readonly data: SkeletonData) {}

  /** Pass 1: collect every string later written as a ref. */
  collectStrings(): void {
    const add = (s: string | null | undefined) => {
      if (s !== null && s !== undefined && !this.strings.has(s)) {
        this.strings.set(s, this.strings.size + 1);
      }
    };
    for (const slot of this.data.slots) add(slot.attachment);
    for (const skin of this.data.skins) {
      for (const bySlot of Object.values(skin.attachments ?? {})) {
        for (const [placeholder, att] of Object.entries(bySlot)) {
          add(placeholder);
          add((att as { name?: string }).name);
          if ('path' in att) add(att.path);
          if (att.type === 'clipping') add(att.end);
          if (att.type === 'linkedmesh') {
            add(att.skin);
            add(att.parent);
          }
        }
      }
    }
    for (const anim of Object.values(this.data.animations)) {
      for (const timelines of Object.values(anim.slots ?? {})) {
        for (const key of timelines.attachment ?? []) add(key.name);
      }
      for (const bySkin of Object.values(anim.attachments ?? {})) {
        for (const bySlot of Object.values(bySkin)) {
          for (const attName of Object.keys(bySlot)) add(attName);
        }
      }
    }
  }

  writeStringsTable(): void {
    this.w.varint(this.strings.size);
    for (const s of this.strings.keys()) this.w.utf8String(s);
  }

  ref(s: string | null | undefined): void {
    if (s === null || s === undefined) this.w.varint(0);
    else this.w.varint(this.strings.get(s)!);
  }

  boneIndex(name: string): number {
    return this.data.bones.findIndex((b) => b.name === name);
  }

  slotIndex(name: string): number {
    return this.data.slots.findIndex((s) => s.name === name);
  }
}

export function writeSkel(data: SkeletonData): Uint8Array {
  const sw = new SkelWriter(data);
  const w = sw.w;
  // Header [doc]: hash, version, x, y, width, height, nonessential(+fps/images/audio).
  w.utf8String(data.meta.hash ?? null);
  w.utf8String(SKEL_VERSION);
  w.float32(data.meta.x);
  w.float32(data.meta.y);
  w.float32(data.meta.width);
  w.float32(data.meta.height);
  w.boolean(true); // always write nonessential data
  w.float32(data.meta.fps ?? 30);
  w.utf8String(data.meta.images);
  w.utf8String(data.meta.audio);
  sw.collectStrings();
  sw.writeStringsTable();

  // Bones [doc].
  w.varint(data.bones.length);
  data.bones.forEach((bone, i) => {
    w.utf8String(bone.name);
    if (i > 0) w.varint(sw.boneIndex(bone.parent!));
    w.float32(bone.rotation);
    w.float32(bone.x);
    w.float32(bone.y);
    w.float32(bone.scaleX);
    w.float32(bone.scaleY);
    w.float32(bone.shearX);
    w.float32(bone.shearY);
    w.float32(bone.length);
    w.varint(INHERIT_MODES.indexOf(bone.inherit));
    w.boolean(bone.skinRequired);
    w.color8888(bone.color ?? '989898ff'); // nonessential
  });

  // Slots [doc].
  w.varint(data.slots.length);
  for (const slot of data.slots) {
    w.utf8String(slot.name);
    w.varint(sw.boneIndex(slot.bone));
    w.color8888(slot.color);
    if (slot.dark === null) w.int32(-1);
    else w.color8888(slot.dark + 'ff');
    sw.ref(slot.attachment);
    w.varint(BLEND_MODES.indexOf(slot.blend));
  }

  // IK [doc].
  w.varint(data.ik.length);
  for (const ik of data.ik) {
    w.utf8String(ik.name);
    w.varint(ik.order);
    w.boolean(ik.skinRequired);
    w.varint(ik.bones.length);
    for (const b of ik.bones) w.varint(sw.boneIndex(b));
    w.varint(sw.boneIndex(ik.target));
    w.float32(ik.mix);
    w.float32(ik.softness);
    w.byte(ik.bendPositive ? 1 : 0xff); // 1 or -1 [doc]
    w.boolean(ik.compress);
    w.boolean(ik.stretch);
    w.boolean(ik.uniform);
  }

  // Transform [doc].
  w.varint(data.transform.length);
  for (const tc of data.transform) {
    w.utf8String(tc.name);
    w.varint(tc.order);
    w.boolean(tc.skinRequired);
    w.varint(tc.bones.length);
    for (const b of tc.bones) w.varint(sw.boneIndex(b));
    w.varint(sw.boneIndex(tc.target));
    w.boolean(tc.local);
    w.boolean(tc.relative);
    w.float32(tc.rotation);
    w.float32(tc.x);
    w.float32(tc.y);
    w.float32(tc.scaleX);
    w.float32(tc.scaleY);
    w.float32(tc.shearY);
    w.float32(tc.mixRotate);
    w.float32(tc.mixX);
    w.float32(tc.mixY);
    w.float32(tc.mixScaleX);
    w.float32(tc.mixScaleY);
    w.float32(tc.mixShearY);
  }

  // Path [doc].
  w.varint(data.path.length);
  for (const pc of data.path) {
    w.utf8String(pc.name);
    w.varint(pc.order ?? 0);
    w.boolean(pc.skin ?? false);
    w.varint(pc.bones.length);
    for (const b of pc.bones) w.varint(sw.boneIndex(b));
    w.varint(sw.slotIndex(pc.target));
    w.varint(POSITION_MODES.indexOf(pc.positionMode ?? 'percent'));
    w.varint(SPACING_MODES.indexOf(pc.spacingMode ?? 'length'));
    w.varint(ROTATE_MODES.indexOf(pc.rotateMode ?? 'tangent'));
    w.float32(pc.rotation ?? 0);
    w.float32(pc.position ?? 0);
    w.float32(pc.spacing ?? 0);
    w.float32(pc.mixRotate ?? 1);
    w.float32(pc.mixX ?? 1);
    w.float32(pc.mixY ?? pc.mixX ?? 1);
  }

  // Physics [dialect] — bone index + fixed field order with defaults.
  w.varint(data.physics.length);
  for (const ph of data.physics) {
    w.utf8String(ph.name);
    w.varint(ph.order ?? 0);
    w.boolean(ph.skin ?? false);
    w.varint(sw.boneIndex(ph.bone));
    w.float32(ph.x ?? 0);
    w.float32(ph.y ?? 0);
    w.float32(ph.rotate ?? 0);
    w.float32(ph.scaleX ?? 0);
    w.float32(ph.shearX ?? 0);
    w.float32(ph.limit ?? 5000);
    w.float32(ph.fps ?? 60);
    w.float32(ph.inertia ?? 1);
    w.float32(ph.strength ?? 100);
    w.float32(ph.damping ?? 1);
    w.float32(ph.mass ?? 1);
    w.float32(ph.wind ?? 0);
    w.float32(ph.gravity ?? 0);
    w.float32(ph.mix ?? 1);
    w.boolean(ph.inertiaGlobal ?? false);
    w.boolean(ph.strengthGlobal ?? false);
    w.boolean(ph.dampingGlobal ?? false);
    w.boolean(ph.massGlobal ?? false);
    w.boolean(ph.windGlobal ?? false);
    w.boolean(ph.gravityGlobal ?? false);
  }

  writeSkins(sw, data);
  writeEvents(sw, data);
  writeAnimations(sw, data);
  return w.bytes();
}

function writeSkins(sw: SkelWriter, data: SkeletonData): void {
  const def = data.skins.find((s) => s.name === 'default');
  writeSkinBody(sw, def);
  const others = data.skins.filter((s) => s.name !== 'default');
  sw.w.varint(others.length);
  for (const skin of others) {
    sw.w.utf8String(skin.name); // [dialect] named-skin names inline (not via strings table)
    writeSkinBody(sw, skin);
  }
}

function writeSkinBody(sw: SkelWriter, skin: SkeletonData['skins'][number] | undefined): void {
  const w = sw.w;
  const entries = Object.entries(skin?.attachments ?? {});
  w.varint(entries.length);
  for (const [slotName, bySlot] of entries) {
    w.varint(sw.slotIndex(slotName));
    const atts = Object.entries(bySlot);
    w.varint(atts.length);
    for (const [placeholder, att] of atts) {
      sw.ref(placeholder);
      writeAttachment(sw, att);
    }
  }
}

function writeSequence(w: DataWriter, seq: SpineSequence | undefined): void {
  w.boolean(seq !== undefined);
  if (!seq) return;
  w.varint(seq.count);
  w.varint(seq.start ?? 1);
  w.varint(seq.digits ?? 0);
  w.varint(seq.setup ?? 0);
}

function writeVertices(w: DataWriter, vertices: number[], vertexCount: number): void {
  w.varint(vertexCount);
  const weighted = vertices.length !== vertexCount * 2;
  w.boolean(weighted);
  if (!weighted) {
    for (const v of vertices) w.float32(v);
    return;
  }
  let vi = 0;
  for (let v = 0; v < vertexCount; v++) {
    const n = vertices[vi++]!;
    w.varint(n);
    for (let b = 0; b < n; b++) {
      w.varint(vertices[vi++]!);
      w.float32(vertices[vi++]!);
      w.float32(vertices[vi++]!);
      w.float32(vertices[vi++]!);
    }
  }
}

function writeAttachment(sw: SkelWriter, att: SpineAttachment): void {
  const w = sw.w;
  const type = att.type ?? 'region';
  sw.ref((att as { name?: string }).name ?? null);
  w.byte(ATTACHMENT_TYPES.indexOf(type as (typeof ATTACHMENT_TYPES)[number]));
  switch (type) {
    case 'region': {
      const a = att as SpineRegionAttachment;
      sw.ref(a.path ?? null);
      w.float32(a.rotation ?? 0);
      w.float32(a.x ?? 0);
      w.float32(a.y ?? 0);
      w.float32(a.scaleX ?? 1);
      w.float32(a.scaleY ?? 1);
      w.float32(a.width ?? 0);
      w.float32(a.height ?? 0);
      w.color8888(a.color ?? 'ffffffff');
      writeSequence(w, a.sequence);
      break;
    }
    case 'boundingbox': {
      const a = att as SpineBoundingBoxAttachment;
      writeVertices(w, a.vertices, a.vertexCount);
      w.color8888(a.color ?? '60f000ff'); // nonessential
      break;
    }
    case 'mesh': {
      const a = att as SpineMeshAttachment;
      sw.ref(a.path ?? null);
      w.color8888(a.color ?? 'ffffffff');
      const vertexCount = a.uvs.length / 2;
      w.varint(vertexCount);
      for (const u of a.uvs) w.float32(u);
      w.varint(a.triangles.length);
      for (const t of a.triangles) w.varint(t);
      writeVertices(w, a.vertices, vertexCount);
      w.varint(a.hull ?? 0);
      writeSequence(w, a.sequence);
      // nonessential:
      w.varint(a.edges?.length ?? 0);
      for (const e of a.edges ?? []) w.varint(e);
      w.float32(a.width ?? 0);
      w.float32(a.height ?? 0);
      break;
    }
    case 'linkedmesh': {
      const a = att as SpineLinkedMeshAttachment;
      sw.ref(a.path ?? null);
      w.color8888(a.color ?? 'ffffffff');
      sw.ref(a.skin ?? null);
      sw.ref(a.parent);
      w.boolean(a.timelines !== false);
      w.float32(a.width ?? 0);
      w.float32(a.height ?? 0);
      break;
    }
    case 'path': {
      const a = att as SpinePathAttachment;
      w.boolean(a.closed ?? false);
      w.boolean(a.constantSpeed ?? true);
      writeVertices(w, a.vertices, a.vertexCount);
      for (const len of a.lengths) w.float32(len);
      w.color8888(a.color ?? 'ff7f00ff'); // nonessential
      break;
    }
    case 'point': {
      const a = att as SpinePointAttachment;
      w.float32(a.rotation ?? 0);
      w.float32(a.x ?? 0);
      w.float32(a.y ?? 0);
      w.color8888(a.color ?? 'f1f100ff'); // nonessential
      break;
    }
    case 'clipping': {
      const a = att as SpineClippingAttachment;
      sw.ref(a.end ?? null);
      writeVertices(w, a.vertices, a.vertexCount);
      w.color8888(a.color ?? 'ce3a3aff'); // nonessential
      break;
    }
  }
}

/** Events section [doc]: name + payload defaults (+volume/balance when audio). */
function writeEvents(sw: SkelWriter, data: SkeletonData): void {
  const w = sw.w;
  const entries = Object.entries(data.events);
  w.varint(entries.length);
  for (const [name, def] of entries) {
    w.utf8String(name);
    w.varint(def.int ?? 0, false);
    w.float32(def.float ?? 0);
    w.utf8String(def.string ?? null);
    w.utf8String(def.audio ?? null);
    if (def.audio) {
      w.float32(def.volume ?? 1);
      w.float32(def.balance ?? 0);
    }
  }
}

function writeCurve(w: DataWriter, curve: SpineCurve | undefined, channels: number): void {
  if (curve === 'stepped') {
    w.byte(CURVE_STEPPED);
    return;
  }
  if (Array.isArray(curve)) {
    w.byte(CURVE_BEZIER);
    for (let c = 0; c < channels * 4; c++) w.float32(curve[c] ?? 0);
    return;
  }
  w.byte(CURVE_LINEAR);
}

type TimedKey = { time?: number; curve?: SpineCurve };

function writeFrames<K extends TimedKey>(
  w: DataWriter,
  keys: K[],
  channels: number,
  writeValues: (k: K) => void,
): void {
  w.varint(keys.length);
  keys.forEach((k, i) => {
    w.float32(k.time ?? 0);
    writeValues(k);
    if (i < keys.length - 1) writeCurve(w, k.curve, channels);
  });
}

function writeAnimations(sw: SkelWriter, data: SkeletonData): void {
  const w = sw.w;
  const entries = Object.entries(data.animations);
  w.varint(entries.length);
  for (const [name, anim] of entries) {
    w.utf8String(name);
    writeAnimation(sw, data, anim);
  }
}

function writeAnimation(sw: SkelWriter, data: SkeletonData, anim: SpineAnimation): void {
  const w = sw.w;
  // Slots.
  const slotEntries = Object.entries(anim.slots ?? {});
  w.varint(slotEntries.length);
  for (const [slotName, tl] of slotEntries) {
    w.varint(sw.slotIndex(slotName));
    const present = SLOT_TIMELINES.filter(
      (t) => ((tl as Record<string, unknown[] | undefined>)[t]?.length ?? 0) > 0,
    );
    w.varint(present.length);
    for (const t of present) {
      w.byte(SLOT_TIMELINES.indexOf(t));
      switch (t) {
        case 'attachment': {
          const keys = tl.attachment as SpineAttachmentKey[];
          w.varint(keys.length);
          for (const k of keys) {
            w.float32(k.time ?? 0);
            sw.ref(k.name ?? null);
          }
          break;
        }
        case 'rgba':
        case 'rgb': {
          const keys = (t === 'rgba' ? tl.rgba : tl.rgb) as SpineColorKey[];
          writeFrames(w, keys, t === 'rgba' ? 4 : 3, (k) => {
            const color = k.color ?? 'ffffffff';
            w.color8888(t === 'rgba' ? color : color.slice(0, 6) + 'ff');
          });
          break;
        }
        case 'alpha': {
          const keys = tl.alpha as SpineValueKey[];
          writeFrames(w, keys, 1, (k) => w.float32((k as { value?: number }).value ?? 1));
          break;
        }
        case 'rgba2':
        case 'rgb2': {
          const keys = (t === 'rgba2' ? tl.rgba2 : tl.rgb2) as SpineTwoColorKey[];
          writeFrames(w, keys, t === 'rgba2' ? 7 : 6, (k) => {
            const light = k.light ?? 'ffffffff';
            w.color8888(t === 'rgba2' ? light : light.slice(0, 6) + 'ff');
            w.color8888((k.dark ?? '000000') + 'ff');
          });
          break;
        }
      }
    }
  }
  // Bones.
  const boneEntries = Object.entries(anim.bones ?? {});
  w.varint(boneEntries.length);
  for (const [boneName, tl] of boneEntries) {
    w.varint(sw.boneIndex(boneName));
    const present = BONE_TIMELINES.filter(
      (t) => ((tl as Record<string, unknown[] | undefined>)[t]?.length ?? 0) > 0,
    );
    w.varint(present.length);
    for (const t of present) {
      w.byte(BONE_TIMELINES.indexOf(t));
      const keys = (tl as Record<string, SpineBoneKey[] | undefined>)[t]!;
      const twoValue = t === 'translate' || t === 'scale' || t === 'shear';
      writeFrames(w, keys, twoValue ? 2 : 1, (k) => {
        if (twoValue) {
          w.float32(k.x ?? (t === 'scale' ? 1 : 0));
          w.float32(k.y ?? (t === 'scale' ? 1 : 0));
        } else if (t === 'rotate') {
          w.float32(k.value ?? 0);
        } else {
          const dflt = t === 'scalex' || t === 'scaley' ? 1 : 0;
          w.float32(k.value ?? dflt);
        }
      });
    }
  }
  // IK.
  const ikEntries = Object.entries(anim.ik ?? {});
  w.varint(ikEntries.length);
  for (const [name, keys] of ikEntries) {
    w.varint(data.ik.findIndex((c) => c.name === name));
    writeFrames(w, keys, 2, (k) => {
      w.float32(k.mix ?? 1);
      w.float32(k.softness ?? 0);
      w.byte((k.bendPositive ?? true) ? 1 : 0xff);
      w.boolean(k.compress ?? false);
      w.boolean(k.stretch ?? false);
    });
  }
  // Transform.
  const tcEntries = Object.entries(anim.transform ?? {});
  w.varint(tcEntries.length);
  for (const [name, keys] of tcEntries) {
    w.varint(data.transform.findIndex((c) => c.name === name));
    writeFrames(w, keys as SpineTransformKey[], 6, (k) => {
      w.float32(k.mixRotate ?? 1);
      w.float32(k.mixX ?? 1);
      w.float32(k.mixY ?? k.mixX ?? 1);
      w.float32(k.mixScaleX ?? 1);
      w.float32(k.mixScaleY ?? k.mixScaleX ?? 1);
      w.float32(k.mixShearY ?? 1);
    });
  }
  // Path.
  const pcEntries = Object.entries(anim.path ?? {});
  w.varint(pcEntries.length);
  for (const [name, tl] of pcEntries) {
    w.varint(data.path.findIndex((c) => c.name === name));
    const present = PATH_TIMELINES.filter(
      (t) => ((tl as Record<string, unknown[] | undefined>)[t]?.length ?? 0) > 0,
    );
    w.varint(present.length);
    for (const t of present) {
      w.byte(PATH_TIMELINES.indexOf(t));
      if (t === 'mix') {
        writeFrames(w, tl.mix!, 3, (k) => {
          w.float32(k.mixRotate ?? 1);
          w.float32(k.mixX ?? 1);
          w.float32(k.mixY ?? k.mixX ?? 1);
        });
      } else {
        const keys = (t === 'position' ? tl.position : tl.spacing) as SpineValueKey[];
        writeFrames(w, keys, 1, (k) => w.float32((k as { value?: number }).value ?? 0));
      }
    }
  }
  // Physics [dialect].
  const phEntries = Object.entries(anim.physics ?? {});
  w.varint(phEntries.length);
  for (const [name, tl] of phEntries) {
    w.varint(data.physics.findIndex((c) => c.name === name));
    const present = PHYSICS_TIMELINES.filter(
      (t) => ((tl as Record<string, unknown[] | undefined>)[t]?.length ?? 0) > 0,
    );
    w.varint(present.length);
    for (const t of present) {
      w.byte(PHYSICS_TIMELINES.indexOf(t));
      if (t === 'reset') {
        const keys = tl.reset!;
        w.varint(keys.length);
        for (const k of keys) w.float32(k.time ?? 0);
      } else {
        const keys = (tl as Record<string, SpineValueKey[] | undefined>)[t]!;
        writeFrames(w, keys, 1, (k) => w.float32((k as { value?: number }).value ?? 0));
      }
    }
  }
  // Deform (attachments).
  const skinEntries = Object.entries(anim.attachments ?? {});
  w.varint(skinEntries.length);
  for (const [skinName, bySlot] of skinEntries) {
    w.utf8String(skinName);
    const slots = Object.entries(bySlot);
    w.varint(slots.length);
    for (const [slotName, byAtt] of slots) {
      w.varint(sw.slotIndex(slotName));
      const atts = Object.entries(byAtt);
      w.varint(atts.length);
      for (const [attName, tl] of atts) {
        sw.ref(attName);
        const keys = tl.deform ?? [];
        writeFrames(w, keys, 1, (k) => {
          const verts = k.vertices ?? [];
          w.varint(verts.length);
          if (verts.length > 0) {
            w.varint(k.offset ?? 0);
            for (const v of verts) w.float32(v);
          }
        });
      }
    }
  }
  // Draw order [doc].
  const doKeys = anim.drawOrder ?? [];
  w.varint(doKeys.length);
  for (const k of doKeys) {
    w.float32(k.time ?? 0);
    const offsets = k.offsets ?? [];
    w.varint(offsets.length);
    for (const o of offsets) {
      w.varint(sw.slotIndex(o.slot));
      w.varint(o.offset, false);
    }
  }
  // Events [doc].
  const evKeys = anim.events ?? [];
  w.varint(evKeys.length);
  const eventNames = Object.keys(data.events);
  for (const k of evKeys) {
    w.float32(k.time ?? 0);
    w.varint(eventNames.indexOf(k.name));
    w.varint(k.int ?? 0, false);
    w.float32(k.float ?? 0);
    const hasString = k.string !== undefined;
    w.boolean(hasString);
    if (hasString) w.utf8String(k.string ?? '');
    const def = data.events[k.name];
    if (def?.audio) {
      w.float32(k.volume ?? def.volume ?? 1);
      w.float32(k.balance ?? def.balance ?? 0);
    }
  }
}
