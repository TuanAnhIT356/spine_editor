/**
 * Bridge operation handlers: everything the MCP server can ask the editor to
 * do. Each op drives the same zustand store + core commands as the UI, so AI
 * edits are undoable and identical to user edits.
 */

import {
  AddBone,
  AddIkConstraint,
  AddSlot,
  Composite,
  CreateAnimation,
  DeleteBoneKeyframe,
  DeleteDrawOrderKeyframe,
  DeleteEventKeyframe,
  RemoveAnimation,
  RemoveBone,
  AddSkinAttachment,
  RenameBone,
  ReorderSlot,
  ReparentBone,
  SetAttachmentVertices,
  SetBoneTransform,
  SetEventDef,
  SetSlotProperties,
  TransformBoneKeys,
  UpsertBoneKeyframe,
  UpsertDeformKeyframe,
  UpsertDrawOrderKeyframe,
  UpsertEventKeyframe,
  UpsertSlotAttachmentKeyframe,
  UpsertSlotColorKeyframe,
  autoWeightVertices,
  buildGridMeshAttachment,
  createBone,
  createEmptySkeleton,
  createSlot,
  getAnimationDuration,
  serializeSpineJson,
  type BoneKeyRef,
  type BoneTransformPatch,
  type SlotData,
  type SpineAttachmentKey,
  type SpineBoneKey,
  type SpineBoneTimelineName,
  type SpineJson,
} from '@spine-editor/core';
import { buildAtlas } from '../state/atlas.js';
import { primarySelection, uniqueName, useEditor, type ImageAsset } from '../state/store.js';
import { bridgeRuntime } from './runtime.js';

type Params = Record<string, unknown>;

function str(params: Params, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v === '') throw new Error(`Missing string param "${key}".`);
  return v;
}

function optNum(params: Params, key: string): number | undefined {
  const v = params[key];
  return typeof v === 'number' ? v : undefined;
}

function executeOrThrow(command: ConstructorParameters<typeof Object>[0]): void {
  // (typed loosely; the store surfaces command errors as exceptions here)
  const state = useEditor.getState();
  const before = state.error;
  const ok = state.execute(command as never);
  if (!ok) {
    const err = useEditor.getState().error ?? 'Command failed.';
    useEditor.getState().setError(before ?? null);
    throw new Error(err);
  }
}

function boneKeyFrom(params: Params): SpineBoneKey {
  const key: SpineBoneKey = {};
  const time = optNum(params, 'time');
  if (time !== undefined && time > 0) key.time = time;
  const value = optNum(params, 'value');
  if (value !== undefined) key.value = value;
  const x = optNum(params, 'x');
  if (x !== undefined) key.x = x;
  const y = optNum(params, 'y');
  if (y !== undefined) key.y = y;
  if (params['curve'] === 'stepped') key.curve = 'stepped';
  else if (Array.isArray(params['curve'])) key.curve = params['curve'] as number[];
  return key;
}

async function loadAssetFromDataUrl(name: string, dataUrl: string): Promise<ImageAsset> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { name, dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}

export async function dispatchOp(op: string, params: Params): Promise<unknown> {
  const state = () => useEditor.getState();
  switch (op) {
    case 'ping':
      return { ok: true };

    case 'get_project_state': {
      const s = state();
      return {
        mode: s.mode,
        selection: s.selection,
        currentAnimation: s.anim.current,
        time: s.anim.time,
        assets: Object.values(s.assets).map((a) => ({
          name: a.name,
          width: a.width,
          height: a.height,
        })),
        spine: s.doc.toJson(),
        issues: s.doc.validate(),
      };
    }

    case 'get_skeleton_tree': {
      const data = state().doc.data;
      return {
        bones: data.bones.map((b) => ({
          name: b.name,
          parent: b.parent,
          x: b.x,
          y: b.y,
          rotation: b.rotation,
          length: b.length,
        })),
        slots: data.slots.map((s, index) => ({
          name: s.name,
          bone: s.bone,
          attachment: s.attachment,
          drawOrder: index,
        })),
        ik: data.ik,
        animations: Object.keys(data.animations),
      };
    }

    case 'new_project': {
      state().replaceProject(serializeSpineJson(createEmptySkeleton()), []);
      return { ok: true };
    }

    case 'load_project': {
      const json = params['spine'] as SpineJson | undefined;
      if (!json) throw new Error('Missing "spine" param (Spine JSON object).');
      const issues = state().replaceProject(json, []);
      return { issues };
    }

    case 'set_mode': {
      const mode = str(params, 'mode');
      if (mode !== 'setup' && mode !== 'animate') throw new Error('mode must be setup|animate.');
      state().setMode(mode);
      return { ok: true };
    }

    case 'select': {
      const name = params['name'];
      const kind = params['kind'];
      if (name === null || name === undefined) state().select(null);
      else if ((kind === 'bone' || kind === 'slot') && typeof name === 'string') {
        state().select({ kind, name });
      } else throw new Error('Pass kind ("bone"|"slot") and name, or name: null to clear.');
      return { ok: true };
    }

    case 'add_bone': {
      const s = state();
      const parent = str(params, 'parent');
      const name =
        typeof params['name'] === 'string' && params['name'] !== ''
          ? (params['name'] as string)
          : uniqueName('bone', (n) => s.doc.data.bones.some((b) => b.name === n));
      const bone = createBone(name, parent, {
        x: optNum(params, 'x') ?? 0,
        y: optNum(params, 'y') ?? 0,
        rotation: optNum(params, 'rotation') ?? 0,
        length: optNum(params, 'length') ?? 0,
        scaleX: optNum(params, 'scaleX') ?? 1,
        scaleY: optNum(params, 'scaleY') ?? 1,
      });
      executeOrThrow(new AddBone(bone));
      s.select({ kind: 'bone', name });
      return { name };
    }

    case 'set_bone_transform': {
      const bone = str(params, 'bone');
      const patch: BoneTransformPatch = {};
      for (const key of [
        'x',
        'y',
        'rotation',
        'scaleX',
        'scaleY',
        'shearX',
        'shearY',
        'length',
      ] as const) {
        const v = optNum(params, key);
        if (v !== undefined) patch[key] = v;
      }
      executeOrThrow(new SetBoneTransform(bone, patch));
      return { ok: true };
    }

    case 'rename_bone':
      executeOrThrow(new RenameBone(str(params, 'from'), str(params, 'to')));
      return { ok: true };

    case 'remove_bone':
      executeOrThrow(new RemoveBone(str(params, 'name')));
      return { ok: true };

    case 'reparent_bone':
      executeOrThrow(new ReparentBone(str(params, 'bone'), str(params, 'parent')));
      return { ok: true };

    case 'import_image': {
      const asset = await loadAssetFromDataUrl(str(params, 'name'), str(params, 'dataUrl'));
      state().addAssets([asset]);
      return { name: asset.name, width: asset.width, height: asset.height };
    }

    case 'attach_image': {
      const s = state();
      const assetName = str(params, 'asset');
      if (!s.assets[assetName]) throw new Error(`Image "${assetName}" has not been imported.`);
      s.attachAsset(assetName, str(params, 'bone'));
      const err = useEditor.getState().error;
      if (err) throw new Error(err);
      const primary = primarySelection(useEditor.getState().selection);
      return { slot: primary?.kind === 'slot' ? primary.name : null };
    }

    case 'add_slot': {
      const slot: SlotData = createSlot(str(params, 'name'), str(params, 'bone'));
      if (typeof params['attachment'] === 'string') slot.attachment = params['attachment'];
      executeOrThrow(new AddSlot(slot));
      return { ok: true };
    }

    case 'set_slot_properties': {
      const patch: Partial<Omit<SlotData, 'name'>> = {};
      if (typeof params['bone'] === 'string') patch.bone = params['bone'];
      if (typeof params['color'] === 'string') patch.color = params['color'];
      if (typeof params['attachment'] === 'string' || params['attachment'] === null) {
        patch.attachment = params['attachment'] as string | null;
      }
      if (typeof params['blend'] === 'string') patch.blend = params['blend'] as SlotData['blend'];
      executeOrThrow(new SetSlotProperties(str(params, 'slot'), patch));
      return { ok: true };
    }

    case 'set_draw_order': {
      const index = optNum(params, 'index');
      if (index === undefined) throw new Error('Missing number param "index".');
      executeOrThrow(new ReorderSlot(str(params, 'slot'), index));
      return { ok: true };
    }

    case 'add_ik_constraint': {
      const bones = params['bones'];
      if (!Array.isArray(bones) || !bones.every((b) => typeof b === 'string')) {
        throw new Error('Param "bones" must be an array of bone names.');
      }
      executeOrThrow(
        new AddIkConstraint({
          name: str(params, 'name'),
          order: optNum(params, 'order') ?? 0,
          skinRequired: false,
          bones: bones as string[],
          target: str(params, 'target'),
          mix: optNum(params, 'mix') ?? 1,
          softness: optNum(params, 'softness') ?? 0,
          bendPositive: params['bendPositive'] !== false,
          compress: params['compress'] === true,
          stretch: params['stretch'] === true,
          uniform: params['uniform'] === true,
        }),
      );
      return { ok: true };
    }

    case 'create_animation': {
      const name = str(params, 'name');
      executeOrThrow(new CreateAnimation(name));
      state().setAnimation(name);
      state().setMode('animate');
      return { ok: true };
    }

    case 'remove_animation':
      executeOrThrow(new RemoveAnimation(str(params, 'name')));
      return { ok: true };

    case 'set_bone_keyframe': {
      const timeline = str(params, 'timeline') as SpineBoneTimelineName;
      executeOrThrow(
        new UpsertBoneKeyframe(
          str(params, 'animation'),
          str(params, 'bone'),
          timeline,
          boneKeyFrom(params),
        ),
      );
      return { ok: true };
    }

    case 'delete_bone_keyframe': {
      const time = optNum(params, 'time') ?? 0;
      executeOrThrow(
        new DeleteBoneKeyframe(
          str(params, 'animation'),
          str(params, 'bone'),
          str(params, 'timeline') as SpineBoneTimelineName,
          time,
        ),
      );
      return { ok: true };
    }

    case 'set_slot_attachment_keyframe': {
      const key: SpineAttachmentKey = { name: (params['attachment'] as string | null) ?? null };
      const time = optNum(params, 'time');
      if (time !== undefined && time > 0) key.time = time;
      executeOrThrow(
        new UpsertSlotAttachmentKeyframe(str(params, 'animation'), str(params, 'slot'), key),
      );
      return { ok: true };
    }

    case 'preview': {
      const s = state();
      const animation = typeof params['animation'] === 'string' ? params['animation'] : null;
      s.setMode('animate');
      if (animation) {
        if (!s.doc.data.animations[animation])
          throw new Error(`Animation "${animation}" does not exist.`);
        s.setAnimation(animation);
      }
      const time = optNum(params, 'time');
      if (time !== undefined) useEditor.getState().setAnimTime(time);
      const current = useEditor.getState().anim.current;
      const anim = current ? useEditor.getState().doc.getAnimation(current) : undefined;
      return {
        animation: current,
        time: useEditor.getState().anim.time,
        duration: anim ? getAnimationDuration(anim) : 0,
      };
    }

    case 'play': {
      const s = state();
      s.setMode('animate');
      if (typeof params['animation'] === 'string') s.setAnimation(params['animation']);
      if (typeof params['loop'] === 'boolean') s.setLoop(params['loop']);
      useEditor.getState().setPlaying(true);
      return { ok: true };
    }

    case 'stop':
      state().setPlaying(false);
      return { time: useEditor.getState().anim.time };

    case 'undo':
      state().undo();
      return { ok: true };

    case 'redo':
      state().redo();
      return { ok: true };

    case 'screenshot': {
      if (!bridgeRuntime.renderer || !bridgeRuntime.renderNow) {
        throw new Error('Viewport is not ready.');
      }
      await bridgeRuntime.renderNow();
      const dataUrl = await bridgeRuntime.renderer.screenshot();
      return { dataUrl };
    }

    case 'export_spine_json': {
      const s = state();
      return { json: s.doc.toJsonString(2), issues: s.doc.validate() };
    }

    case 'export_atlas': {
      const built = await buildAtlas(Object.values(state().assets), 'skeleton.png');
      return { atlasText: built.atlasText, pngDataUrl: built.pngDataUrl, pngName: 'skeleton.png' };
    }

    case 'set_event': {
      const def: Record<string, unknown> = {};
      for (const key of ['int', 'float', 'volume', 'balance'] as const) {
        const v = optNum(params, key);
        if (v !== undefined) def[key] = v;
      }
      if (typeof params['string'] === 'string') def['string'] = params['string'];
      if (typeof params['audio'] === 'string') def['audio'] = params['audio'];
      executeOrThrow(new SetEventDef(str(params, 'name'), def));
      return { ok: true };
    }

    case 'create_mesh': {
      // Converts a slot's current region attachment into a deformable grid mesh.
      const s = state();
      const slotName = str(params, 'slot');
      const slot = s.doc.findSlot(slotName);
      if (!slot?.attachment) throw new Error(`Slot "${slotName}" has no active attachment.`);
      const attName = slot.attachment;
      const existing = s.doc.data.skins.find((sk) => sk.name === 'default')?.attachments?.[
        slotName
      ]?.[attName];
      if (existing && existing.type !== undefined && existing.type !== 'region') {
        throw new Error(`Attachment "${attName}" is not a region attachment.`);
      }
      const asset = s.assets[(existing as { path?: string } | undefined)?.path ?? attName];
      const width =
        optNum(params, 'width') ??
        (existing as { width?: number } | undefined)?.width ??
        asset?.width;
      const height =
        optNum(params, 'height') ??
        (existing as { height?: number } | undefined)?.height ??
        asset?.height;
      if (!width || !height) throw new Error('Cannot determine mesh size; pass width/height.');
      const cols = Math.max(1, Math.round(optNum(params, 'cols') ?? 3));
      const rows = Math.max(1, Math.round(optNum(params, 'rows') ?? 3));
      const mesh = buildGridMeshAttachment(width, height, cols, rows);
      if ((existing as { path?: string } | undefined)?.path) {
        mesh.path = (existing as { path?: string }).path;
      }
      executeOrThrow(new AddSkinAttachment('default', slotName, attName, mesh, true));
      return { attachment: attName, vertices: mesh.vertices.length / 2, cols, rows };
    }

    case 'set_deform_keyframe': {
      const vertices = params['vertices'];
      if (!Array.isArray(vertices) || !vertices.every((v) => typeof v === 'number')) {
        throw new Error('Param "vertices" must be an array of numbers (x,y offsets).');
      }
      const key: Record<string, unknown> = { vertices };
      const time = optNum(params, 'time');
      if (time !== undefined && time > 0) key['time'] = time;
      const offset = optNum(params, 'offset');
      if (offset !== undefined && offset > 0) key['offset'] = offset;
      if (params['curve'] === 'stepped') key['curve'] = 'stepped';
      else if (Array.isArray(params['curve'])) key['curve'] = params['curve'];
      executeOrThrow(
        new UpsertDeformKeyframe(
          str(params, 'animation'),
          'default',
          str(params, 'slot'),
          str(params, 'attachment'),
          key,
        ),
      );
      return { ok: true };
    }

    case 'set_slot_color_keyframe': {
      const key: Record<string, unknown> = { color: str(params, 'color') };
      const time = optNum(params, 'time');
      if (time !== undefined && time > 0) key['time'] = time;
      if (params['curve'] === 'stepped') key['curve'] = 'stepped';
      else if (Array.isArray(params['curve'])) key['curve'] = params['curve'];
      executeOrThrow(
        new UpsertSlotColorKeyframe(
          str(params, 'animation'),
          str(params, 'slot'),
          key as { color: string },
        ),
      );
      return { ok: true };
    }

    case 'set_event_keyframe': {
      const key: Record<string, unknown> = { name: str(params, 'name') };
      const time = optNum(params, 'time');
      if (time !== undefined && time > 0) key['time'] = time;
      for (const k of ['int', 'float', 'volume', 'balance'] as const) {
        const v = optNum(params, k);
        if (v !== undefined) key[k] = v;
      }
      if (typeof params['string'] === 'string') key['string'] = params['string'];
      executeOrThrow(new UpsertEventKeyframe(str(params, 'animation'), key as { name: string }));
      return { ok: true };
    }

    case 'set_mesh_vertices': {
      const s = state();
      const slotName = str(params, 'slot');
      const vertices = params['vertices'];
      if (!Array.isArray(vertices) || !vertices.every((v) => typeof v === 'number')) {
        throw new Error('Param "vertices" must be an array of numbers.');
      }
      const attName =
        typeof params['attachment'] === 'string'
          ? params['attachment']
          : (s.doc.findSlot(slotName)?.attachment ?? undefined);
      if (!attName) throw new Error(`Slot "${slotName}" has no active attachment; pass one.`);
      executeOrThrow(new SetAttachmentVertices('default', slotName, attName, vertices));
      return { ok: true };
    }

    case 'bind_weights': {
      const s = state();
      const slotName = str(params, 'slot');
      const boneNames = params['bones'];
      if (!Array.isArray(boneNames) || !boneNames.every((b) => typeof b === 'string')) {
        throw new Error('Param "bones" must be an array of bone names.');
      }
      const attName =
        typeof params['attachment'] === 'string'
          ? params['attachment']
          : (s.doc.findSlot(slotName)?.attachment ?? undefined);
      if (!attName) throw new Error(`Slot "${slotName}" has no active attachment; pass one.`);
      const att = s.doc.data.skins.find((sk) => sk.name === 'default')?.attachments?.[slotName]?.[
        attName
      ];
      if (!att || att.type !== 'mesh') {
        throw new Error(`Attachment "${attName}" is not a mesh (create_mesh first).`);
      }
      if (att.vertices.length !== att.uvs.length) {
        throw new Error('Mesh is already weighted.');
      }
      const weighted = autoWeightVertices(
        s.doc.data,
        slotName,
        att.vertices,
        boneNames as string[],
      );
      executeOrThrow(new SetAttachmentVertices('default', slotName, attName, weighted));
      return { ok: true, influences: boneNames };
    }

    case 'add_clipping': {
      // Creates a clipping slot just before `slot` in the draw order, masking
      // everything from there until (and including) `end` (default: slot).
      const s = state();
      const slotName = str(params, 'slot');
      const target = s.doc.findSlot(slotName);
      if (!target) throw new Error(`Slot "${slotName}" does not exist.`);
      const slotIdx = s.doc.data.slots.findIndex((sl) => sl.name === slotName);
      const clipSlot = uniqueName(`${slotName}-clip`, (n) =>
        s.doc.data.slots.some((sl) => sl.name === n),
      );
      const vertices =
        Array.isArray(params['vertices']) &&
        params['vertices'].every((v: unknown) => typeof v === 'number') &&
        params['vertices'].length >= 6
          ? (params['vertices'] as number[])
          : [-50, -50, 50, -50, 50, 50, -50, 50];
      executeOrThrow(
        new Composite(`Add clipping slot "${clipSlot}"`, [
          new AddSlot(createSlot(clipSlot, target.bone)),
          new AddSkinAttachment('default', clipSlot, 'clip', {
            type: 'clipping',
            end: typeof params['end'] === 'string' ? params['end'] : slotName,
            vertexCount: vertices.length / 2,
            vertices,
          }),
          new SetSlotProperties(clipSlot, { attachment: 'clip' }),
          new ReorderSlot(clipSlot, slotIdx),
        ]),
      );
      return { slot: clipSlot };
    }

    case 'add_bounding_box': {
      const slotName = str(params, 'slot');
      const name =
        typeof params['name'] === 'string' && params['name'] !== ''
          ? params['name']
          : `${slotName}-bbox`;
      const vertices =
        Array.isArray(params['vertices']) &&
        params['vertices'].every((v: unknown) => typeof v === 'number') &&
        params['vertices'].length >= 6
          ? (params['vertices'] as number[])
          : [-40, -40, 40, -40, 40, 40, -40, 40];
      executeOrThrow(
        new AddSkinAttachment('default', slotName, name, {
          type: 'boundingbox',
          vertexCount: vertices.length / 2,
          vertices,
        }),
      );
      return { attachment: name };
    }

    case 'add_point': {
      const slotName = str(params, 'slot');
      const name =
        typeof params['name'] === 'string' && params['name'] !== ''
          ? params['name']
          : `${slotName}-point`;
      executeOrThrow(
        new AddSkinAttachment('default', slotName, name, {
          type: 'point',
          x: optNum(params, 'x') ?? 0,
          y: optNum(params, 'y') ?? 0,
          rotation: optNum(params, 'rotation') ?? 0,
        }),
      );
      return { attachment: name };
    }

    case 'set_playback_speed': {
      const speed = optNum(params, 'speed');
      if (speed === undefined) throw new Error('Missing number param "speed".');
      state().setSpeed(speed);
      return { speed: useEditor.getState().anim.speed };
    }

    case 'set_draw_order_keyframe': {
      const offsets = params['offsets'];
      if (
        !Array.isArray(offsets) ||
        !offsets.every(
          (o) =>
            typeof o === 'object' &&
            o !== null &&
            typeof (o as { slot?: unknown }).slot === 'string' &&
            typeof (o as { offset?: unknown }).offset === 'number',
        )
      ) {
        throw new Error('Param "offsets" must be an array of { slot, offset }.');
      }
      const key: { time?: number; offsets?: { slot: string; offset: number }[] } = {
        offsets: offsets as { slot: string; offset: number }[],
      };
      const time = optNum(params, 'time');
      if (time !== undefined && time > 0) key.time = time;
      executeOrThrow(new UpsertDrawOrderKeyframe(str(params, 'animation'), key));
      return { ok: true };
    }

    case 'delete_draw_order_keyframe':
      executeOrThrow(
        new DeleteDrawOrderKeyframe(str(params, 'animation'), optNum(params, 'time') ?? 0),
      );
      return { ok: true };

    case 'delete_event_keyframe':
      executeOrThrow(
        new DeleteEventKeyframe(
          str(params, 'animation'),
          str(params, 'name'),
          optNum(params, 'time') ?? 0,
        ),
      );
      return { ok: true };

    case 'shift_keys': {
      // Retimes bone keys: t' = pivot + (t - pivot) * scale + offset.
      const s = state();
      const animation = str(params, 'animation');
      const anim = s.doc.getAnimation(animation);
      if (!anim) throw new Error(`Animation "${animation}" does not exist.`);
      const boneFilter = typeof params['bone'] === 'string' ? params['bone'] : undefined;
      const timelineFilter =
        typeof params['timeline'] === 'string'
          ? (params['timeline'] as SpineBoneTimelineName)
          : undefined;
      const refs: BoneKeyRef[] = [];
      for (const [boneName, timelines] of Object.entries(anim.bones ?? {})) {
        if (boneFilter && boneName !== boneFilter) continue;
        for (const [tl, keys] of Object.entries(timelines)) {
          if (timelineFilter && tl !== timelineFilter) continue;
          for (const key of keys ?? []) {
            refs.push({
              bone: boneName,
              timeline: tl as SpineBoneTimelineName,
              time: key.time ?? 0,
            });
          }
        }
      }
      if (refs.length === 0) return { moved: 0 };
      executeOrThrow(
        new TransformBoneKeys(animation, refs, {
          offset: optNum(params, 'offset') ?? 0,
          scale: optNum(params, 'scale') ?? 1,
          pivot: optNum(params, 'pivot') ?? 0,
        }),
      );
      return { moved: refs.length };
    }

    case 'validate':
      return { issues: state().doc.validate() };

    default:
      throw new Error(`Unknown op "${op}".`);
  }
}
