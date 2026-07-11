# Spec: Phase 16b — Constraint/Event/Animation editors + context menu + inline rename

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: `core` (+5 lệnh, tests), `shared` (TOOL_DEFS 55→59), `editor`
  (ops ×4, dock forms thay InfoDock, context menu, inline rename),
  `mcp-server` (tự nhận từ TOOL_DEFS), e2e bridge.mjs (toolCount 59 + probe).
  Hoàn tất Phase 16 của roadmap §8.

## 1. Core commands (TDD)

- `SetIkConstraintProperties(name, patch)` — patch: Partial các field của
  `IkConstraintData` trừ `name` (target, bones, mix, softness, bendPositive,
  compress, stretch, uniform, order). Validate: constraint tồn tại; khi patch
  `target`/`bones` thì bone phải tồn tại (bones ≤ 2, ≥ 1). Undo khôi phục
  đúng các field bị patch.
- `SetTransformConstraintProperties`, `SetPathConstraintProperties`,
  `SetPhysicsConstraintProperties` — tương tự theo model type từng loại
  (path.target là SLOT — validate slot tồn tại).
- `SetBoneColor(name, color?: string)` — `bones.ts`; validate RGBA hex 8 ký tự
  (hoặc undefined để xóa); undo giữ màu cũ.
- Test: `client/packages/core/test/constraints-set.test.ts` — mỗi loại:
  patch rồi đọc lại, undo về giá trị cũ, patch target không tồn tại → execute
  fail; `bones.test`? — thêm case SetBoneColor vào `commands.test.ts`.

## 2. Bridge + MCP

- `BRIDGE_OPS` +4 sau `remove_physics_constraint`: `set_ik_constraint`,
  `set_transform_constraint`, `set_path_constraint`, `set_physics_constraint`
  (62→66).
- `ops.ts` 4 case: đọc `name` + các field optional từ params thành patch,
  `executeOrThrow(new Set*ConstraintProperties(name, patch))`, trả
  `{ ok: true }`.
- `TOOL_DEFS` +4 ngay sau các def `remove_*_constraint` (55→**59**): shape =
  shape của `add_*_constraint` tương ứng nhưng MỌI field optional trừ
  `name: z.string()`; description nêu "patch only the fields you pass;
  undoable".
- e2e `bridge.mjs`: `toolCount` expectation 55→59; sau flow constraint hiện có
  thêm probe: `set_ik_constraint {name:'arm-ik', mix:0.5}` →
  `get_skeleton_tree` xác nhận mix 0.5 → summary field `setIkWorks`.
- `skills/spine-rigging/SKILL.md`: câu remove_* nối thêm "— or tweak one in
  place with set_{ik,transform,path,physics}_constraint (patch semantics)".

## 3. Dock editors (`components/tree/dock/`)

- `ConstraintDock.tsx` — nhận `{kind, name}`; 4 form:
  - **IK**: Target (select mọi bone), Bones (readonly text), checkbox
    Positive (bendPositive) / Stretch / Compress, NumField Softness, NumField
    Mix (0–1), nút Delete (RemoveIkConstraint — lỗi khi animation còn key sẽ
    hiện qua setError sẵn có).
  - **Transform**: Target (select bone), offsets rotation/x/y/scaleX/scaleY,
    mixRotate/mixX/mixY/mixScaleX/mixScaleY, checkbox local/relative, Delete.
  - **Path**: Target (select SLOT), select positionMode (fixed|percent),
    spacingMode (length|fixed|percent|proportional), rotateMode
    (tangent|chain|chainScale), NumField position/spacing/rotation,
    mixRotate/mixX/mixY, Delete.
  - **Physics**: Bone (readonly), NumField x/y/rotate/scaleX/shearX,
    inertia/strength/damping/mass/wind/gravity/limit/mix, Delete.
  - Mọi thay đổi qua lệnh Set* mới (undoable, giá trị hiển thị đọc từ doc).
- `EventDock.tsx` — NumField int/float/volume/balance, text string/audio
  (SetEventDef với def hiện tại + patch), nút Delete (RemoveEventDef).
- `AnimationDock.tsx` — input rename (RenameAnimation; đồng bộ anim.current
  nếu đang mở), nút Open (setAnimation + setMode('animate')), Delete
  (RemoveAnimation; nếu là anim đang mở → setAnimation(null)).
- `BoneDock`: thêm hàng **Color** — input `type="color"` (6 hex) + nút xóa màu;
  ghi qua `SetBoneColor` (giữ alpha 'ff'); icon tree tint cập nhật theo.
- `InfoDock.tsx` XÓA (mọi kind đã có form); TreePanel định tuyến dock theo
  kind: bone/slot/ik/transform/path/physics/event/animation.

## 4. Context menu + inline rename (`components/tree/`)

- `ContextMenu.tsx`: component chung (fixed tại vị trí chuột, đóng khi click
  ngoài/Escape); TreeRows/sections mở qua `onContextMenu` (preventDefault).
  Mục theo kind: bone → New Child Bone (AddBone `createBone(uniqueName('bone'),
name)` + select) / Rename / Delete (RemoveBone); slot → Delete
  (removeSlotCascade); ik/transform/path/physics → Delete (Remove*); event →
  Delete (RemoveEventDef); animation → Open / Rename / Delete.
- **Inline rename** (bone + animation): double-click hoặc F2 trên row →
  input tại chỗ (autoFocus, Enter commit qua RenameBone/RenameAnimation,
  Escape hủy). Chọn row là click đơn như cũ.
- Root bone: không Rename/Delete (menu chỉ New Child Bone).

## 5. Kiểm chứng

1. Core tests mới xanh (`pnpm --filter @spine-editor/core test`); toàn suite +
   pytest nguyên trạng.
2. `bridge.mjs`: `toolCount: 59`, `setIkWorks: true`, mọi flag cũ nguyên.
3. smoke/anim/chat xanh (chat hello tự mang 59 schema — fake không đổi).
4. Screenshot: chọn IK trong tree → dock hiện form Target/Positive/Stretch/
   Softness/Mix như panel Spine (screenshot #3).
5. Context menu: chuột phải bone → New Child Bone tạo + select; F2 rename bone
   đổi tên và cascade tham chiếu (RenameBone sẵn có).

## 6. Không làm

- Duplicate animation; rename slot/event/skin (chưa có lệnh core — phase sau);
  skin dock; kéo-thả section; multi-select context actions.
