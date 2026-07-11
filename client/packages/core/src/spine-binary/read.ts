/**
 * Spine .skel binary reader — symmetric with write.ts. Unknown/corrupt data
 * becomes ValidationIssues instead of throws; the caller decides how to
 * surface them. Values equal to Spine defaults are omitted so the result
 * serializes identically to canonical (default-free) documents.
 */

import { createEmptySkeleton } from '../document.js';
import { createBone, createSlot } from '../model/factories.js';
import type { SkeletonData } from '../model/types.js';
import type {
  SpineAnimation,
  SpineAttachment,
  SpineAttachmentKey,
  SpineBoneKey,
  SpineColorKey,
  SpineCurve,
  SpineDeformKey,
  SpineDrawOrderKey,
  SpineEventKey,
  SpineIkKey,
  SpinePathMixKey,
  SpineSequence,
  SpineSkin,
  SpineTransformKey,
  SpineTwoColorKey,
  SpineValueKey,
} from '../spine-json/types.js';
import type { ValidationIssue } from '../validate.js';
import { DataReader } from './binary-io.js';
import {
  ATTACHMENT_TYPES,
  BLEND_MODES,
  BONE_TIMELINES,
  CURVE_BEZIER,
  CURVE_STEPPED,
  INHERIT_MODES,
  PATH_TIMELINES,
  PHYSICS_TIMELINES,
  POSITION_MODES,
  ROTATE_MODES,
  SLOT_TIMELINES,
  SPACING_MODES,
} from './constants.js';

class SkelReader {
  strings: string[] = [];
  constructor(readonly r: DataReader) {}

  ref(): string | null {
    const i = this.r.varint();
    return i === 0 ? null : (this.strings[i - 1] ?? null);
  }
}

function readSequence(r: DataReader): SpineSequence | undefined {
  if (!r.boolean()) return undefined;
  const seq: SpineSequence = { count: r.varint() };
  const start = r.varint();
  if (start !== 1) seq.start = start;
  const digits = r.varint();
  if (digits !== 0) seq.digits = digits;
  const setup = r.varint();
  if (setup !== 0) seq.setup = setup;
  return seq;
}

function readVertices(r: DataReader): { vertices: number[]; vertexCount: number } {
  const vertexCount = r.varint();
  const weighted = r.boolean();
  const vertices: number[] = [];
  if (!weighted) {
    for (let i = 0; i < vertexCount * 2; i++) vertices.push(r.float32());
  } else {
    for (let v = 0; v < vertexCount; v++) {
      const n = r.varint();
      vertices.push(n);
      for (let b = 0; b < n; b++) {
        vertices.push(r.varint(), r.float32(), r.float32(), r.float32());
      }
    }
  }
  return { vertices, vertexCount };
}

function readCurve(r: DataReader, channels: number): SpineCurve | undefined {
  const type = r.byte();
  if (type === CURVE_STEPPED) return 'stepped';
  if (type === CURVE_BEZIER) {
    const values: number[] = [];
    for (let c = 0; c < channels * 4; c++) values.push(r.float32());
    return values;
  }
  return undefined; // linear
}

/** Reads `count` frames: time + values + curve (all but the last frame). */
function readFrames<K extends { time?: number; curve?: SpineCurve }>(
  r: DataReader,
  channels: number,
  makeKey: () => K,
  readValues: (k: K) => void,
): K[] {
  const count = r.varint();
  const keys: K[] = [];
  for (let i = 0; i < count; i++) {
    const k = makeKey();
    const t = r.float32();
    if (t !== 0) k.time = t;
    readValues(k);
    if (i < count - 1) {
      const curve = readCurve(r, channels);
      if (curve !== undefined) k.curve = curve;
    }
    keys.push(k);
  }
  return keys;
}

export function readSkel(bytes: Uint8Array): { data: SkeletonData; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const data = createEmptySkeleton();
  data.bones = [];
  data.skins = [];
  const sr = new SkelReader(new DataReader(bytes));
  const r = sr.r;
  try {
    const hash = r.utf8String();
    const version = r.utf8String() ?? '';
    if (!version.startsWith('4.2')) {
      issues.push({
        severity: 'error',
        path: 'skeleton.spine',
        message: `Unsupported .skel version "${version}" (expected 4.2).`,
      });
      return { data: createEmptySkeleton(), issues };
    }
    if (hash) data.meta.hash = hash;
    data.meta.x = r.float32();
    data.meta.y = r.float32();
    data.meta.width = r.float32();
    data.meta.height = r.float32();
    const nonessential = r.boolean();
    if (nonessential) {
      const fps = r.float32();
      if (fps !== 30) data.meta.fps = fps;
      data.meta.images = r.utf8String() ?? '';
      data.meta.audio = r.utf8String() ?? '';
    }
    const stringCount = r.varint();
    for (let i = 0; i < stringCount; i++) sr.strings.push(r.utf8String() ?? '');

    const boneCount = r.varint();
    for (let i = 0; i < boneCount; i++) {
      const name = r.utf8String() ?? `bone${i}`;
      const parentIdx = i > 0 ? r.varint() : -1;
      const bone = createBone(name, i > 0 ? (data.bones[parentIdx]?.name ?? 'root') : null);
      bone.rotation = r.float32();
      bone.x = r.float32();
      bone.y = r.float32();
      bone.scaleX = r.float32();
      bone.scaleY = r.float32();
      bone.shearX = r.float32();
      bone.shearY = r.float32();
      bone.length = r.float32();
      bone.inherit = INHERIT_MODES[r.varint()] ?? 'normal';
      bone.skinRequired = r.boolean();
      const color = r.color8888();
      if (color !== '989898ff') bone.color = color;
      data.bones.push(bone);
    }

    const slotCount = r.varint();
    for (let i = 0; i < slotCount; i++) {
      const name = r.utf8String() ?? `slot${i}`;
      const boneOfSlot = data.bones[r.varint()]?.name ?? 'root';
      const slot = createSlot(name, boneOfSlot);
      slot.color = r.color8888();
      const darkInt = r.int32();
      slot.dark = darkInt === -1 ? null : (darkInt >>> 0).toString(16).padStart(8, '0').slice(0, 6);
      slot.attachment = sr.ref();
      slot.blend = BLEND_MODES[r.varint()] ?? 'normal';
      data.slots.push(slot);
    }

    const boneName = (idx: number) => data.bones[idx]?.name ?? 'root';
    const slotName = (idx: number) => data.slots[idx]?.name ?? '';

    const ikCount = r.varint();
    for (let i = 0; i < ikCount; i++) {
      const name = r.utf8String() ?? `ik${i}`;
      const order = r.varint();
      const skinRequired = r.boolean();
      const nBones = r.varint();
      const bones = Array.from({ length: nBones }, () => boneName(r.varint()));
      const target = boneName(r.varint());
      const mix = r.float32();
      const softness = r.float32();
      const bend = r.byte();
      data.ik.push({
        name,
        order,
        skinRequired,
        bones,
        target,
        mix,
        softness,
        bendPositive: bend === 1,
        compress: r.boolean(),
        stretch: r.boolean(),
        uniform: r.boolean(),
      });
    }

    const tcCount = r.varint();
    for (let i = 0; i < tcCount; i++) {
      const name = r.utf8String() ?? `tc${i}`;
      const order = r.varint();
      const skinRequired = r.boolean();
      const nBones = r.varint();
      const bones = Array.from({ length: nBones }, () => boneName(r.varint()));
      const target = boneName(r.varint());
      const local = r.boolean();
      const relative = r.boolean();
      data.transform.push({
        name,
        order,
        skinRequired,
        bones,
        target,
        local,
        relative,
        rotation: r.float32(),
        x: r.float32(),
        y: r.float32(),
        scaleX: r.float32(),
        scaleY: r.float32(),
        shearY: r.float32(),
        mixRotate: r.float32(),
        mixX: r.float32(),
        mixY: r.float32(),
        mixScaleX: r.float32(),
        mixScaleY: r.float32(),
        mixShearY: r.float32(),
      });
    }

    const pcCount = r.varint();
    for (let i = 0; i < pcCount; i++) {
      const name = r.utf8String() ?? `pc${i}`;
      const order = r.varint();
      const skin = r.boolean();
      const nBones = r.varint();
      const bones = Array.from({ length: nBones }, () => boneName(r.varint()));
      const target = slotName(r.varint());
      const pc: SkeletonData['path'][number] = { name, bones, target };
      if (order !== 0) pc.order = order;
      if (skin) pc.skin = skin;
      const positionMode = POSITION_MODES[r.varint()] ?? 'percent';
      if (positionMode !== 'percent') pc.positionMode = positionMode;
      const spacingMode = SPACING_MODES[r.varint()] ?? 'length';
      if (spacingMode !== 'length') pc.spacingMode = spacingMode;
      const rotateMode = ROTATE_MODES[r.varint()] ?? 'tangent';
      if (rotateMode !== 'tangent') pc.rotateMode = rotateMode;
      const rotation = r.float32();
      if (rotation !== 0) pc.rotation = rotation;
      const position = r.float32();
      if (position !== 0) pc.position = position;
      const spacing = r.float32();
      if (spacing !== 0) pc.spacing = spacing;
      const mixRotate = r.float32();
      if (mixRotate !== 1) pc.mixRotate = mixRotate;
      const mixX = r.float32();
      if (mixX !== 1) pc.mixX = mixX;
      const mixY = r.float32();
      if (mixY !== (pc.mixX ?? 1)) pc.mixY = mixY;
      data.path.push(pc);
    }

    const phCount = r.varint();
    for (let i = 0; i < phCount; i++) {
      const name = r.utf8String() ?? `ph${i}`;
      const order = r.varint();
      const skin = r.boolean();
      const bone = boneName(r.varint());
      const ph: SkeletonData['physics'][number] = { name, bone };
      if (order !== 0) ph.order = order;
      if (skin) ph.skin = skin;
      const numeric: [
        key:
          | 'x'
          | 'y'
          | 'rotate'
          | 'scaleX'
          | 'shearX'
          | 'limit'
          | 'fps'
          | 'inertia'
          | 'strength'
          | 'damping'
          | 'mass'
          | 'wind'
          | 'gravity'
          | 'mix',
        dflt: number,
      ][] = [
        ['x', 0],
        ['y', 0],
        ['rotate', 0],
        ['scaleX', 0],
        ['shearX', 0],
        ['limit', 5000],
        ['fps', 60],
        ['inertia', 1],
        ['strength', 100],
        ['damping', 1],
        ['mass', 1],
        ['wind', 0],
        ['gravity', 0],
        ['mix', 1],
      ];
      for (const [key, dflt] of numeric) {
        const v = r.float32();
        if (v !== dflt) ph[key] = v;
      }
      const flags: (
        | 'inertiaGlobal'
        | 'strengthGlobal'
        | 'dampingGlobal'
        | 'massGlobal'
        | 'windGlobal'
        | 'gravityGlobal'
      )[] = [
        'inertiaGlobal',
        'strengthGlobal',
        'dampingGlobal',
        'massGlobal',
        'windGlobal',
        'gravityGlobal',
      ];
      for (const key of flags) {
        const v = r.boolean();
        if (v) ph[key] = true;
      }
      data.physics.push(ph);
    }

    readSkins(sr, data);
    readEvents(sr, data);
    readAnimations(sr, data);
  } catch (err) {
    issues.push({
      severity: 'error',
      path: 'skel',
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return { data, issues };
}

function readSkins(sr: SkelReader, data: SkeletonData): void {
  const defaultSkin: SpineSkin = { name: 'default' };
  readSkinBody(sr, data, defaultSkin);
  data.skins.push(defaultSkin);
  const named = sr.r.varint();
  for (let i = 0; i < named; i++) {
    const skin: SpineSkin = { name: sr.r.utf8String() ?? `skin${i}` };
    readSkinBody(sr, data, skin);
    data.skins.push(skin);
  }
}

function readSkinBody(sr: SkelReader, data: SkeletonData, skin: SpineSkin): void {
  const r = sr.r;
  const slotEntries = r.varint();
  for (let s = 0; s < slotEntries; s++) {
    const slotName = data.slots[r.varint()]?.name ?? '';
    const attCount = r.varint();
    for (let a = 0; a < attCount; a++) {
      const placeholder = sr.ref() ?? 'attachment';
      const att = readAttachment(sr, data);
      skin.attachments ??= {};
      (skin.attachments[slotName] ??= {})[placeholder] = att;
    }
  }
}

function readAttachment(sr: SkelReader, data: SkeletonData): SpineAttachment {
  const r = sr.r;
  const name = sr.ref();
  const type = ATTACHMENT_TYPES[r.byte()] ?? 'region';
  switch (type) {
    case 'region': {
      const a: SpineAttachment = { type: 'region' };
      if (name) a.name = name;
      const path = sr.ref();
      if (path) a.path = path;
      const rotation = r.float32();
      if (rotation !== 0) a.rotation = rotation;
      const x = r.float32();
      if (x !== 0) a.x = x;
      const y = r.float32();
      if (y !== 0) a.y = y;
      const scaleX = r.float32();
      if (scaleX !== 1) a.scaleX = scaleX;
      const scaleY = r.float32();
      if (scaleY !== 1) a.scaleY = scaleY;
      const width = r.float32();
      if (width !== 0) a.width = width;
      const height = r.float32();
      if (height !== 0) a.height = height;
      const color = r.color8888();
      if (color !== 'ffffffff') a.color = color;
      const seq = readSequence(r);
      if (seq) a.sequence = seq;
      return a;
    }
    case 'boundingbox': {
      const { vertices, vertexCount } = readVertices(r);
      const a: SpineAttachment = { type: 'boundingbox', vertexCount, vertices };
      if (name) (a as { name?: string }).name = name;
      const color = r.color8888();
      if (color !== '60f000ff') a.color = color;
      return a;
    }
    case 'mesh': {
      const path = sr.ref();
      const color = r.color8888();
      const vertexCount = r.varint();
      const uvs: number[] = [];
      for (let i = 0; i < vertexCount * 2; i++) uvs.push(r.float32());
      const triCount = r.varint();
      const triangles: number[] = [];
      for (let i = 0; i < triCount; i++) triangles.push(r.varint());
      const { vertices } = readVertices(r);
      const a: SpineAttachment = { type: 'mesh', uvs, triangles, vertices };
      if (name) a.name = name;
      if (path) a.path = path;
      if (color !== 'ffffffff') a.color = color;
      const hull = r.varint();
      if (hull !== 0) a.hull = hull;
      const seq = readSequence(r);
      if (seq) a.sequence = seq;
      const edgeCount = r.varint();
      if (edgeCount > 0) {
        a.edges = [];
        for (let i = 0; i < edgeCount; i++) a.edges.push(r.varint());
      }
      const width = r.float32();
      if (width !== 0) a.width = width;
      const height = r.float32();
      if (height !== 0) a.height = height;
      return a;
    }
    case 'linkedmesh': {
      const path = sr.ref();
      const color = r.color8888();
      const skinName = sr.ref();
      const parent = sr.ref() ?? '';
      const timelines = r.boolean();
      const a: SpineAttachment = { type: 'linkedmesh', parent };
      if (name) a.name = name;
      if (path) a.path = path;
      if (color !== 'ffffffff') a.color = color;
      if (skinName) a.skin = skinName;
      if (!timelines) a.timelines = false;
      const width = r.float32();
      if (width !== 0) a.width = width;
      const height = r.float32();
      if (height !== 0) a.height = height;
      return a;
    }
    case 'path': {
      const closed = r.boolean();
      const constantSpeed = r.boolean();
      const { vertices, vertexCount } = readVertices(r);
      const lengths: number[] = [];
      for (let i = 0; i < vertexCount / 3; i++) lengths.push(r.float32());
      const a: SpineAttachment = { type: 'path', vertexCount, vertices, lengths };
      if (name) (a as { name?: string }).name = name;
      if (closed) a.closed = true;
      if (!constantSpeed) a.constantSpeed = false;
      const color = r.color8888();
      if (color !== 'ff7f00ff') a.color = color;
      return a;
    }
    case 'point': {
      const a: SpineAttachment = { type: 'point' };
      if (name) (a as { name?: string }).name = name;
      const rotation = r.float32();
      if (rotation !== 0) a.rotation = rotation;
      const x = r.float32();
      if (x !== 0) a.x = x;
      const y = r.float32();
      if (y !== 0) a.y = y;
      const color = r.color8888();
      if (color !== 'f1f100ff') a.color = color;
      return a;
    }
    case 'clipping': {
      const end = sr.ref() ?? '';
      const { vertices, vertexCount } = readVertices(r);
      const a: SpineAttachment = { type: 'clipping', end, vertexCount, vertices };
      if (name) (a as { name?: string }).name = name;
      const color = r.color8888();
      if (color !== 'ce3a3aff') a.color = color;
      return a;
    }
  }
  void data;
  return { type: 'region' };
}

function readEvents(sr: SkelReader, data: SkeletonData): void {
  const r = sr.r;
  const count = r.varint();
  for (let i = 0; i < count; i++) {
    const name = r.utf8String() ?? `event${i}`;
    const def: SkeletonData['events'][string] = {};
    const int = r.varint(false);
    if (int !== 0) def.int = int;
    const f = r.float32();
    if (f !== 0) def.float = f;
    const s = r.utf8String();
    if (s !== null && s !== '') def.string = s;
    const audio = r.utf8String();
    if (audio) {
      def.audio = audio;
      const volume = r.float32();
      if (volume !== 1) def.volume = volume;
      const balance = r.float32();
      if (balance !== 0) def.balance = balance;
    }
    data.events[name] = def;
  }
}

function readAnimations(sr: SkelReader, data: SkeletonData): void {
  const r = sr.r;
  const count = r.varint();
  for (let i = 0; i < count; i++) {
    const name = r.utf8String() ?? `anim${i}`;
    data.animations[name] = readAnimation(sr, data);
  }
}

function readAnimation(sr: SkelReader, data: SkeletonData): SpineAnimation {
  const r = sr.r;
  const anim: SpineAnimation = {};
  const slotName = (idx: number) => data.slots[idx]?.name ?? '';
  const boneName = (idx: number) => data.bones[idx]?.name ?? '';

  // Slots.
  const slotEntries = r.varint();
  for (let s = 0; s < slotEntries; s++) {
    const slot = slotName(r.varint());
    const tlCount = r.varint();
    const tl: NonNullable<SpineAnimation['slots']>[string] = {};
    for (let t = 0; t < tlCount; t++) {
      const type = SLOT_TIMELINES[r.byte()];
      switch (type) {
        case 'attachment': {
          const frameCount = r.varint();
          const keys: SpineAttachmentKey[] = [];
          for (let f = 0; f < frameCount; f++) {
            const k: SpineAttachmentKey = { name: null };
            const time = r.float32();
            if (time !== 0) k.time = time;
            k.name = sr.ref();
            keys.push(k);
          }
          tl.attachment = keys;
          break;
        }
        case 'rgba':
        case 'rgb': {
          const keys = readFrames<SpineColorKey>(
            r,
            type === 'rgba' ? 4 : 3,
            () => ({}),
            (k) => {
              const color = r.color8888();
              k.color = type === 'rgba' ? color : color.slice(0, 6);
            },
          );
          if (type === 'rgba') tl.rgba = keys;
          else tl.rgb = keys;
          break;
        }
        case 'alpha': {
          tl.alpha = readFrames<SpineValueKey>(
            r,
            1,
            () => ({}),
            (k) => {
              const v = r.float32();
              if (v !== 1) (k as { value?: number }).value = v;
            },
          );
          break;
        }
        case 'rgba2':
        case 'rgb2': {
          const keys = readFrames<SpineTwoColorKey>(
            r,
            type === 'rgba2' ? 7 : 6,
            () => ({}),
            (k) => {
              const light = r.color8888();
              k.light = type === 'rgba2' ? light : light.slice(0, 6);
              k.dark = r.color8888().slice(0, 6);
            },
          );
          if (type === 'rgba2') tl.rgba2 = keys;
          else tl.rgb2 = keys;
          break;
        }
      }
    }
    (anim.slots ??= {})[slot] = tl;
  }

  // Bones.
  const boneEntries = r.varint();
  for (let b = 0; b < boneEntries; b++) {
    const bone = boneName(r.varint());
    const tlCount = r.varint();
    const tl: NonNullable<SpineAnimation['bones']>[string] = {};
    for (let t = 0; t < tlCount; t++) {
      const type = BONE_TIMELINES[r.byte()]!;
      const twoValue = type === 'translate' || type === 'scale' || type === 'shear';
      const keys = readFrames<SpineBoneKey>(
        r,
        twoValue ? 2 : 1,
        () => ({}),
        (k) => {
          if (twoValue) {
            const dflt = type === 'scale' ? 1 : 0;
            const x = r.float32();
            if (x !== dflt) k.x = x;
            const y = r.float32();
            if (y !== dflt) k.y = y;
          } else {
            const dflt = type === 'scalex' || type === 'scaley' ? 1 : 0;
            const v = r.float32();
            if (v !== dflt) k.value = v;
          }
        },
      );
      tl[type] = keys;
    }
    (anim.bones ??= {})[bone] = tl;
  }

  // IK.
  const ikEntries = r.varint();
  for (let i = 0; i < ikEntries; i++) {
    const name = data.ik[r.varint()]?.name ?? '';
    const keys = readFrames<SpineIkKey>(
      r,
      2,
      () => ({}),
      (k) => {
        const mix = r.float32();
        if (mix !== 1) k.mix = mix;
        const softness = r.float32();
        if (softness !== 0) k.softness = softness;
        const bend = r.byte();
        if (bend !== 1) k.bendPositive = false;
        const compress = r.boolean();
        if (compress) k.compress = true;
        const stretch = r.boolean();
        if (stretch) k.stretch = true;
      },
    );
    (anim.ik ??= {})[name] = keys;
  }

  // Transform.
  const tcEntries = r.varint();
  for (let i = 0; i < tcEntries; i++) {
    const name = data.transform[r.varint()]?.name ?? '';
    const keys = readFrames<SpineTransformKey>(
      r,
      6,
      () => ({}),
      (k) => {
        const mixRotate = r.float32();
        if (mixRotate !== 1) k.mixRotate = mixRotate;
        const mixX = r.float32();
        if (mixX !== 1) k.mixX = mixX;
        const mixY = r.float32();
        if (mixY !== (k.mixX ?? 1)) k.mixY = mixY;
        const mixScaleX = r.float32();
        if (mixScaleX !== 1) k.mixScaleX = mixScaleX;
        const mixScaleY = r.float32();
        if (mixScaleY !== (k.mixScaleX ?? 1)) k.mixScaleY = mixScaleY;
        const mixShearY = r.float32();
        if (mixShearY !== 1) k.mixShearY = mixShearY;
      },
    );
    (anim.transform ??= {})[name] = keys;
  }

  // Path.
  const pcEntries = r.varint();
  for (let i = 0; i < pcEntries; i++) {
    const name = data.path[r.varint()]?.name ?? '';
    const tlCount = r.varint();
    const tl: NonNullable<SpineAnimation['path']>[string] = {};
    for (let t = 0; t < tlCount; t++) {
      const type = PATH_TIMELINES[r.byte()]!;
      if (type === 'mix') {
        tl.mix = readFrames<SpinePathMixKey>(
          r,
          3,
          () => ({}),
          (k) => {
            const mixRotate = r.float32();
            if (mixRotate !== 1) k.mixRotate = mixRotate;
            const mixX = r.float32();
            if (mixX !== 1) k.mixX = mixX;
            const mixY = r.float32();
            if (mixY !== (k.mixX ?? 1)) k.mixY = mixY;
          },
        );
      } else {
        const keys = readFrames<SpineValueKey>(
          r,
          1,
          () => ({}),
          (k) => {
            const v = r.float32();
            if (v !== 0) (k as { value?: number }).value = v;
          },
        );
        if (type === 'position') tl.position = keys;
        else tl.spacing = keys;
      }
    }
    (anim.path ??= {})[name] = tl;
  }

  // Physics [dialect].
  const phEntries = r.varint();
  for (let i = 0; i < phEntries; i++) {
    const name = data.physics[r.varint()]?.name ?? '';
    const tlCount = r.varint();
    const tl: NonNullable<SpineAnimation['physics']>[string] = {};
    for (let t = 0; t < tlCount; t++) {
      const type = PHYSICS_TIMELINES[r.byte()]!;
      if (type === 'reset') {
        const frameCount = r.varint();
        const keys: { time?: number }[] = [];
        for (let f = 0; f < frameCount; f++) {
          const time = r.float32();
          keys.push(time !== 0 ? { time } : {});
        }
        tl.reset = keys;
      } else {
        tl[type] = readFrames<SpineValueKey>(
          r,
          1,
          () => ({}),
          (k) => {
            const v = r.float32();
            if (v !== 0) (k as { value?: number }).value = v;
          },
        );
      }
    }
    (anim.physics ??= {})[name] = tl;
  }

  // Deform (attachments).
  const skinEntries = r.varint();
  for (let s = 0; s < skinEntries; s++) {
    const skinName = r.utf8String() ?? 'default';
    const slotCount = r.varint();
    for (let sl = 0; sl < slotCount; sl++) {
      const slot = slotName(r.varint());
      const attCount = r.varint();
      for (let a = 0; a < attCount; a++) {
        const attName = sr.ref() ?? '';
        const keys = readFrames<SpineDeformKey>(
          r,
          1,
          () => ({}),
          (k) => {
            const end = r.varint();
            if (end > 0) {
              const offset = r.varint();
              if (offset !== 0) k.offset = offset;
              const verts: number[] = [];
              for (let v = 0; v < end; v++) verts.push(r.float32());
              k.vertices = verts;
            }
          },
        );
        anim.attachments ??= {};
        anim.attachments[skinName] ??= {};
        anim.attachments[skinName]![slot] ??= {};
        anim.attachments[skinName]![slot]![attName] = { deform: keys };
      }
    }
  }

  // Draw order.
  const doCount = r.varint();
  if (doCount > 0) {
    const keys: SpineDrawOrderKey[] = [];
    for (let f = 0; f < doCount; f++) {
      const k: SpineDrawOrderKey = {};
      const time = r.float32();
      if (time !== 0) k.time = time;
      const offsetCount = r.varint();
      if (offsetCount > 0) {
        k.offsets = [];
        for (let o = 0; o < offsetCount; o++) {
          k.offsets.push({ slot: slotName(r.varint()), offset: r.varint(false) });
        }
      }
      keys.push(k);
    }
    anim.drawOrder = keys;
  }

  // Events.
  const evCount = r.varint();
  if (evCount > 0) {
    const eventNames = Object.keys(data.events);
    const keys: SpineEventKey[] = [];
    for (let f = 0; f < evCount; f++) {
      const time = r.float32();
      const name = eventNames[r.varint()] ?? '';
      const k: SpineEventKey = { name };
      if (time !== 0) k.time = time;
      const int = r.varint(false);
      if (int !== 0) k.int = int;
      const fl = r.float32();
      if (fl !== 0) k.float = fl;
      if (r.boolean()) k.string = r.utf8String() ?? '';
      const def = data.events[name];
      if (def?.audio) {
        const volume = r.float32();
        if (volume !== (def.volume ?? 1)) k.volume = volume;
        const balance = r.float32();
        if (balance !== (def.balance ?? 0)) k.balance = balance;
      }
      keys.push(k);
    }
    anim.events = keys;
  }

  return anim;
}
