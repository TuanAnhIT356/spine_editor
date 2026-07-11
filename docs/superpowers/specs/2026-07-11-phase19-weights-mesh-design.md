# Phase 19 — Weights view + Mesh tools (design)

Ngày: 2026-07-11 · Nhánh: `claude/phase19-weights` · Trạng thái: đã duyệt design, chờ review spec

## 1. Mục tiêu

Theo PLAN.md §8 row 19 và gap §6 "thêm/xóa vertex":

1. **Mesh tools** — thêm/xóa vertex trên mesh trong viewport (đóng gap §6), weld vertex trùng,
   reset về lưới, retriangulate tự động bằng Delaunay.
2. **Weights window** — cửa sổ nổi chuẩn Spine: bảng bones màu, Bind/Remove/Swap,
   Auto/Smooth/Prune, ô số Influences + Prune threshold, brush Amount + chế độ Add/Replace,
   overlay màu blend theo bone trong viewport.
3. **MCP**: 2 tools mới `edit_mesh`, `adjust_weights` → **61 tools**.

Quyết định đã chốt với user: 1 PR trọn phase; Weights là cửa sổ nổi (pattern
Preview/Ghosting); MCP tools kèm luôn.

## 2. Ngoài scope (YAGNI)

- Constrained edges khi triangulate (Spine cho vẽ cạnh ép — ta chỉ có vertices).
- Edit UV riêng (UV luôn nội suy từ vị trí vertex trong khung width/height).
- Chế độ "Update" tự tính lại weights khi rig đổi (chỉ Auto thủ công).
- Mirror weights trái/phải, export/import weights.

## 3. Core

### 3.1. Dependency mới

`delaunator` (mapbox, ISC ~2KB) trong `client/packages/core/package.json` — Delaunay
triangulation trên tập điểm. ISC tương thích Apache-2.0, không dính Spine Runtimes.

### 3.2. File mới `core/src/mesh-edit.ts`

Làm việc trên `SpineMeshAttachment` **unweighted hoặc weighted** (mọi hàm nhận mesh, trả
mesh mới — pure). Với mesh weighted, vị trí "local" của vertex nghĩa là tọa độ trong
không gian bone của slot tại setup pose (dùng `computeVertexWorldPositions` + invert).

- `retriangulateMesh(mesh, localPositions): { triangles }` — chạy delaunator trên
  `localPositions` (mảng x,y đã giải từ layout weighted nếu cần), lọc bỏ tam giác có
  **centroid nằm ngoài đa giác hull** (hull = `mesh.hull` vertex đầu tiên, theo thứ tự
  viền — đúng format Spine). Point-in-polygon bằng ray casting.
- `addMeshVertex(data, slotName, mesh, localX, localY): SpineMeshAttachment`
  - Nếu điểm cách một **cạnh hull** < `HULL_SNAP = 6` (đơn vị local): chèn vertex vào
    hull giữa 2 đầu cạnh đó (mảng vertex chèn đúng vị trí trong đoạn `[0, hull)`,
    `hull + 1`). Ngược lại: interior vertex (append cuối mảng, hull giữ nguyên).
  - UV mới: `u = (x + width/2) / width`, `v = (height/2 - y) / height` (khớp cách
    `buildGridMeshAttachment` sinh lưới), clamp [0,1].
  - Mesh weighted: vertex mới auto-weight từ **các bone đang bound** (tập bone xuất
    hiện trong influences) bằng logic khoảng-cách của `autoWeightVertices`.
  - Retriangulate toàn mesh.
- `removeMeshVertex(data, slotName, mesh, vertexIndex): SpineMeshAttachment`
  - Chặn khi `vertexCount <= 3` hoặc khi xóa làm hull < 3 (throw Error, message rõ).
  - Vertex hull (`index < hull`): bỏ khỏi mảng, `hull - 1`. Interior: bỏ bình thường.
  - Retriangulate.
- `weldMeshVertices(data, slotName, mesh, threshold = 1): SpineMeshAttachment`
  - Gộp các vertex có khoảng cách local < threshold (giữ vertex chỉ số nhỏ nhất; nếu
    một trong nhóm là hull vertex thì giữ vertex hull). Retriangulate. Trả mesh mới +
    số vertex đã gộp (kiểu trả `{ mesh, merged }`).

### 3.3. Mở rộng `core/src/weights.ts`

Tất cả pure, nhận/trả mảng `vertices` layout Spine:

- `boundBoneIndices(vertices, vertexCount): number[]` — tập bone index xuất hiện trong
  influences (sorted). Trả `[]` nếu unweighted.
- `smoothWeights(data, slotName, mesh, iterations = 1): number[]` — kề = chung cạnh
  trong `mesh.triangles`. Mỗi iteration: weight mới của vertex v cho bone b =
  60% weight cũ + 40% trung bình weight b của các vertex kề. Influence mới xuất hiện
  (weight > 0) cần local coords — tự tính từ setup pose (world position vertex ×
  inverse matrix bone). Renormalize + bỏ influence < 0.001.
- `pruneWeights(vertices, vertexCount, { maxInfluences, threshold }): number[]` — bỏ
  influence weight < threshold, giữ tối đa maxInfluences weight lớn nhất mỗi vertex,
  renormalize (không bao giờ để vertex 0 influence — giữ lại influence lớn nhất).
- `swapWeights(data, slotName, mesh, boneA, boneB): number[]` — hoán ảnh hưởng: mọi
  influence của A đổi sang B và ngược lại; **local coords tính lại** từ world position
  của vertex (setup pose) qua inverse matrix của bone mới.
- `removeBoneFromWeights(data, slotName, mesh, boneName): number[]` — xóa mọi influence
  của bone, renormalize phần còn lại; vertex chỉ có bone đó → chia đều cho các bone
  bound còn lại (theo logic khoảng cách của autoWeight); nếu không còn bone nào bound →
  trả mảng **unweighted** (local slot-bone space, tính từ world setup).

### 3.4. Command mới `SetMeshGeometry` (commands/structure.ts)

```
new SetMeshGeometry(skin, slot, attachment, {
  vertices, uvs, triangles, hull,
})
```

- Snapshot-restore undo (giữ bản sao 4 mảng cũ + deform timelines cũ).
- Validate: uvs.length = 2×count khớp vertices layout, triangles index < count, hull ≤ count.
- **Xóa mọi deform timeline** trỏ tới attachment này trong **mọi** animation (đổi vertex
  count làm key cũ vô nghĩa — giống cảnh báo Spine); undo khôi phục cả deform.
- Weight-only ops (smooth/prune/swap/remove-bone/auto) dùng `SetAttachmentVertices` sẵn có
  (vertex count không đổi → deform giữ nguyên).

### 3.5. Test core (`test/mesh-edit.test.ts` + mở rộng `test/weights.test.ts`)

Mesh: add interior (count+1, hull giữ, triangles hợp lệ — mọi index < count, ít nhất
1 tam giác, không tam giác ngoài hull), add trên cạnh hull (hull+1, thứ tự viền đúng),
remove interior/hull, chặn xóa còn <3, weld 2 vertex trùng, add vào mesh weighted
(vertex mới weighted, tổng weight = 1), SetMeshGeometry undo khôi phục vertices +
deform keys. Weights: smooth kéo weight về láng giềng, prune bỏ influence nhỏ +
renormalize, swap hoán 2 bone và tính lại local đúng (world position bất biến),
remove bone cuối → unweighted.

## 4. Editor

### 4.1. Mesh tools (SlotDock, hàng nút khi đang edit)

`meshEdit.mode`: `'vertices' | 'create' | 'delete' | 'weights'`. Hàng nút trong
attachment row đang editing: **Modify · Create · Delete · Weights · Weld · Reset**
(Weld/Reset là action ngay, 4 cái đầu là mode toggle).

- **Modify** = mode `vertices` hiện tại (kéo vertex).
- **Create**: click trong viewport → `SetMeshGeometry` với `addMeshVertex` tại điểm
  click (đổi từ screen → local qua inverse bone world; dùng vị trí trên **setup pose**
  — animate mode: chặn Create/Delete/Weld/Reset, chỉ cho ở setup mode, hiện thông báo
  trong dock).
- **Delete**: click vertex (hit ≤ 8px như drag hiện tại) → remove.
- **Weld**: chạy `weldMeshVertices` threshold 1 đơn vị local, báo số vertex gộp qua
  banner hiện có (silent nếu 0).
- **Reset**: thay geometry bằng `buildGridMeshAttachment(width, height)` 3×3 (mesh về
  unweighted — cảnh báo mất weights qua `confirm()` không cần: đây là command undoable).

### 4.2. Weights window (`components/WeightsWindow.tsx`)

Cửa sổ nổi cùng pattern Preview/Ghosting (drag header, localStorage
`spine-editor.weights-window`, z-index 25, ~260×420). **Tự mở khi `meshEdit.mode`
chuyển sang `weights`**, có mục trong Views ▾ (disabled khi không có meshEdit).
Nội dung gắn với `meshEdit.slot/attachment` hiện tại; không có meshEdit → dòng
"Edit a mesh first."

- **Bones list**: các bone bound (từ `boundBoneIndices`) ∪ bones user vừa Bind trong
  session (state cục bộ window — bone bind mới chưa có weight cho tới khi Auto/paint).
  Mỗi bone: chấm màu từ `WEIGHT_COLORS` (palette 8 màu cố định, lặp), tên, % tổng
  weight (Σ weight bone / Σ tất cả, 1 chữ số), radio chọn **paint bone**.
- **Bind**: `<select>` liệt kê bones chưa bound → thêm vào session list + đặt làm paint
  bone. **Remove**: bỏ paint bone hiện tại (`removeBoneFromWeights` qua
  SetAttachmentVertices). **Swap**: bấm → trạng thái "chọn bone thứ 2" → click bone
  khác trong list → `swapWeights`.
- **Auto**: `autoWeightVertices` với toàn bộ bones trong list (kể cả bind mới) —
  maxInfluences từ ô **Influences** (1–8, default 4). **Smooth**: 1 iteration/bấm.
  **Prune**: threshold từ ô **Prune** (default 0.01).
- **Brush**: slider **Amount** 0–1 (default 0.2) + toggle **Add / Replace**. Add =
  delta dương như hiện tại (`adjustVertexWeight` + amount×falloff); Replace = đặt
  weight = amount×falloff tuyệt đối (delta = target − current). Shift khi kéo = trừ
  (đảo dấu, chỉ mode Add). Viewport `paintDab` đọc amount/mode từ store.
- `meshEdit` store mở rộng: `paintAmount: number`, `paintMode: 'add' | 'replace'`
  (editor-only).

### 4.3. Viewport overlay màu theo bone

`RenderInput.editTarget` thêm `weightColors?: Map<string, number>` (bone → màu). Khi
mode weights và **không** có paintBone: handle mỗi vertex tô màu blend
Σ (weight_i × color_i) — thấy ngay vùng ảnh hưởng từng bone như Spine. Có paintBone:
heatmap xanh→đỏ hiện tại giữ nguyên. Bone gizmo của bones bound cũng tô viền màu
tương ứng khi đang ở weights mode (stroke đổi màu trong drawBones — chỉ khi
editTarget có weightColors; truyền map qua RenderInput, renderer tra theo tên bone).

### 4.4. SlotDock WeightsSection

Rút gọn: phần bind-list chuyển hết vào WeightsWindow; section còn nút **"Weights…"**
(mở window + set mode weights) và dòng trạng thái weighted/unweighted.

## 5. MCP + bridge

`BRIDGE_OPS` +2 (`edit_mesh`, `adjust_weights`), TOOL_DEFS 59 → **61** (shared test đổi
count). Case mới trong `bridge/ops.ts` gọi đúng core như UI (qua execute để undoable):

- `edit_mesh` — `{ slot, attachment, action: 'add_vertex' | 'remove_vertex' | 'weld' |
'reset', x?, y?, vertexIndex?, threshold? }` (x,y local; validate action-param khớp,
  message lỗi rõ). Trả `{ vertexCount, hull, triangles: n }`.
- `adjust_weights` — `{ slot, attachment, action: 'auto' | 'smooth' | 'prune' | 'swap' |
'remove_bone', bones?: string[], iterations?, maxInfluences?, threshold?, boneA?,
boneB?, bone? }`. Trả tóm tắt bound bones + % mỗi bone.

MCP server đăng ký tự động từ TOOL_DEFS (không sửa mcp-server ngoài test count nếu có).

## 6. Verify

- Core tests mới (~12) + suites hiện có; typecheck/lint/format; pytest không đổi.
- `bridge.mjs` thêm bước: `create_mesh` → `edit_mesh add_vertex` → `adjust_weights auto`
  → assert `vertexCount` tăng + weighted qua `get_project_state` (`meshEditWorks: true`).
- Battery đủ 4 e2e (smoke/anim/bridge/chat) như mọi phase; selectors hiện có không đổi
  (nút mới thêm text mới, không sửa text cũ: "Edit"/"Done" giữ nguyên).
- Docs: CLAUDE.md (Phase 19 done, 61 tools), PLAN.md row 19 ✅ + §6 gap add/remove
  vertex đóng.

## 7. Rủi ro & xử lý

- **Delaunay đổi topology tam giác user không mong muốn** — chấp nhận (Spine cũng
  retriangulate); Modify (kéo vertex) không retriangulate.
- **Deform keys mất khi đổi geometry** — chủ ý, trong cùng undo step, giống Spine.
- **Mesh từ atlas region xoay** — UV nội suy theo width/height của attachment (không
  đọc atlas); chấp nhận sai lệch UV với region rotate (ghi chú trong code).
- **Weight ops đổi cấu trúc influence làm deform keys (mesh weighted) lệch** — deform
  weighted lưu offset theo từng influence; auto/smooth/prune/swap/remove-bone (và cả
  paint từ Phase 8) đổi số influence → key cũ lệch. Hành vi sẵn có từ Phase 8, giữ
  nguyên phase này (không xóa deform khi chỉ đổi weights); user re-key nếu cần.
