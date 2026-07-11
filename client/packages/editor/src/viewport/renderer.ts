/**
 * PixiJS scene renderer for the editor viewport. Renders in Spine's Y-up
 * coordinate space via a Y-flipping camera matrix; sprites get an extra local
 * Y-flip so image content stays upright.
 */

import {
  applyMat,
  boneWeightPerVertex,
  computePose,
  computeVertexWorldPositions,
  mulMat,
  type BoneData,
  type Mat2D,
  type PathPoseValue,
  type SkeletonData,
  type SpineAttachment,
  type SpineMeshAttachment,
  type SpineRegionAttachment,
} from '@spine-editor/core';
import {
  Application,
  Container,
  Graphics,
  Matrix,
  MeshSimple,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import type { ImageAsset, Selection, ViewFilters } from '../state/store.js';

export interface RenderInput {
  data: SkeletonData;
  /** Replaces data.bones during tool drags (live preview without commands). */
  bonesOverride?: BoneData[];
  /** Animated slot attachment overrides (animate mode). */
  slotAttachments?: ReadonlyMap<string, string | null>;
  /** Animated slot rgba colors (animate mode). */
  slotColors?: ReadonlyMap<string, string>;
  /** Animated deform offsets per slot → attachment (animate mode). */
  deforms?: ReadonlyMap<string, ReadonlyMap<string, Float32Array>>;
  /** Slot names back-to-front when a draw order key is active (animate mode). */
  slotOrder?: string[];
  /** Onion-skin bone poses drawn faintly under the scene (animate mode). */
  ghosts?: { bones: BoneData[]; color: number; alpha?: number }[];
  /** Path-constraint timeline values at the playhead (animate mode). */
  pathOverrides?: ReadonlyMap<string, PathPoseValue>;
  /** Editor-only viewport hiding (tree visibility dots): skip drawing/picking. */
  hiddenBones?: Set<string>;
  hiddenSlots?: Set<string>;
  /** Skin used to resolve attachments (falls back to "default"). */
  activeSkin?: string;
  /** Attachment being vertex-edited: draws handles (and a weight heatmap). */
  editTarget?: {
    slot: string;
    attachment: string;
    /** Uncommitted vertices during a drag/paint stroke. */
    overrideVertices?: number[];
    /** Bone name whose weights color the handles blue→red. */
    weightBone?: string | null;
  };
  assets: Record<string, ImageAsset>;
  selection: Selection;
}

/** Vertex count for any vertex-based attachment, or null for other types. */
export function attachmentVertexCount(att: SpineAttachment): number | null {
  if (att.type === 'mesh') return att.uvs.length / 2;
  if (att.type === 'boundingbox' || att.type === 'clipping' || att.type === 'path') {
    return att.vertexCount;
  }
  return null;
}

function tintOf(color: string): { tint: number; alpha: number } {
  const rgb = parseInt(color.slice(0, 6), 16);
  const alpha = color.length >= 8 ? parseInt(color.slice(6, 8), 16) / 255 : 1;
  return { tint: Number.isNaN(rgb) ? 0xffffff : rgb, alpha: Number.isNaN(alpha) ? 1 : alpha };
}

const DEG_RAD = Math.PI / 180;
const FLIP_Y: Mat2D = { a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0 };

/** World rotation (degrees) of a matrix's +X axis. */
function rotationOf(m: Mat2D): number {
  return Math.atan2(m.c, m.a) / DEG_RAD;
}

function toPixiMatrix(m: Mat2D): Matrix {
  // Our convention: x' = a*x + b*y; Pixi's Matrix(a, b, c, d) uses x' = a*x + c*y.
  return new Matrix(m.a, m.c, m.b, m.d, m.tx, m.ty);
}

/**
 * World-space positions for a mesh attachment's vertices. Unweighted meshes
 * store x,y pairs in the slot bone's space; weighted meshes store
 * [boneCount, (boneIndex, x, y, weight)…] per vertex with indices into the
 * bones array.
 */
function meshWorldPositions(
  att: SpineMeshAttachment,
  boneWorld: Mat2D,
  bones: BoneData[],
  pose: Map<string, Mat2D>,
  deform?: Float32Array,
): Float32Array {
  const out = new Float32Array(att.uvs.length);
  const v = att.vertices;
  if (v.length === att.uvs.length) {
    for (let i = 0; i < v.length; i += 2) {
      const p = applyMat(
        boneWorld,
        (v[i] ?? 0) + (deform?.[i] ?? 0),
        (v[i + 1] ?? 0) + (deform?.[i + 1] ?? 0),
      );
      out[i] = p.x;
      out[i + 1] = p.y;
    }
    return out;
  }
  let vi = 0;
  let di = 0; // deform offsets cover the x,y of each bone influence
  for (let oi = 0; oi < out.length; oi += 2) {
    const count = v[vi++] ?? 0;
    let x = 0;
    let y = 0;
    for (let b = 0; b < count; b++) {
      const boneIdx = v[vi++] ?? 0;
      const bx = (v[vi++] ?? 0) + (deform?.[di] ?? 0);
      const by = (v[vi++] ?? 0) + (deform?.[di + 1] ?? 0);
      di += 2;
      const w = v[vi++] ?? 0;
      const m = pose.get(bones[boneIdx]?.name ?? '');
      if (!m) continue;
      const p = applyMat(m, bx, by);
      x += p.x * w;
      y += p.y * w;
    }
    out[oi] = x;
    out[oi + 1] = y;
  }
  return out;
}

/**
 * Finds an attachment for a slot: the active skin wins, then "default",
 * then any other skin (mirroring the runtime's skin + default-skin lookup).
 */
export function resolveAttachment(
  data: SkeletonData,
  slotName: string,
  attachmentName: string,
  activeSkin = 'default',
) {
  const rank = (name: string) => (name === activeSkin ? 0 : name === 'default' ? 1 : 2);
  const skins = [...data.skins].sort((a, b) => rank(a.name) - rank(b.name));
  for (const skin of skins) {
    const att = skin.attachments?.[slotName]?.[attachmentName];
    if (att) return att;
  }
  return undefined;
}

export class SceneRenderer {
  private app = new Application();
  private world = new Container();
  private grid = new Graphics();
  private ghostLayer = new Graphics();
  private spriteLayer = new Container();
  private boneLayer = new Graphics();
  private overlayLayer = new Graphics();
  /** Per-frame clip containers/masks destroyed at the start of the next render. */
  private clipGarbage: Container[] = [];
  private sprites = new Map<string, Sprite>();
  private meshes = new Map<string, MeshSimple>();
  private textures = new Map<string, Texture>();
  private lastPose = new Map<string, Mat2D>();
  private disposed = false;
  /** Name labels drawn in screen space (the world container is y-flipped). */
  private labelLayer = new Container();
  private labels = new Map<string, Text>();
  private viewFilters: ViewFilters | null = null;
  private hiddenBones: Set<string> | null = null;
  private hiddenSlots: Set<string> | null = null;

  ready = false;
  offsetX = 0;
  offsetY = 0;
  zoom = 1;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ background: 0x232327, antialias: true, resizeTo: host });
    if (this.disposed) {
      this.app.destroy(true, true);
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';
    this.world.addChild(
      this.grid,
      this.ghostLayer,
      this.spriteLayer,
      this.boneLayer,
      this.overlayLayer,
    );
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.labelLayer);
    this.offsetX = host.clientWidth / 2;
    this.offsetY = host.clientHeight * 0.75;
    this.drawGrid();
    this.applyCamera();
    this.ready = true;
  }

  destroy(): void {
    this.disposed = true;
    if (this.ready) this.app.destroy(true, true);
    this.ready = false;
  }

  private applyCamera(): void {
    this.world.setFromMatrix(new Matrix(this.zoom, 0, 0, -this.zoom, this.offsetX, this.offsetY));
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.applyCamera();
  }

  onZoomChange: ((zoom: number) => void) | null = null;

  zoomAt(sx: number, sy: number, factor: number): void {
    const w = this.screenToWorld(sx, sy);
    this.zoom = Math.min(20, Math.max(0.05, this.zoom * factor));
    this.offsetX = sx - w.x * this.zoom;
    this.offsetY = sy + w.y * this.zoom;
    this.applyCamera();
    this.onZoomChange?.(this.zoom);
  }

  /** Zooms around the viewport center (drives the zoom slider). */
  setZoomCenter(zoom: number): void {
    const clamped = Math.min(20, Math.max(0.05, zoom));
    this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, clamped / this.zoom);
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.offsetX) / this.zoom, y: (this.offsetY - sy) / this.zoom };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.zoom + this.offsetX, y: this.offsetY - wy * this.zoom };
  }

  getBoneWorld(name: string): Mat2D | undefined {
    return this.lastPose.get(name);
  }

  setViewFilters(f: ViewFilters): void {
    this.viewFilters = f;
  }

  /** PNG data URL of the current viewport (used by the MCP bridge). */
  async screenshot(): Promise<string> {
    if (!this.ready) throw new Error('Renderer not ready.');
    // Crop to the visible camera framing; without a frame, extract renders
    // the stage's full bounds (the entire world grid).
    const frame = new Rectangle(0, 0, this.app.renderer.width, this.app.renderer.height);
    return this.app.renderer.extract.base64({ target: this.app.stage, frame });
  }

  /** Nearest bone origin within pick radius (screen px), or null. */
  hitTest(sx: number, sy: number): string | null {
    const w = this.screenToWorld(sx, sy);
    let best: string | null = null;
    let bestDist = 12 / this.zoom;
    for (const [name, m] of this.lastPose) {
      if (this.hiddenBones?.has(name)) continue;
      const d = Math.hypot(m.tx - w.x, m.ty - w.y);
      if (d <= bestDist) {
        bestDist = d;
        best = name;
      }
    }
    return best;
  }

  private drawGrid(): void {
    const g = this.grid;
    const size = 2000;
    const step = 100;
    g.clear();
    for (let v = -size; v <= size; v += step) {
      if (v === 0) continue;
      g.moveTo(v, -size).lineTo(v, size);
      g.moveTo(-size, v).lineTo(size, v);
    }
    g.stroke({ width: 1, color: 0x36363c, pixelLine: true });
    g.moveTo(-size, 0).lineTo(size, 0).stroke({ width: 1, color: 0x6b4040, pixelLine: true });
    g.moveTo(0, -size).lineTo(0, size).stroke({ width: 1, color: 0x40604a, pixelLine: true });
  }

  private async ensureTexture(asset: ImageAsset): Promise<Texture> {
    const cached = this.textures.get(asset.name);
    if (cached) return cached;
    const img = new Image();
    img.src = asset.dataUrl;
    await img.decode();
    const texture = Texture.from(img);
    this.textures.set(asset.name, texture);
    return texture;
  }

  async render(input: RenderInput): Promise<void> {
    if (!this.ready) return;
    this.hiddenBones = input.hiddenBones ?? null;
    this.hiddenSlots = input.hiddenSlots ?? null;
    const data = input.bonesOverride ? { ...input.data, bones: input.bonesOverride } : input.data;
    const pose = computePose(data, undefined, undefined, input.pathOverrides);
    this.lastPose = pose;

    await Promise.all(Object.values(input.assets).map((a) => this.ensureTexture(a)));
    if (!this.ready) return;

    this.drawGhosts(data, input.ghosts);

    const slotsInOrder = input.slotOrder
      ? input.slotOrder
          .map((name) => data.slots.find((s) => s.name === name))
          .filter((s): s is (typeof data.slots)[number] => s !== undefined)
      : data.slots;

    this.spriteLayer.removeChildren();
    for (const junk of this.clipGarbage) junk.destroy({ children: false });
    this.clipGarbage = [];

    /** Sprites land here while a clipping attachment is active. */
    let clip: { end: string | undefined; container: Container } | null = null;
    const addDrawable = (child: Container) => {
      (clip ? clip.container : this.spriteLayer).addChild(child);
    };
    const endClipAfter = (slotName: string) => {
      if (clip && clip.end === slotName) clip = null;
    };

    for (const slot of slotsInOrder) {
      if (this.hiddenSlots?.has(slot.name)) {
        endClipAfter(slot.name);
        continue;
      }
      const attachmentName = input.slotAttachments?.has(slot.name)
        ? input.slotAttachments.get(slot.name)
        : slot.attachment;
      if (!attachmentName) {
        endClipAfter(slot.name);
        continue;
      }
      const att = resolveAttachment(data, slot.name, attachmentName, input.activeSkin);
      const boneWorld = pose.get(slot.bone);
      if (!att || !boneWorld) {
        endClipAfter(slot.name);
        continue;
      }

      if (att.type === 'clipping') {
        // Start clipping: subsequent slots render inside a masked container
        // until (and including) the end slot.
        const verts = computeVertexWorldPositions(
          att.vertices,
          att.vertexCount,
          boneWorld,
          data.bones,
          pose,
        );
        if (verts.length >= 6) {
          const mask = new Graphics().poly(Array.from(verts)).fill(0xffffff);
          const container = new Container();
          container.mask = mask;
          this.spriteLayer.addChild(container, mask);
          this.clipGarbage.push(container, mask);
          clip = { end: att.end, container };
        }
        continue;
      }

      const animColor = input.slotColors?.get(slot.name) ?? slot.color;
      const { tint, alpha } = tintOf(animColor);

      if (att.type === 'mesh') {
        // Region lookup order mirrors the runtime: path, then the attachment's
        // real name (skins often store "skinName/part"), then the placeholder.
        const asset = input.assets[att.path ?? att.name ?? attachmentName];
        const texture = asset ? this.textures.get(asset.name) : undefined;
        if (!texture) {
          endClipAfter(slot.name);
          continue;
        }
        const deform = input.deforms?.get(slot.name)?.get(attachmentName);
        const positions = meshWorldPositions(att, boneWorld, data.bones, pose, deform);
        let mesh = this.meshes.get(slot.name);
        if (!mesh || mesh.texture !== texture || mesh.vertices.length !== positions.length) {
          mesh?.destroy();
          mesh = new MeshSimple({
            texture,
            vertices: positions,
            uvs: new Float32Array(att.uvs),
            indices: new Uint32Array(att.triangles),
          });
          this.meshes.set(slot.name, mesh);
        } else {
          mesh.vertices = positions;
        }
        mesh.tint = tint;
        mesh.alpha = alpha;
        addDrawable(mesh);
        endClipAfter(slot.name);
        continue;
      }

      if (att.type !== undefined && att.type !== 'region') {
        endClipAfter(slot.name);
        continue;
      }
      const region = att as SpineRegionAttachment;
      const asset = input.assets[region.path ?? region.name ?? attachmentName];
      if (!asset) {
        endClipAfter(slot.name);
        continue;
      }
      const texture = this.textures.get(asset.name);
      if (!texture) {
        endClipAfter(slot.name);
        continue;
      }

      let sprite = this.sprites.get(slot.name);
      if (!sprite) {
        sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        this.sprites.set(slot.name, sprite);
      }
      if (sprite.texture !== texture) sprite.texture = texture;

      const rot = (region.rotation ?? 0) * DEG_RAD;
      const sx = (region.scaleX ?? 1) * ((region.width ?? asset.width) / asset.width);
      const sy = (region.scaleY ?? 1) * ((region.height ?? asset.height) / asset.height);
      const local: Mat2D = {
        a: Math.cos(rot) * sx,
        b: -Math.sin(rot) * sy,
        c: Math.sin(rot) * sx,
        d: Math.cos(rot) * sy,
        tx: region.x ?? 0,
        ty: region.y ?? 0,
      };
      sprite.setFromMatrix(toPixiMatrix(mulMat(mulMat(boneWorld, local), FLIP_Y)));
      sprite.tint = tint;
      const slotIsSelected = input.selection.some((s) => s.kind === 'slot' && s.name === slot.name);
      sprite.alpha = alpha * (slotIsSelected ? 1 : 0.9);
      addDrawable(sprite);
      endClipAfter(slot.name);
    }

    this.spriteLayer.visible = this.viewFilters?.images.visible !== false;
    this.boneLayer.visible = this.viewFilters?.bones.visible !== false;
    this.overlayLayer.visible = this.viewFilters?.others.visible !== false;
    this.drawBones(data.bones, pose, input.selection);
    this.drawOverlays(data, pose, input);
    this.updateLabels(data, pose);
  }

  /** Screen-space name tags for bones/attachments, driven by the filter matrix. */
  private updateLabels(data: SkeletonData, pose: Map<string, Mat2D>): void {
    const seen = new Set<string>();
    const put = (id: string, text: string, wx: number, wy: number, dy: number) => {
      let t = this.labels.get(id);
      if (!t) {
        t = new Text({ text, style: { fontSize: 11, fill: 0xd8d8d8 } });
        this.labels.set(id, t);
        this.labelLayer.addChild(t);
      }
      if (t.text !== text) t.text = text;
      const s = this.worldToScreen(wx, wy);
      t.position.set(s.x + 8, s.y + dy);
      seen.add(id);
    };
    if (this.viewFilters?.bones.labels) {
      for (const b of data.bones) {
        if (this.hiddenBones?.has(b.name)) continue;
        const m = pose.get(b.name);
        if (m) put(`bone:${b.name}`, b.name, m.tx, m.ty, -18);
      }
    }
    if (this.viewFilters?.images.labels) {
      for (const s of data.slots) {
        if (!s.attachment || this.hiddenSlots?.has(s.name)) continue;
        const m = pose.get(s.bone);
        if (m) put(`slot:${s.name}`, s.attachment, m.tx, m.ty, 6);
      }
    }
    for (const [id, t] of this.labels) {
      if (!seen.has(id)) {
        t.destroy();
        this.labels.delete(id);
      }
    }
  }

  /**
   * Outlines for non-drawable attachments (clipping red, bounding box cyan,
   * point magenta) plus vertex handles for the attachment being edited —
   * colored blue→red by bone weight when a heatmap bone is set.
   */
  private drawOverlays(data: SkeletonData, pose: Map<string, Mat2D>, input: RenderInput): void {
    const g = this.overlayLayer;
    g.clear();
    for (const slot of data.slots) {
      const boneWorld = pose.get(slot.bone);
      if (!boneWorld) continue;
      const bySlot = data.skins.find((s) => s.name === 'default')?.attachments?.[slot.name] ?? {};
      for (const [name, att] of Object.entries(bySlot)) {
        const isActive = slot.attachment === name;
        if (att.type === 'point') {
          const p = applyMat(boneWorld, att.x ?? 0, att.y ?? 0);
          const r = 8 / this.zoom;
          const rot = (((att.rotation ?? 0) + rotationOf(boneWorld)) * Math.PI) / 180;
          g.moveTo(p.x - r, p.y)
            .lineTo(p.x + r, p.y)
            .moveTo(p.x, p.y - r)
            .lineTo(p.x, p.y + r)
            .stroke({ width: 1.5 / this.zoom, color: 0xcc66cc, alpha: 0.9 });
          g.moveTo(p.x, p.y)
            .lineTo(p.x + Math.cos(rot) * r * 2, p.y + Math.sin(rot) * r * 2)
            .stroke({ width: 1.5 / this.zoom, color: 0xcc66cc, alpha: 0.9 });
          continue;
        }
        if (att.type === 'path') {
          const verts = computeVertexWorldPositions(
            att.vertices,
            att.vertexCount,
            boneWorld,
            data.bones,
            pose,
          );
          this.drawPathSpline(verts, att.closed ?? false, isActive);
          continue;
        }
        if (att.type !== 'boundingbox' && att.type !== 'clipping') continue;
        const verts = computeVertexWorldPositions(
          att.vertices,
          att.vertexCount,
          boneWorld,
          data.bones,
          pose,
        );
        if (verts.length < 4) continue;
        const color = att.type === 'clipping' ? 0xe06c6c : 0x6cc9c9;
        g.poly(Array.from(verts)).stroke({
          width: 1.5 / this.zoom,
          color,
          alpha: isActive ? 0.95 : 0.45,
        });
      }
    }

    const edit = input.editTarget;
    if (!edit) return;
    const slot = data.slots.find((s) => s.name === edit.slot);
    const att = slot
      ? data.skins.find((s) => s.name === 'default')?.attachments?.[edit.slot]?.[edit.attachment]
      : undefined;
    const boneWorld = slot ? pose.get(slot.bone) : undefined;
    if (!slot || !att || !boneWorld) return;
    const count = attachmentVertexCount(att);
    if (count === null) return;
    const vertices = edit.overrideVertices ?? (att as { vertices: number[] }).vertices;
    const deform =
      att.type === 'mesh' ? input.deforms?.get(edit.slot)?.get(edit.attachment) : undefined;
    const positions = computeVertexWorldPositions(
      vertices,
      count,
      boneWorld,
      data.bones,
      pose,
      deform,
    );
    let weights: Float32Array | null = null;
    if (edit.weightBone) {
      const boneIndex = data.bones.findIndex((b) => b.name === edit.weightBone);
      if (boneIndex >= 0) weights = boneWeightPerVertex(vertices, count, boneIndex);
    }
    for (let v = 0; v < count; v++) {
      const x = positions[v * 2]!;
      const y = positions[v * 2 + 1]!;
      let color = 0xffffff;
      if (weights) {
        const w = weights[v]!;
        color =
          (Math.round(w * 255) << 16) | (Math.round((1 - w) * 96) << 8) | Math.round((1 - w) * 255);
      }
      g.circle(x, y, 4.5 / this.zoom)
        .fill({ color, alpha: 0.95 })
        .stroke({ width: 1 / this.zoom, color: 0x1b1b1f, alpha: 0.9 });
    }
  }

  /** Faint skeleton outlines for onion skinning (bones only, cheap to draw). */
  private drawGhosts(data: SkeletonData, ghosts: RenderInput['ghosts']): void {
    const g = this.ghostLayer;
    g.clear();
    if (!ghosts?.length) return;
    for (const ghost of ghosts) {
      const alpha = ghost.alpha ?? 0.35;
      const pose = computePose({ ...data, bones: ghost.bones });
      for (const bone of ghost.bones) {
        const m = pose.get(bone.name);
        if (!m) continue;
        if (bone.length > 0) {
          const tip = applyMat(m, bone.length, 0);
          g.moveTo(m.tx, m.ty)
            .lineTo(tip.x, tip.y)
            .stroke({ width: 2 / this.zoom, color: ghost.color, alpha });
        }
        g.circle(m.tx, m.ty, 3 / this.zoom).fill({ color: ghost.color, alpha });
      }
    }
  }

  /**
   * Composite bezier curve of a path attachment: anchors as squares, handles
   * as dots with stems. Vertex layout per point: in-handle, anchor, out-handle.
   */
  private drawPathSpline(verts: Float32Array, closed: boolean, isActive: boolean): void {
    const g = this.overlayLayer;
    const points = Math.floor(verts.length / 6);
    if (points < 2) return;
    const alpha = isActive ? 0.95 : 0.5;
    const color = 0xe0a86c;
    const anchor = (i: number) => ({ x: verts[i * 6 + 2]!, y: verts[i * 6 + 3]! });
    const inH = (i: number) => ({ x: verts[i * 6]!, y: verts[i * 6 + 1]! });
    const outH = (i: number) => ({ x: verts[i * 6 + 4]!, y: verts[i * 6 + 5]! });
    const segCount = closed ? points : points - 1;
    for (let i = 0; i < segCount; i++) {
      const a = anchor(i);
      const b = anchor((i + 1) % points);
      const c1 = outH(i);
      const c2 = inH((i + 1) % points);
      g.moveTo(a.x, a.y)
        .bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y)
        .stroke({ width: 2 / this.zoom, color, alpha });
    }
    for (let i = 0; i < points; i++) {
      const a = anchor(i);
      for (const h of [inH(i), outH(i)]) {
        g.moveTo(a.x, a.y)
          .lineTo(h.x, h.y)
          .stroke({ width: 1 / this.zoom, color, alpha: alpha * 0.5 });
        g.circle(h.x, h.y, 2.5 / this.zoom).fill({ color, alpha: alpha * 0.7 });
      }
      const r = 4 / this.zoom;
      g.rect(a.x - r, a.y - r, r * 2, r * 2).fill({ color, alpha });
    }
  }

  private drawBones(bones: BoneData[], pose: Map<string, Mat2D>, selection: Selection): void {
    const g = this.boneLayer;
    g.clear();
    for (const bone of bones) {
      if (this.hiddenBones?.has(bone.name)) continue;
      const m = pose.get(bone.name);
      if (!m) continue;
      const selected = selection.some((s) => s.kind === 'bone' && s.name === bone.name);
      const color = selected ? 0xffcc33 : 0x7fb2e5;
      const ox = m.tx;
      const oy = m.ty;
      if (bone.length > 0) {
        const tip = applyMat(m, bone.length, 0);
        const dx = tip.x - ox;
        const dy = tip.y - oy;
        const len = Math.hypot(dx, dy) || 1;
        const w = Math.min(len * 0.15, 8 / this.zoom);
        const nx = (-dy / len) * w;
        const ny = (dx / len) * w;
        g.poly([ox + nx, oy + ny, tip.x, tip.y, ox - nx, oy - ny]).fill({
          color,
          alpha: selected ? 1 : 0.6,
        });
      }
      const radius = (bone.parent === null ? 7 : 5) / this.zoom;
      if (selected) {
        // Bright outer ring makes the selection pop even at low zoom.
        g.circle(ox, oy, radius + 3 / this.zoom).stroke({
          width: 2 / this.zoom,
          color: 0xfff2c9,
          alpha: 0.95,
        });
      }
      g.circle(ox, oy, radius).fill({ color, alpha: 0.95 });
    }
  }
}
