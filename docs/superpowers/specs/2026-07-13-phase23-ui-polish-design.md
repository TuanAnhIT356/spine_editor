# Phase 23 — UI polish theo tham chiếu Spine gốc (design)

Ngày: 2026-07-13 · Nhánh: `claude/phase23-ui-polish` · Trạng thái: đã duyệt design, chờ review spec

## 1. Mục tiêu

Sau khi roadmap §8 (Spine parity, phase 15-22) hoàn tất, đối chiếu 9 ảnh chụp
Spine gốc do user cung cấp để polish 6 hạng mục UI:

1. Tree panel: expand/collapse theo node.
2. Bone: màu theo `bone.color`, tỷ lệ hình dạng khớp tham chiếu, màu chọn đổi
   sang xanh dương (khớp màu chọn của tree/panel).
3. Slot/attachment: khung bounding-box xanh dương khi chọn (thay vì chỉ đổi
   alpha như hiện tại); hover trong tree hiện thumbnail ảnh.
4. Viewport toolbar: nút bật/tắt thước đo (ruler) + nút Center (fit-to-content).
5. **Gizmo tương tác** Rotate/Translate/Scale/Shear tại gốc bone/attachment
   đang chọn — tay cầm theo trục (đỏ=X, xanh lá=Y) hit-test riêng, áp dụng cho
   cả bone và slot/attachment.
6. Tree section icons hiện có (Constraints/Skins/Events/Animations/Images/
   Audio) — xác nhận giữ nguyên, không redesign.

Quyết định đã chốt qua brainstorming: 1 PR duy nhất; gizmo tương tác đầy đủ
(không chỉ decorative) cho cả bone lẫn slot/attachment; tree mặc định expand
hết + lưu trạng thái collapse vào localStorage; ruler có vạch số world-unit;
Center = fit-to-content (không phải reset pan về gốc tọa độ).

## 2. Ngoài scope (YAGNI)

- Redesign icon cho Constraints/Skins/Events/Animations/Images/Audio — bộ
  icon hand-drawn hiện có (`icons.tsx`) giữ nguyên.
- Gizmo cho path/IK/transform/physics constraint hoặc multi-attachment cùng
  lúc (chỉ bone + 1 attachment đang active của slot được chọn).
- Đổi cơ chế resize width/height của region/mesh qua kéo góc khung bounding
  box — khung chỉ để hiển thị đang chọn gì, không phải resize handle.
- Ruler đơn vị khác world-unit (không thêm inch/cm).
- Đổi hành vi Shift-constrain hiện có của translate (giữ nguyên, gizmo tận
  dụng cùng logic trục).

## 3. Tree panel — expand/collapse

- `state/store.ts` thêm `collapsedNodes: Set<string>` (khởi tạo rỗng =
  expand-hết) + action `toggleCollapsed(id: string)`. Key node: `bone:${name}`,
  `slot:${slotName}`, `att:${slotName}/${attName}`.
- Persist: `localStorage['spine-editor.treeCollapsed']` = JSON array of ids,
  load khi tạo store (giống pattern `settings` ở Phase 21), ghi lại mỗi lần
  `toggleCollapsed`.
- `components/tree/TreeRows.tsx`:
  - `BoneRow` (hiện đệ quy vô điều kiện vào `children`, dòng ~241-243): nếu
    node có con (bone con, hoặc slot/attachment thuộc bone đó) → render
    chevron (icon mới `ChevronIcon` trong `icons.tsx`, xoay 90° theo trạng
    thái) trước tên; click chevron → `toggleCollapsed(id)`, không đổi
    selection. Node collapsed → không render subtree (return sớm sau chevron).
  - `AttachmentRows` tương tự cho slot có ≥1 attachment.
  - Leaf node (không con) → giữ nguyên, không có chevron (dot cố định như cũ).
- Test: `toggleCollapsed` ẩn/hiện đúng subtree; persist qua remount store
  (đọc lại localStorage).

## 4. Bone rendering — màu + hình dạng + selection

`viewport/renderer.ts`, `drawBones()` (743-778):

- Màu mặc định (unselected): đọc `bone.color` (hex `RRGGBBAA` hoặc
  `RRGGBB`), parse giống `boneTint()` hiện có trong `TreeRows.tsx` (fallback
  `0x7fb2e5` khi bone không có `color` — **không** dùng fallback vàng của tree
  vì đó là để phân biệt icon, còn đây là màu mặc định khi không set).
- Màu khi chọn: đổi từ `0xffcc33` (+ vòng `0xfff2c9`) sang **`0x3875b7`**
  (đúng hex của `--accent` trong `styles.css`) — bỏ luôn vòng viền phụ, dùng
  cùng 1 màu cho thân + gốc bone khi chọn, khớp màu chọn của tree row.
- Tỷ lệ dart: giữ kiểu tam giác thon một phía từ gốc (không đổi sang hình
  thoi đối xứng) + vòng tròn gốc — chỉnh lại hằng số bề rộng gốc/tỷ lệ thon
  cho khớp ảnh tham chiếu (tinh chỉnh bằng mắt, không phải giá trị chốt cứng
  trong spec này; task review so sánh trực quan qua e2e screenshot).

## 5. Slot/attachment selection box + hover preview

### 5.1. Selection box (`drawOverlays()`, renderer.ts ~544-593)

- Khi `selection` chứa `{kind:'slot', name}` và slot đó có attachment đang
  active (`slot.attachment === name`) với hình dạng có thể đo bounds (region:
  từ `width`/`height`/`x`/`y`/`rotation`/`scaleX`/`scaleY`; mesh/boundingbox/
  clipping/path: từ `vertices` qua `computeVertexWorldPositions` đã có) → vẽ
  khung chữ nhật (region) hoặc convex hull bounds (vertex-based) viền màu
  `0x3875b7`, width 1.5/zoom, alpha 0.9 — **thay** cho cách hiện tại (chỉ tăng
  alpha sprite 1.0 vs 0.9).
- Point attachment: khung box nhỏ quanh điểm (bán kính cố định màn hình, ví
  dụ 10px/zoom) thay vì chỉ 2 gạch chữ thập màu tím hiện có khi đang chọn
  (giữ màu tím khi KHÔNG chọn).
- Không đổi overlay của attachment không active/không chọn (giữ màu theo
  loại: clipping đỏ, bbox cyan, path cam như hiện tại).

### 5.2. Hover preview (`components/tree/HoverPreview.tsx`, mới)

- `TreeRows.tsx`: `AttachmentRows`/slot row nào có `att.path`/asset ảnh gắn
  thêm `onMouseEnter={() => setHovered({id, x, y})}` /
  `onMouseLeave={() => setHovered(null)}` — state hover sống ở `TreePanel.tsx`
  (useState, không vào global store vì thuần UI-transient).
- `HoverPreview`: `position: fixed`, đặt cạnh phải row hover (dùng
  `getBoundingClientRect()` của row), hiện `<img>` từ
  `assets[attachmentPathOrName]?.dataUrl` (asset đã load sẵn trong store),
  max 96×96 (object-fit: contain), khung nền tối + viền nhẹ, tên asset +
  kích thước gốc bên dưới ảnh. Asset không tồn tại (path không khớp asset
  nào) → không render (không có ảnh để hiện).
- Không debounce cần thiết (chỉ 1 phần tử, chi phí render thấp).

## 6. Viewport toolbar — ruler + Center (fit-to-content)

### 6.1. Ruler toggle

- `state/store.ts`: `showRulers: boolean` (default `false`), action
  `setShowRulers`, persist trong `spine-editor.settings` (thêm field, giống
  `fps`/`autosave`/`welcome` ở Phase 21 — không phải file riêng).
- `components/ZoomControl.tsx`: thêm icon-button (icon mới `RulerIcon`)
  trước slider, toggle `showRulers`, class `active` khi bật (pattern giống
  `.icon-btn` ở Toolbar).
- `viewport/renderer.ts`: hàm mới `drawRulers()` cạnh `drawGrid()` (315-328)
  — 2 dải screen-space cố định (top cao ~18px, left rộng ~18px), vẽ tick mỗi
  N world-units (chọn N theo zoom sao cho khoảng cách pixel giữa tick ~50-100px,
  công thức tương tự bước nhảy của `drawGrid`), số label world-unit tại mỗi
  tick lớn. Chỉ vẽ khi `input.showRulers` true (thêm field vào `RenderInput`).

### 6.2. Center (fit-to-content)

- File mới `viewport/bounds.ts`: `computeSkeletonBounds(data: SkeletonData,
pose: Map<string, Mat2D>): { minX, minY, maxX, maxY } | null` — duyệt mọi
  bone (điểm gốc + điểm mũi theo `length`) và mọi attachment có bounds (dùng
  lại `computeVertexWorldPositions` cho vertex-based, hoặc 4 góc theo
  width/height/x/y/rotation/scale cho region) đang hiển thị (tôn trọng
  `viewFilters` ẩn/hiện hiện có); trả `null` nếu rỗng (skeleton trống →
  no-op khi bấm Center).
- `SceneRenderer` (renderer.ts): method mới `frameBounds(bounds, canvasW,
canvasH, padding = 0.1)` — tính zoom = min(canvasW/(w×(1+padding×2)),
  canvasH/(h×(1+padding×2))), pan để tâm bounds trùng tâm canvas; dùng lại
  setter zoom/pan nội bộ đã có cho slider.
- `components/ZoomControl.tsx`: nút icon mới (icon 4 góc, `FrameIcon`) gọi
  `renderer.frameBounds(computeSkeletonBounds(doc.data, currentPose), ...)`
  qua callback truyền từ `Viewport.tsx` (renderer instance sống ở đó).

## 7. Gizmo tương tác — Rotate / Translate / Scale / Shear

### 7.1. Kiến trúc chung

File mới `viewport/gizmo.ts` — module thuần logic, không phụ thuộc React,
dùng chung bởi `renderer.ts` (vẽ tay cầm) và `Viewport.tsx` (hit-test +
tính delta khi kéo):

```ts
export interface GizmoFrame {
  origin: { x: number; y: number }; // world-space, điểm gốc gizmo
  axisX: { x: number; y: number }; // unit vector, world-space
  axisY: { x: number; y: number };
}

export function computeFrame(
  axesMode: 'local' | 'parent' | 'world',
  originWorld: Mat2D, // world matrix của bone, hoặc bone∘attachment-local cho attachment
  parentWorld: Mat2D | undefined,
): GizmoFrame;

export type GizmoHandle =
  | { tool: 'rotate' }
  | { tool: 'translate' | 'scale'; axis: 'x' | 'y' }
  | { tool: 'shear'; axis: 'x' | 'y' };

/** Trả tay cầm trúng con trỏ trong bán kính ngưỡng (screen-space), null nếu không trúng cái nào. */
export function hitTestHandles(
  tool: 'rotate' | 'translate' | 'scale' | 'shear',
  frame: GizmoFrame,
  screenOrigin: { x: number; y: number },
  screenAxisX: { x: number; y: number }, // hướng axisX đã chiếu ra màn hình, độ dài = kích thước tay cầm (px)
  screenAxisY: { x: number; y: number },
  pointerScreen: { x: number; y: number },
  thresholdPx: number,
): GizmoHandle | null;

/** Chiếu delta chuột (world-space dx/dy) lên 1 trục cụ thể của frame — dùng khi kéo trúng 1 tay cầm. */
export function projectOntoAxis(
  dx: number,
  dy: number,
  axis: { x: number; y: number },
): { x: number; y: number };
```

`computeFrame` tái dùng đúng công thức đã có ở `Viewport.tsx` dòng 677-703
(Shift-constrain translate): `local` → world-matrix của chính bone/target;
`parent` → world-matrix của bone cha; `world` → trục màn hình
`{x:1,y:0}`/`{x:0,y:1}`. Với attachment, `originWorld` = world-matrix của
slot's bone nhân với ma trận local x/y/rotation/scaleX/scaleY của attachment.

### 7.2. Hình dạng tay cầm theo tool (vẽ trong `renderer.ts`, method mới `drawGizmo()`)

| Tool      | Hình dạng                                                                                     | Màu                      |
| --------- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| Rotate    | Vòng tròn bán kính cố định screen-space (~28px/zoom) quanh gốc                                  | đỏ `0xe0524a`            |
| Translate | 2 đoạn thẳng có đầu mũi tên dọc `axisX` (đỏ) và `axisY` (xanh lá), dài ~40px/zoom từ gốc         | đỏ `0xe0524a` / xanh lá `0x5ac25a` |
| Scale     | Giống Translate nhưng đầu mút là ô vuông nhỏ (6×6px) thay vì mũi tên                            | như trên                 |
| Shear     | 1 đoạn dọc `axisY` đầu mũi tên (xanh lá) + 1 đoạn ngang `axisX` lệch góc nhẹ theo giá trị shear hiện tại của bone (đỏ) | như trên                 |

Chỉ vẽ khi có đúng 1 primary selection (`primarySelection()` đã có) thuộc
kind `bone` hoặc `slot` (với attachment active), VÀ `state.tool` khớp 1
trong 4 loại trên (không vẽ khi tool = `select`/`create`).

**Attachment nào có gizmo**: trong data model chỉ `region` có đủ 5 field
`x/y/rotation/scaleX/scaleY`; `point` chỉ có `x/y/rotation` (không scale);
`mesh`/`linkedmesh`/`boundingbox`/`clipping`/`path` **không có** field
transform riêng nào (hình dạng định bởi `vertices`, sửa qua vertex-edit đã
có từ Phase 8/19, không qua gizmo này). Vậy: chọn slot có attachment active
là `region` → hiện đủ 4 tool; là `point` → chỉ hiện Rotate + Translate (Scale/
Shear không vẽ tay cầm, tool click vẫn chọn được nhưng không có gì để kéo);
loại khác → không vẽ gizmo attachment nào (giữ nguyên overlay theo loại hiện tại).

### 7.3. Hit-test ưu tiên trong `Viewport.tsx onPointerDown`

Trong nhánh `switch (state.tool)` case `'translate'|'rotate'|'scale'|'shear'`
(dòng ~529-611 hiện tại), TRƯỚC bước `hit = r.hitTest(...)` (bone-body,
dòng 506) — nếu đã có `primary` selection hợp lệ (bone hoặc slot+attachment)
cho đúng tool đang active, gọi `hitTestHandles(...)`:

- Trúng handle → set `dragRef.current` variant mới `{ kind: 'gizmo', handle,
frame, target }` (target = bone name hoặc `{slot, attachment}`); `onPointerMove`
  dùng `projectOntoAxis` để tính delta CHỈ theo trục của handle (rotate: vẫn
  full free — góc quanh gốc, không đổi so với logic rotate hiện có ngoại trừ
  origin lấy theo frame).
- Không trúng handle nào → rơi về code cũ nguyên vẹn (`hit = r.hitTest(...)`
  rồi drag tự do như hiện tại) — 0 thay đổi hành vi khi không dùng gizmo.
- Multi-selection: `frame`/gizmo vẽ tại `primary`, nhưng khi kéo áp dụng lên
  toàn bộ `activeBones` (transform) hoặc chỉ 1 attachment (attachment không
  hỗ trợ multi-select theo model hiện tại — 1 slot selection = 1 attachment).

`onPointerUp`: nhánh `gizmo` commit qua đúng command hiện có
(`TransformBoneKeys`/direct field set như translate/rotate/scale/shear ngày
nay dùng, xem `baseLocals()`/`overrideRef` pattern) cho bone; **command mới**
cho attachment (§7.4). Không đổi cách Setup/Animate mode quyết định
key-hay-không (Auto Key, transient pose) — chỉ đường tính delta đổi.

### 7.4. Command mới cho attachment — `SetAttachmentTransform`

`packages/core/src/commands/structure.ts` (cạnh `SetAttachmentVertices`):

```ts
export class SetAttachmentTransform implements Command {
  readonly label: string;
  private before: SpineSkin | undefined;

  constructor(
    private readonly skinName: string,
    private readonly slotName: string,
    private readonly attachmentName: string,
    private readonly patch: {
      x?: number;
      y?: number;
      rotation?: number;
      scaleX?: number;
      scaleY?: number;
    },
  ) {
    this.label = `Transform attachment "${attachmentName}"`;
  }

  // region: x/y/rotation/scaleX/scaleY all settable. point: x/y/rotation only
  // (no scale field in the format). Every other type has no transform field
  // at all — shape comes from `vertices`, edited via the existing vertex tools.
  private static readonly ALLOWED: Record<string, readonly string[]> = {
    region: ['x', 'y', 'rotation', 'scaleX', 'scaleY'],
    point: ['x', 'y', 'rotation'],
  };

  execute(data: SkeletonData): void {
    const skin = data.skins.find((s) => s.name === this.skinName);
    if (!skin) throw new Error(`Skin "${this.skinName}" does not exist.`);
    const att = skin.attachments?.[this.slotName]?.[this.attachmentName];
    if (!att) {
      throw new Error(
        `Attachment "${this.attachmentName}" does not exist on slot "${this.slotName}" in skin "${this.skinName}".`,
      );
    }
    const allowed = SetAttachmentTransform.ALLOWED[att.type ?? 'region'];
    if (!allowed) throw new Error(`Attachment type "${att.type}" has no transform fields.`);
    for (const key of Object.keys(this.patch)) {
      if (!allowed.includes(key)) {
        throw new Error(`Attachment type "${att.type ?? 'region'}" has no "${key}" field.`);
      }
    }
    this.before = structuredClone(skin);
    Object.assign(att, this.patch);
  }

  undo(data: SkeletonData): void {
    if (!this.before) return;
    const idx = data.skins.findIndex((s) => s.name === this.skinName);
    if (idx >= 0) data.skins[idx] = this.before;
  }
}
```

- Chỉ `region` (đủ 5 field) và `point` (`x/y/rotation`, không scale) được
  set; field không hợp lệ cho type đó → throw theo bảng `ALLOWED` ở trên —
  khớp UI layer (7.2) không vẽ gizmo/không gọi command với field type không
  hỗ trợ.
- Export `SetAttachmentTransform` từ `packages/core/src/index.ts`.
- Test: execute set patch đúng field (region đủ 5, point 3) + giữ field
  khác; undo khôi phục; throw đúng khi skin/slot/attachment không tồn tại,
  type không có transform field nào (mesh/linkedmesh/boundingbox/clipping/
  path), hoặc field hợp lệ cho type khác nhưng không hợp lệ cho type này
  (vd `scaleX` trên `point`).

## 8. File thay đổi / mới

**Mới:**

- `client/packages/editor/src/viewport/gizmo.ts`
- `client/packages/editor/src/viewport/bounds.ts`
- `client/packages/editor/src/components/tree/HoverPreview.tsx`

**Sửa:**

- `client/packages/core/src/commands/structure.ts` (thêm class `SetAttachmentTransform`)
- `client/packages/core/src/index.ts` (export command mới)
- `client/packages/editor/src/state/store.ts` (`collapsedNodes`, `toggleCollapsed`, `showRulers`/`setShowRulers` trong settings)
- `client/packages/editor/src/components/tree/TreeRows.tsx` (chevron, hover handlers)
- `client/packages/editor/src/components/TreePanel.tsx` (hover state, render `HoverPreview`)
- `client/packages/editor/src/components/icons.tsx` (`ChevronIcon`, `RulerIcon`, `FrameIcon`)
- `client/packages/editor/src/viewport/renderer.ts` (`drawBones` màu/tỷ lệ, `drawOverlays` khung chọn, `drawRulers`, `drawGizmo`, `frameBounds`, `RenderInput.showRulers`)
- `client/packages/editor/src/components/Viewport.tsx` (hit-test gizmo ưu tiên trong `onPointerDown`/`onPointerMove`/`onPointerUp`, wiring nút Center)
- `client/packages/editor/src/components/ZoomControl.tsx` (nút ruler + nút center)

## 9. Verify

- Core tests mới: `SetAttachmentTransform` (execute/undo/validate/throw ×
  loại không hỗ trợ), `computeSkeletonBounds` (bone-only, có attachment,
  rỗng → null).
- Editor: không có unit test cho renderer (đã vậy từ trước — canvas/WebGL);
  kiểm bằng e2e + thủ công qua verify skill.
- E2E battery (smoke/anim/bridge/chat + pytest) không đổi flow chức năng —
  chỉ cần xanh như hiện tại (`issues: []`, `toolCount: 65` không đổi vì phase
  này không thêm MCP tool).
- Thủ công qua verify skill: collapse/expand + reload giữ trạng thái; bone
  hiển thị đúng `bone.color`, chọn thấy xanh dương; chọn slot thấy khung xanh
  dương; hover slot trong tree thấy thumbnail; bật ruler thấy vạch số; bấm
  Center với skeleton lệch xa thấy zoom/pan về vừa khung; chọn bone + mỗi
  tool trong 4 tool thấy đúng tay cầm, kéo trúng tay cầm chỉ đổi 1 trục, kéo
  ngoài tay cầm vẫn tự do như cũ; chọn slot có region attachment lặp lại y
  hệt cho gizmo attachment; undo sau mỗi thao tác gizmo trả về đúng giá trị
  trước đó.
- Docs: CLAUDE.md thêm đoạn Phase 23 (UI polish); PLAN.md không có row phase
  này (ngoài roadmap §8 đã hoàn tất) — ghi 1 dòng ghi chú cuối §8 hoặc mục
  riêng "post-roadmap polish".

## 10. Rủi ro & xử lý

- **Gizmo hit-test tranh chấp với bone-body hit-test hiện có** — xử lý bằng
  thứ tự ưu tiên rõ ràng (handle trước, bone-body sau) nên không đổi hành vi
  cũ khi gizmo không hiện hoặc kéo ngoài tay cầm.
- **Chỉ `region`/`point` có transform field, các loại khác (mesh/linkedmesh/
  boundingbox/clipping/path) không có** — gizmo không vẽ cho các loại đó
  (kiểm tra type trước khi hiện), không throw ở UI layer; `SetAttachmentTransform`
  vẫn throw phòng hờ nếu gọi trực tiếp với type/field không hợp lệ.
- **`computeSkeletonBounds` với skeleton rỗng hoặc mọi bone/attachment đang
  ẩn qua `viewFilters`** — trả `null`, nút Center no-op (không zoom NaN/Infinity).
- **Tinh chỉnh tỷ lệ dart bone bằng mắt** — không có giá trị số chốt cứng
  trong spec; task tương ứng tự chọn hằng số hợp lý rồi chụp so sánh qua
  verify skill, chấp nhận sai số thị giác nhỏ.
- **`SetAttachmentTransform` dùng `structuredClone` cho toàn bộ skin** — có
  thể tốn hơn patch-field nếu skin lớn, nhưng khớp pattern đã có của
  `SetAttachmentVertices` (đơn giản, đúng, không tối ưu sớm).
