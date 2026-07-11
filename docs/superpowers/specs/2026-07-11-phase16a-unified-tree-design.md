# Spec: Phase 16a — Unified TreePanel + dock Bone/Slot

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: `packages/editor` (TreePanel mới thay HierarchyPanel + PropertiesPanel,
  store mở rộng selection + hidden state, renderer tôn trọng hidden). KHÔNG đụng core
  ngoài việc đọc (lệnh Set*ConstraintProperties thuộc 16b). Roadmap: PLAN.md §8
  Phase 16, chia 2 slice theo quyết định brainstorm.

## 1. Bối cảnh & mục tiêu

Sau Phase 15 (shell), khác biệt lớn nhất còn lại với Spine là cấu trúc panel: Spine có
MỘT tree hợp nhất bên phải (bones lồng slots/attachments + sections
Constraints/Skins/Events/Animations) và properties dock ở ĐÁY tree theo selection.
16a chuyển hẳn sang bố cục đó với dock đầy đủ cho Bone/Slot (di cư form cũ);
16b bổ sung form cho constraint/event/animation/skin + context menu + rename inline.

## 2. Layout & store

- `App.tsx`: `main = Viewport | Resizer | TreePanel` — XÓA render HierarchyPanel,
  PropertiesPanel và 2 Resizer cũ. TreePanel dùng `layout.propertiesWidth` hiện có
  (đổi tên getter không cần — giữ key layout cũ để localStorage không vỡ);
  `resizeProperties` giữ nguyên vai trò resize TreePanel.
- `panelVisibility` đổi key: `{ tree: boolean; timeline: boolean }` (bỏ
  hierarchy/properties). Views ▾ còn 2 mục: Tree, Timeline (timeline disabled ở
  setup như cũ). `togglePanel` nhận `'tree' | 'timeline'`.
- **Selection mở rộng**: `SelectionItem = { kind: 'bone' | 'slot' | 'ik' |
'transform' | 'path' | 'physics' | 'event' | 'animation'; name: string }`.
  Viewport/marquee/existing code chỉ tạo và lọc bone/slot — không đổi hành vi.
  `Delete/Backspace` shortcut chỉ xử lý bone/slot như cũ (kind khác bỏ qua ở 16a).
- **Hidden state (editor-only, session-only, KHÔNG xuất JSON)**:
  `hiddenBones: string[]`, `hiddenSlots: string[]` + `toggleBoneHidden(name)`,
  `toggleSlotHidden(name)`. Rename/remove bone/slot KHÔNG cần dọn danh sách (tên
  không khớp thì vô hại).

## 3. Renderer

- `RenderInput` thêm `hiddenBones?: Set<string>`, `hiddenSlots?: Set<string>`
  (Viewport truyền từ store).
- `drawBones`: bỏ qua gizmo của bone có tên trong hiddenBones (KHÔNG ảnh hưởng pose —
  chỉ không vẽ). Sprite/mesh của slot trong hiddenSlots: không vẽ (bỏ addDrawable).
  Labels cũng bỏ qua item ẩn. hitTest bỏ qua bone ẩn.

## 4. TreePanel (`components/TreePanel.tsx` + `components/tree/*`)

Cấu trúc file: `TreePanel.tsx` (khung + search + filter + dock host),
`tree/TreeRows.tsx` (cây + sections), `tree/dock/BoneDock.tsx`, `tree/dock/SlotDock.tsx`
(di cư từ PropertiesPanel), `tree/dock/InfoDock.tsx` (read-only cho kind khác).

- **Header**: ô search (tái dùng logic lọc theo tên của HierarchyPanel — match bone,
  slot; giữ placeholder cũ "Search bones/slots…"); hàng filter chip: `Slots`,
  `Attachments`, `Constraints` (bật mặc định) — tắt = ẩn loại đó khỏi CÂY
  (state cục bộ TreePanel, không vào store).
- **Cây**:
  - Hàng gốc: icon skeleton + tên project (từ `useServer.projectName` || 'untitled').
  - Bones đệ quy (indent 14px/depth): cột chấm visibility (●/○) → icon bone
    (SVG mới `BoneIcon`, `style={{color: bone.color ? '#'+bone.color.slice(0,6) : 'var(--warn)'}}`
    — BoneData.color dạng RGBA hex 8 ký tự) → tên. Click chọn (`clickSelect` cũ:
    shift/ctrl toggle multi), hàng selected nền `var(--accent-soft)`.
  - Slots lồng dưới bone chủ (icon `SlotIcon` + chấm visibility). Attachment lồng
    dưới slot: icon theo loại (region→`ImageIcon`, mesh→`MeshIcon`,
    boundingbox→`BBoxIcon`, point→`PointIcon`, clipping→`ClipIcon`, path→`PathIcon`)
    — loại đọc từ default skin; click chọn SLOT chứa nó (attachment không có
    selection kind riêng ở 16a).
  - Nút thứ tự draw-order (↑↓) của slot GIỮ (di cư từ HierarchyPanel, hiện khi hover).
  - **Drag-drop reparent bone GIỮ** (di cư nguyên cơ chế drag-drop của HierarchyPanel
    cũ sang hàng bone trong tree — hành vi và command ReparentBone không đổi).
- **Sections** (sau cây, tiêu đề kiểu `.panel-title` cũ):
  - `Constraints`: 4 nhóm phẳng theo thứ tự ik/transform/path/physics, icon riêng
    từng loại; click → select {kind, name}.
  - `Skins`: di cư nguyên SkinsSection (radio active, nút duplicate, + New Skin).
  - `Events`: list tên event defs (`doc.data.events`), click → select
    {kind:'event', name}.
  - `Animations`: list tên; click → select {kind:'animation', name}; double-click →
    `setAnimation(name)` + `setMode('animate')`.
  - `Images`: di cư nguyên section Images (assets + nút Attach, class `.assets` giữ).
- **Dock** (đáy panel, cao mặc định 260px, Resizer ngang giữa tree và dock):
  - bone → `BoneDock` = BoneProperties cũ (name/x/y/rotation/scale/length + Delete
    Bone) di cư nguyên logic.
  - slot → `SlotDock` = SlotProperties + AttachmentsSection + WeightsSection cũ.
  - ik/transform/path/physics/event/animation → `InfoDock`: icon + kind + name +
    tóm tắt read-only (ví dụ IK: target/bones/mix; animation: số track) + ghi chú
    "Chỉnh sửa chi tiết ở Phase 16b".
  - không selection → hint "Select a bone or slot…" (text cũ).
- **e2e compat**: giữ class `.tree` trên container cây, `.row.bone` trên hàng bone,
  `.assets` quanh Images — smoke.mjs chạy nguyên (kiểm lại khi chạy e2e).

## 5. Icons mới (`components/icons.tsx` mở rộng)

`BoneIcon, SlotIcon, ImageIcon, MeshIcon, BBoxIcon, PointIcon, ClipIcon, PathIcon,
IkIcon, TransformIcon, PhysicsIcon, EventIcon, AnimationIcon, SkeletonIcon,
SkinIcon` — SVG tự vẽ 1 nét như bộ hiện có.

## 6. Xóa file cũ

`HierarchyPanel.tsx`, `PropertiesPanel.tsx` XÓA sau khi di cư (git rm); mọi import
trỏ sang TreePanel. CSS: rules `.hierarchy`/`.properties` cũ thay bằng `.tree-panel`
mới (giữ `.tree`, `.row`, `.assets`, `.panel-title` để tái dùng + e2e).

## 7. Kiểm chứng

1. `pnpm typecheck/test/lint/format:check` + editor build xanh; pytest nguyên trạng.
2. 4 e2e xanh (smoke có thể cần chỉnh selector nhỏ nếu markup đổi — giữ tối thiểu).
3. Screenshot đối chiếu: tree phải với bones→slots→attachments lồng nhau + sections +
   chấm visibility + dock bone ở đáy (so screenshot Spine #1).
4. Chấm visibility: tắt bone → gizmo biến mất (sprite giữ); tắt slot → sprite biến
   mất; bật lại OK; không ảnh hưởng export JSON.
5. Double-click animation → nhảy animate mode với animation đó.

## 8. Slice 16b (spec riêng sau khi 16a merge)

Core: `SetIkConstraintProperties`, `SetTransformConstraintProperties`,
`SetPathConstraintProperties`, `SetPhysicsConstraintProperties` (patch undoable +
tests) + `SetBoneColor`. Editor: dock forms đầy đủ cho 6 kind còn lại (đúng field
screenshot Spine: IK Target/Parent-Child/Positive/Stretch/Softness/Mix…), context
menu chuột phải (New…/Duplicate/Delete), rename inline (double-click/F2), sửa màu
bone từ dock. MCP ops set_*_properties cân nhắc kèm.

## 9. Không làm trong 16a

- Form chỉnh constraint/event/animation/skin (16b); context menu; rename inline.
- Kéo-thả MỚI ngoài những gì Hierarchy cũ đã có (reparent bone di cư nguyên — xem §4).
- Multi-skeleton node, folders, audio node (roadmap sau).
