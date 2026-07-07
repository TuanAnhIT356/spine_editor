/**
 * PixiJS scene renderer for the editor viewport. Renders in Spine's Y-up
 * coordinate space via a Y-flipping camera matrix; sprites get an extra local
 * Y-flip so image content stays upright.
 */

import {
  applyMat,
  computeSetupPose,
  mulMat,
  type BoneData,
  type Mat2D,
  type SkeletonData,
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
  Texture,
} from 'pixi.js';
import type { ImageAsset, Selection } from '../state/store.js';

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
  assets: Record<string, ImageAsset>;
  selection: Selection;
}

function tintOf(color: string): { tint: number; alpha: number } {
  const rgb = parseInt(color.slice(0, 6), 16);
  const alpha = color.length >= 8 ? parseInt(color.slice(6, 8), 16) / 255 : 1;
  return { tint: Number.isNaN(rgb) ? 0xffffff : rgb, alpha: Number.isNaN(alpha) ? 1 : alpha };
}

const DEG_RAD = Math.PI / 180;
const FLIP_Y: Mat2D = { a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0 };

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

/** Finds an attachment for a slot, preferring the "default" skin. */
export function resolveAttachment(data: SkeletonData, slotName: string, attachmentName: string) {
  const skins = [...data.skins].sort((a, b) =>
    a.name === 'default' ? -1 : b.name === 'default' ? 1 : 0,
  );
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
  private spriteLayer = new Container();
  private boneLayer = new Graphics();
  private sprites = new Map<string, Sprite>();
  private meshes = new Map<string, MeshSimple>();
  private textures = new Map<string, Texture>();
  private lastPose = new Map<string, Mat2D>();
  private disposed = false;

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
    this.world.addChild(this.grid, this.spriteLayer, this.boneLayer);
    this.app.stage.addChild(this.world);
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

  zoomAt(sx: number, sy: number, factor: number): void {
    const w = this.screenToWorld(sx, sy);
    this.zoom = Math.min(20, Math.max(0.05, this.zoom * factor));
    this.offsetX = sx - w.x * this.zoom;
    this.offsetY = sy + w.y * this.zoom;
    this.applyCamera();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.offsetX) / this.zoom, y: (this.offsetY - sy) / this.zoom };
  }

  getBoneWorld(name: string): Mat2D | undefined {
    return this.lastPose.get(name);
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
    const data = input.bonesOverride ? { ...input.data, bones: input.bonesOverride } : input.data;
    const pose = computeSetupPose(data);
    this.lastPose = pose;

    await Promise.all(Object.values(input.assets).map((a) => this.ensureTexture(a)));
    if (!this.ready) return;

    this.spriteLayer.removeChildren();
    for (const slot of data.slots) {
      const attachmentName = input.slotAttachments?.has(slot.name)
        ? input.slotAttachments.get(slot.name)
        : slot.attachment;
      if (!attachmentName) continue;
      const att = resolveAttachment(data, slot.name, attachmentName);
      if (!att) continue;
      const boneWorld = pose.get(slot.bone);
      if (!boneWorld) continue;

      const animColor = input.slotColors?.get(slot.name) ?? slot.color;
      const { tint, alpha } = tintOf(animColor);

      if (att.type === 'mesh') {
        const asset = input.assets[att.path ?? attachmentName];
        const texture = asset ? this.textures.get(asset.name) : undefined;
        if (!texture) continue;
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
        this.spriteLayer.addChild(mesh);
        continue;
      }

      if (att.type !== undefined && att.type !== 'region') continue;
      const region = att as SpineRegionAttachment;
      const asset = input.assets[region.path ?? attachmentName];
      if (!asset) continue;
      const texture = this.textures.get(asset.name);
      if (!texture) continue;

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
      sprite.alpha =
        alpha * (input.selection?.kind === 'slot' && input.selection.name === slot.name ? 1 : 0.95);
      this.spriteLayer.addChild(sprite);
    }

    this.drawBones(data.bones, pose, input.selection);
  }

  private drawBones(bones: BoneData[], pose: Map<string, Mat2D>, selection: Selection): void {
    const g = this.boneLayer;
    g.clear();
    for (const bone of bones) {
      const m = pose.get(bone.name);
      if (!m) continue;
      const selected = selection?.kind === 'bone' && selection.name === bone.name;
      const color = selected ? 0xffa640 : 0x7fb2e5;
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
          alpha: selected ? 0.95 : 0.6,
        });
      }
      g.circle(ox, oy, (bone.parent === null ? 7 : 5) / this.zoom).fill({ color, alpha: 0.95 });
    }
  }
}
