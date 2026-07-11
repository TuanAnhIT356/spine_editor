# Spec: Phase 14 Slice 1 — Auto-rig từ parts + Preset animations

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: `packages/core` (autorig + presets + tests), `packages/shared` (+2 op), `packages/editor` (`ops.ts` 2 case), `packages/mcp-server` (+2 tool), skills, e2e `bridge.mjs`. Không đụng `server/` — chat là slice 2.

## 1. Bối cảnh & mục tiêu

PLAN.md §7.5 bước auto-rig/auto-animate: sau Phase 13, editor đã có các part đặt đúng
vị trí trên canvas (slot + region attachment tên chuẩn, gốc từ "Place on canvas").
Slice này biến chúng thành rig hoàn chỉnh + chuyển động preset **bằng một op mỗi thứ**,
dùng được ngay qua MCP (Claude Code auto-rig không cần chat). Chat infra là slice 2.

## 2. Core `packages/core/src/autorig.ts` (thuần logic)

```ts
export interface PartBox {
  name: string; // tên part chuẩn (DEFAULT_PART_NAMES của segment)
  x: number; // tâm, hệ world Y-up
  y: number;
  width: number;
  height: number;
}

export interface RigPlan {
  bones: BoneData[]; // theo thứ tự thêm (parent trước con)
  slotBindings: {
    // slot part → bone mới
    slot: string;
    bone: string;
    attachment: { x: number; y: number; rotation: number };
  }[];
  ik: IkConstraintData[]; // 2-bone tay/chân + target bones nằm trong `bones`
  drawOrder: string[]; // thứ tự slot chuẩn (chân→thân→tay→đầu)
}

export function buildRigFromParts(parts: PartBox[], opts?: { ik?: boolean }): RigPlan;
```

- **Suy khớp từ hộp** (T-pose, hộp thẳng trục):
  - `hip` = trung điểm top-center của `upper_leg_l/r`; fallback bottom-center của `torso`.
  - `neck` = trung điểm giữa bottom-center của `head` và top-center của `torso`.
  - `shoulder_l/r` = tâm mép của `upper_arm_*` GẦN tâm torso nhất (mép trong).
  - `elbow/knee` = trung điểm 2 mép đối diện giữa upper↔lower cùng chi;
    `wrist/ankle` = tâm mép xa torso của `lower_*`.
- **Bones**: `root(0,0)` → `hip` → `spine (hip→neck)` → `head (neck→tâm head)`;
  `upper_arm_l (shoulder→elbow)` → `lower_arm_l (elbow→wrist)`; tương tự phải + chân.
  Quy ước **+X dọc xương**: rotation = atan2 world → đổi sang parent-local, length =
  khoảng cách khớp, x/y parent-local. Tên bone = tên part chuẩn (hip/spine/head giữ
  tên riêng: `hip`, `spine`, `head`).
- **Slot rebinding**: mỗi part slot đổi `bone` sang bone tương ứng
  (head→head, torso→spine, upper_arm_l→upper_arm_l…); attachment x/y = vị trí tâm part
  trong hệ bone-local (nghịch đảo transform bone), rotation = −(world rotation của bone)
  để ảnh giữ thẳng.
- **IK** (`opts.ik !== false`): target bones `ik_hand_l/r` tại wrist, `ik_foot_l/r`
  tại ankle (con của root); 4 `IkConstraintData` 2-bone (upper+lower, bendPositive
  theo chi). Thiếu chi nào bỏ IK chi đó.
- **Khuyết part**: rig phần có mặt; không có `torso` → throw
  `Cannot rig: missing "torso" part`. Không có cặp leg → bỏ hip-từ-leg, dùng fallback.
- Vị trí file: `src/autorig.ts`, export qua barrel.

## 3. Core `packages/core/src/presets.ts`

```ts
export type PresetName = 'idle' | 'walk' | 'wave';
export const PRESET_ANIMATIONS: Record<PresetName, PresetAnimation>;
export function retargetPreset(
  preset: PresetName,
  data: SkeletonData,
  boneMap?: Record<string, string>, // tên chuẩn → tên bone thật (mặc định 1:1)
): SpineAnimation;
```

- Preset format nội bộ: per tên-bone-chuẩn → keys `rotate`/`translate` (value =
  **offset so với setup pose**, đúng semantics evaluator), curve bezier mượt,
  key cuối trùng key đầu (loop), duration 1s (wave 1.6s, 2 nhịp).
- Nội dung: `idle` — spine ±2°, head ∓1.5° lệch pha, hip bob y ±2 (scale);
  `walk` — upper_leg ±25° ngược pha nhau, lower_leg bù pha +15°, upper_arm ±20°
  ngược pha chân cùng bên, hip bob y 2 nhịp/chu kỳ; `wave` — upper_arm_r 60°→75°→60°
  ×2, lower_arm_r phụ họa ±10°.
- **Retarget**: bone không tồn tại trong skeleton → bỏ track đó; `rotate` giữ nguyên
  giá trị; `translate` scale theo `boneLength/REFERENCE_LENGTH` (REFERENCE_LENGTH =
  100; bone length 0 → giữ nguyên). Trả `SpineAnimation` verbatim-format.

## 4. Ops + MCP tools

- `packages/shared`: `BRIDGE_OPS` thêm `'rig_from_parts'`, `'apply_preset_animation'`
  (60 → **62**).
- `ops.ts` case `rig_from_parts { ik?: boolean }`:
  1. Quét `doc.data.slots` lấy slot có attachment (region) trùng tên part chuẩn
     (khớp cả suffix `-2` từ import trùng: strip `-<số>` cuối khi so).
  2. Đọc world box từ attachment (slot đang trên root nên attachment x/y = world).
  3. `buildRigFromParts` → map `RigPlan` thành 1 `Composite`: `AddBone`×n,
     `SetSlotProperties {bone}` + `AddSkinAttachment` (allowReplace, x/y/rotation mới)
     ×n, `AddIkConstraint`×≤4, `ReorderSlot` theo drawOrder — **1 bước undo**.
  4. Trả `{bones: string[], ik: string[], slots: string[]}`.
- `ops.ts` case `apply_preset_animation { preset, animation?, bone_map? }`:
  `retargetPreset` → 1 `Composite`: `CreateAnimation(tên = animation ?? preset)` +
  `UpsertBoneKeyframe` per key. Preset không hợp lệ → throw danh sách hợp lệ. Trả
  `{animation, tracks: number, keys: number}`.
- `tools.ts`: +2 tool (53 → **55**) — mô tả nêu điều kiện dùng (rig_from_parts cần
  parts đặt trên canvas với tên chuẩn — từ segment_image/Segment dialog;
  apply_preset_animation cần rig tên bone chuẩn hoặc bone_map).
- Skills: spine-rigging (+ đoạn "sau segment_image, gọi rig_from_parts");
  spine-animating (+ đoạn preset trước khi keyframe tay).

## 5. Tests & e2e

- `packages/core/test/autorig.test.ts`: fixture 10 part từ FAKE_POSE_FRACTIONS hình
  người chuẩn (w=400,h=800, đổi sang Y-up) → đủ bones (root,hip,spine,head, 8 chi,
  4 ik target), khớp vị trí ±1px, chuỗi parent đúng, +X dọc xương (rotation đúng
  hướng), thiếu `upper_arm_l` → không có bone/IK tay trái, thiếu torso → throw,
  slotBindings giữ ảnh thẳng (attachment.rotation = −bone world rotation).
- `packages/core/test/presets.test.ts`: mỗi preset — track chỉ trỏ bone tồn tại,
  loop closure (key cuối = giá trị key đầu), translate scale theo length, boneMap
  hoạt động, bone thiếu bị bỏ track, `getAnimationDuration` = duration preset.
- E2E `bridge.mjs`, flow mới ở cuối file: dùng op `load_project` nạp một project JSON
  dựng sẵn ngay trong script (10 slot tên part chuẩn trên root, region attachment đặt
  theo hình người chuẩn — cùng tỷ lệ FAKE_POSE) → `rig_from_parts` →
  `get_skeleton_tree` đủ bones + 4 IK → `apply_preset_animation {preset: 'walk'}` →
  `export_spine_json` có animation `walk` với track `upper_leg_l` →
  `preview_at_time` t=0.25 vs t=0.75 cho pose khác nhau (xác nhận evaluator chạy).
- Toàn bộ offline, không server.

## 6. Nghiệm thu

1. `pnpm test` xanh với 2 file test core mới.
2. `bridge.mjs` pass: 55 tools, rigFromPartsWorks + presetWalkWorks true.
3. Smoke tay: segment ảnh thật (Phase 13) → Place on canvas → MCP/console gọi
   `rig_from_parts` + `apply_preset_animation walk` → nhân vật bước trong viewport.
4. Lint/format/typecheck toàn repo xanh; PLAN.md + CLAUDE.md cập nhật (55 tools,
   Phase 14 slice 1).

## 7. Không làm (slice 2 / sau)

- Chat infra (ws, anthropic loop, conversations/messages, ChatPanel) — slice 2.
- Mesh + auto-weights trong autorig (chỉ rebind slot; weights đã có tool riêng).
- Preset editor UI; thêm preset ngoài 3 cái; part nghiêng/xéo (heuristic hộp thẳng).
