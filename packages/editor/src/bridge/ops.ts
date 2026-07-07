/**
 * Bridge operation handlers: everything the MCP server can ask the editor to
 * do. Each op drives the same zustand store + core commands as the UI, so AI
 * edits are undoable and identical to user edits.
 */

import {
  AddBone,
  AddIkConstraint,
  AddSlot,
  CreateAnimation,
  DeleteBoneKeyframe,
  RemoveAnimation,
  RemoveBone,
  RenameBone,
  ReorderSlot,
  ReparentBone,
  SetBoneTransform,
  SetSlotProperties,
  UpsertBoneKeyframe,
  UpsertSlotAttachmentKeyframe,
  createBone,
  createEmptySkeleton,
  createSlot,
  getAnimationDuration,
  serializeSpineJson,
  type BoneTransformPatch,
  type SlotData,
  type SpineAttachmentKey,
  type SpineBoneKey,
  type SpineBoneTimelineName,
  type SpineJson,
} from '@spine-editor/core';
import { uniqueName, useEditor, type ImageAsset } from '../state/store.js';
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
      const selection = useEditor.getState().selection;
      return { slot: selection?.kind === 'slot' ? selection.name : null };
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

    case 'validate':
      return { issues: state().doc.validate() };

    default:
      throw new Error(`Unknown op "${op}".`);
  }
}
