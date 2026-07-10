# Kế hoạch xây dựng Spine Editor Web

Trình biên tập animation 2D skeletal chạy trên web, giao diện tương tự Spine 2D, xuất file Spine `.json`, tích hợp MCP server + skill để AI có thể tự tạo và diễn hoạt animation.

## 1. Phân tích yêu cầu

### 1.1. Bốn yêu cầu chính

| Yêu cầu                  | Bản chất kỹ thuật                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Giao diện giống Spine 2D | App desktop-style trên web: viewport WebGL ở giữa, panel Hierarchy (cây bone/slot), panel Properties, panel Timeline/Dopesheet phía dưới, chuyển đổi giữa chế độ **Setup** và **Animate** |
| Tạo animation Spine 2D   | Mô hình dữ liệu skeleton (bones, slots, skins, attachments, constraints) + hệ thống keyframe/timeline + bộ đánh giá animation (evaluator) để playback                                     |
| Xuất file Spine `.json`  | Serializer sinh JSON đúng schema Spine (đề xuất target **4.2**), kèm xuất texture atlas (`.atlas` + `.png`) để dùng được trong game engine                                                |
| MCP + Skill cho AI       | MCP server expose các tool (tạo bone, đặt keyframe, chụp ảnh viewport…) nối với editor qua WebSocket; skill (`SKILL.md`) dạy AI quy trình rigging/animating                               |

### 1.2. Vấn đề bản quyền cần lưu ý ngay từ đầu

- **Spine editor** là phần mềm thương mại của Esoteric Software — ta không sao chép code/asset của họ, chỉ xây UI tương tự về bố cục workflow.
- **Spine Runtimes** (spine-ts, pixi-spine…) có license yêu cầu người dùng phải có Spine license. Vì vậy ta **không nhúng spine-ts** vào editor. Thay vào đó:
  - Tự viết **animation evaluator** riêng cho việc preview trong editor (cần thiết cho editor dù thế nào đi nữa).
  - Format JSON của Spine là tài liệu công khai (http://esotericsoftware.com/spine-json-format) — việc ghi/đọc format này là hợp lệ.
- File xuất ra dùng được với runtime chính thức ở phía người dùng (họ tự lo license khi tích hợp vào game).

## 2. Kiến trúc & Tech stack

### 2.1. Tech stack đề xuất

- **Monorepo**: pnpm workspaces + TypeScript toàn bộ.
- **Frontend**: React 18 + Vite.
- **Render viewport**: PixiJS v8 (WebGL/WebGPU) — render texture, mesh deform, gizmo.
- **State**: Zustand + immer; undo/redo bằng command pattern (mọi chỉnh sửa đều là Command — đây cũng chính là API mà MCP server sẽ gọi).
- **Layout panel**: flexlayout-react (dockable panels giống Spine).
- **Timeline/Dopesheet/Curve editor**: tự viết bằng canvas 2D (không có thư viện sẵn đạt yêu cầu).
- **Lưu project**: IndexedDB (local) + export/import file project `.zip`; backend chưa cần ở giai đoạn đầu (app tĩnh hoàn toàn client-side).
- **MCP server**: Node/TypeScript, `@modelcontextprotocol/sdk`, giao tiếp với editor đang chạy qua WebSocket bridge.

### 2.2. Cấu trúc packages

```
spine_editor/
├── packages/
│   ├── core/          # Mô hình dữ liệu, command system, animation evaluator,
│   │                  # spine-json serializer/parser, atlas packer — KHÔNG phụ thuộc UI
│   ├── editor/        # React app: viewport, hierarchy, inspector, timeline
│   ├── mcp-server/    # MCP server + WebSocket bridge tới editor
│   └── shared/        # Types, protocol messages dùng chung
├── skills/            # SKILL.md cho AI (rigging, animating, export)
└── examples/          # Project mẫu + file .json chuẩn để test tương thích
```

Điểm mấu chốt: **`core` tách khỏi UI hoàn toàn**. Editor UI và MCP server đều chỉ là hai "client" cùng gọi vào một command API. Nhờ đó AI làm được mọi thứ người dùng làm được, và test được headless.

### 2.3. Mô hình dữ liệu (theo Spine JSON 4.2)

- **Skeleton**: danh sách bones (cây phân cấp; mỗi bone có x, y, rotation, scaleX/Y, shearX/Y, length).
- **Slots**: gắn vào bone, có draw order, color, blend mode, attachment đang active.
- **Skins → Attachments**: region (ảnh), mesh (vertices + UV + triangles + weights), bounding box, path, clipping.
- **Constraints**: IK, transform, path (IK làm trước, hai loại sau để giai đoạn sau).
- **Animations → Timelines**: bone (translate/rotate/scale/shear), slot (attachment/color), draw order, events, constraint timelines. Mỗi keyframe có curve (linear / stepped / bezier).
- **Events**, **Audio** (metadata).

## 3. Các giai đoạn thực hiện

### Phase 0 — Scaffolding (nền móng) ✅ Hoàn thành

- Monorepo pnpm + Vite + TypeScript strict + Vitest + ESLint/Prettier + CI (GitHub Actions).
- Chốt target format **Spine JSON 4.2**; thu thập bộ file `.json` mẫu chuẩn làm fixture test.
- Cập nhật `CLAUDE.md` với lệnh build/test thực tế.

### Phase 1 — Core model + Xuất/Nhập JSON _(giá trị cốt lõi, làm trước UI)_ ✅ Hoàn thành

> Ghi chú thực hiện: fixture dùng file tự viết tay (không dùng spineboy/raptor vì bản quyền asset của Esoteric Software). Việc kiểm tra file xuất trên Spine runtime chuẩn cần người dùng chạy thủ công trong một project game có license.

- Mô hình dữ liệu đầy đủ trong `packages/core` + command system + undo/redo.
- **Serializer** xuất Spine JSON 4.2 và **parser** nhập JSON (nhập giúp test round-trip: parse file mẫu → serialize → so sánh).
- Unit test tương thích với các file mẫu (spineboy, raptor… từ tài liệu công khai).
- ✅ Nghiệm thu: file xuất ra load được bằng Spine runtime chuẩn trong một project game test.

### Phase 2 — Editor Setup Mode (rigging) ✅ Hoàn thành

> Ghi chú thực hiện: panel dùng layout cố định (dockable để giai đoạn polish); scale chỉnh qua Properties panel (chưa có gizmo scale); lưu project bằng file JSON đơn (`project.spine-editor.json`, chưa dùng .zip) + autosave IndexedDB. Đã verify end-to-end bằng Chromium thật (`packages/editor/e2e/smoke.mjs`).

- Shell UI: dockable panels, menu, toolbar, chuyển Setup/Animate.
- Viewport PixiJS: pan/zoom, grid, chọn đối tượng, gizmo translate/rotate/scale.
- Hierarchy panel (cây bones/slots, kéo thả re-parent), Properties panel.
- Upload ảnh, tạo slot + region attachment, chỉnh draw order.
- Tạo/sửa/xóa bone bằng chuột (giống công cụ Create của Spine).
- Lưu/mở project (IndexedDB + file `.zip`).
- ✅ Nghiệm thu: rig được một nhân vật từ các ảnh rời và xuất JSON hợp lệ.

### Phase 3 — Animate Mode (trọng tâm khó nhất) ✅ Hoàn thành

> Ghi chú thực hiện: evaluator hỗ trợ đủ bone timelines (rotate/translate/scale/shear + biến thể 1 trục) với curve linear/stepped/bezier, và slot attachment timeline; constraints/slot color/deform chưa được evaluate (chuyển sang Phase 4). Dopesheet: scrub, kéo key đổi time, xóa key, đổi curve linear/stepped per-key; curve editor bezier trực quan và copy-paste key để giai đoạn polish. Auto-key khi kéo bone bằng tool Translate/Rotate. Playback play/pause/loop (chưa có điều chỉnh tốc độ). Verify end-to-end bằng `packages/editor/e2e/anim.mjs`.

- **Animation evaluator** trong `core`: pose skeleton tại thời điểm t (dùng cho cả playback lẫn MCP).
- Timeline/Dopesheet: track theo bone/slot, đặt/di chuyển/xóa keyframe, auto-key, copy-paste key.
- Curve editor (bezier) + playback controls (play/loop/tốc độ).
- Timeline cho slot attachment (frame-by-frame switching) và draw order.
- ✅ Nghiệm thu: tạo animation walk/idle hoàn chỉnh, xuất JSON chạy đúng trên runtime chuẩn.

### Phase 4 — Tính năng nâng cao ✅ Hoàn thành (một phần, xem ghi chú)

> Ghi chú thực hiện: **Đã xong** — IK evaluation (solver 1-bone + 2-bone với bendPositive/mix, IK timeline; xấp xỉ: bỏ qua softness/stretch/scale trên chuỗi), transform constraint evaluation (mixRotate/mixX/mixY/mixScale, trường hợp non-local/non-relative), slot color evaluation (rgba + alpha timelines, tint khi render), deform timeline evaluation (sparse keys, unweighted + weighted), tạo mesh dạng lưới (`create_mesh` chuyển region → grid mesh) + `set_deform_keyframe`/`set_slot_color_keyframe`, texture atlas packer (shelf packing, format libgdx `.atlas` + PNG), render mesh (unweighted + weighted skinning), events, Import Spine JSON. **Chưa làm** — UI kéo vertex mesh và weight painting (chỉnh qua MCP/JSON được), path/physics constraint evaluation (cần spline sampling + mô phỏng stateful; dữ liệu vẫn round-trip đầy đủ).

- Mesh attachment: tạo lưới, chỉnh vertex, **weights** (bind bone, paint weight).
- IK constraints + timeline IK.
- Events + event timeline.
- **Texture atlas packer**: xuất `.atlas` (format libgdx) + PNG.
- Import file Spine JSON có sẵn để chỉnh sửa.

### Phase 5 — MCP + Skill cho AI _(có thể làm song song từ sau Phase 1)_ ✅ Hoàn thành

> Ghi chú thực hiện: MCP server (stdio, `@modelcontextprotocol/sdk`) + WebSocket bridge trên cổng 8017; editor tự kết nối khi mở. ~24 tools gồm đủ 4 nhóm, trong đó `screenshot_viewport` crop đúng khung camera. Chế độ headless (thao tác file không cần browser) chưa làm — mọi tool yêu cầu editor đang mở. Đăng ký server qua file `.mcp.json` của client (xem README). Skills: spine-rigging, spine-animating, spine-export. Verify toàn chuỗi bằng `packages/mcp-server/e2e/bridge.mjs`.

Kiến trúc: `Claude ⇄ MCP server (Node) ⇄ WebSocket ⇄ Editor đang chạy trên browser`. MCP server cũng có **chế độ headless** (thao tác trực tiếp trên file project bằng `core`, không cần browser) cho các tác vụ batch.

Bộ tool MCP đề xuất (~20 tool):

| Nhóm      | Tools                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Quan sát  | `get_project_state`, `get_skeleton_tree`, `get_animation_list`, `screenshot_viewport` (AI nhìn thấy kết quả — vòng phản hồi quan trọng nhất) |
| Rigging   | `create_skeleton`, `add_bone`, `add_slot`, `import_image`, `attach_region`, `set_bone_transform`, `set_draw_order`, `add_ik_constraint`      |
| Animating | `create_animation`, `set_keyframe`, `delete_keyframe`, `set_curve`, `preview_at_time`, `play_animation`                                      |
| Xuất      | `export_spine_json`, `export_atlas`, `validate_project`                                                                                      |

Skills (`skills/`):

- `spine-rigging/SKILL.md` — quy trình rig: import ảnh → dựng cây bone theo giải phẫu → gắn attachment → kiểm tra bằng screenshot.
- `spine-animating/SKILL.md` — nguyên tắc animation (pose chính → timing → easing), pattern cho walk cycle, idle, attack…
- `spine-export/SKILL.md` — validate + export + checklist tương thích.

✅ Nghiệm thu: Claude nhận các ảnh bộ phận nhân vật, tự rig, tự tạo animation idle và xuất `.json` hợp lệ chỉ qua MCP tools.

### Phase 6 — Hoàn thiện ✅ Một phần

> Đã xong: curve presets (linear/stepped/ease-in/ease-out/ease-in-out) và copy/paste key trong dopesheet, favicon, build với `base: './'` chạy trên mọi static host, workflow deploy GitHub Pages (`.github/workflows/deploy.yml` — cần bật Pages trong Settings). Còn lại: dockable panels, curve editor bezier trực quan (kéo control point), phím tắt đầy đủ kiểu Spine.

- Validation + báo lỗi thân thiện, hiệu năng với skeleton lớn, phím tắt giống Spine, tài liệu người dùng, deploy static site (GitHub Pages/Cloudflare).

## 4. Rủi ro chính & cách giảm thiểu

| Rủi ro                                    | Giảm thiểu                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Sai lệch format JSON so với runtime chuẩn | Test round-trip với file mẫu chuẩn ngay từ Phase 1; test load thực tế trên runtime ở mỗi phase |
| Timeline/curve editor phức tạp, dễ sa lầy | Làm dopesheet đơn giản trước, curve editor sau; tham khảo UX của Spine/Blender                 |
| Mesh weights khó cả về UI lẫn toán        | Đẩy xuống Phase 4; MVP chỉ cần region attachments                                              |
| AI thao tác mù không thấy kết quả         | `screenshot_viewport` + `preview_at_time` là tool bắt buộc từ ngày đầu của MCP                 |
| Scope quá lớn                             | MVP = Phase 0–3 + export JSON; Phase 4 có thể cắt giảm                                         |

## 5. Phạm vi MVP đề xuất

**MVP (Phase 0 → 3 + tool MCP cơ bản)**: rig nhân vật bằng bones + region attachments, tạo animation keyframe với curve, playback, xuất Spine JSON 4.2 hợp lệ, AI tạo được animation đơn giản qua MCP. Mesh/weights, IK, atlas packer nằm ở giai đoạn sau.

## 6. Gap analysis so với Spine chính thức (spine-in-depth) & lộ trình Phase 7–10

So sánh feature-by-feature với trang [Spine: In Depth](https://esotericsoftware.com/spine-in-depth)
(bộ tính năng editor chính thức của Esoteric Software), đối chiếu với code hiện tại
(sau đợt nâng cấp UI: resizable panels, multi-select, timeline zoom, phím tắt).

Ký hiệu: ✅ có · 🟡 một phần · ❌ chưa có · 📦 dữ liệu round-trip được nhưng chưa evaluate/render/edit.

### 6.1. Bảng đối chiếu

| Nhóm        | Feature của Spine                                             | Hiện trạng | Ghi chú                                                                                                          |
| ----------- | ------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Rigging     | Bones, hierarchy, re-parent, length                           | ✅         |                                                                                                                  |
| Rigging     | Bone `inherit` modes (5 chế độ)                               | ✅         | Phase 9: đủ 5 chế độ theo logic runtime (noRotationOrReflection/noScale/noScaleOrReflection)                     |
| Rigging     | Region attachments                                            | ✅         |                                                                                                                  |
| Rigging     | Meshes (tạo lưới, chỉnh vertex, edit UV)                      | ✅         | Phase 8: nút Edit — kéo vertex trong viewport (setup sửa mesh, animate auto-key deform). Chưa thêm/xóa vertex    |
| Rigging     | Weights + weight painting                                     | ✅         | Phase 8: Bind + Auto Weights (theo khoảng cách, ≤4 bone), heatmap xanh→đỏ, brush paint                           |
| Rigging     | Linked meshes                                                 | 📦         |                                                                                                                  |
| Rigging     | Clipping attachments                                          | ✅         | Phase 8: + Clipping tạo slot mask, render mask thật, kéo polygon, chọn end slot                                  |
| Rigging     | Bounding box / Point attachments                              | ✅         | Phase 8: tạo từ Properties, outline viewport, kéo vertex bbox, sửa x/y/rotation point                            |
| Rigging     | Path attachments (composite bezier)                           | ✅         | Phase 9: + Path tạo spline, render curve + anchor/handle, kéo điểm bằng vertex editor                            |
| Rigging     | Skins (tạo, đổi skin, preview)                                | ✅         | Phase 10: section Skins (tạo/nhân bản/xóa, chọn active), renderer resolve active→default, attach vào active skin |
| Rigging     | Import PSD (script Photoshop)                                 | ❌         | Web thay thế bằng import PSD trực tiếp (`ag-psd`)                                                                |
| Constraints | IK (mix, bend, 1–2 bone)                                      | ✅         | Phase 9: softness (soft IK), stretch, compress, uniform                                                          |
| Constraints | Transform constraints                                         | ✅         | mixRotate/X/Y/Scale, local/relative                                                                              |
| Constraints | Path constraints (evaluation)                                 | ✅         | Phase 9: arc-length sampling, modes position/spacing/rotate + timelines position/spacing/mix                     |
| Constraints | Physics constraints (evaluation)                              | ✅         | Phase 9: PhysicsSimulator spring-damper bước cố định 1/60s, deterministic, re-sim khi tua ngược (xấp xỉ runtime) |
| Animate     | Dopesheet (scrub, kéo key, curve preset, copy/paste 1 key)    | ✅         |                                                                                                                  |
| Animate     | Chọn nhiều key / kéo nhóm key / scale time                    | ✅         | Phase 7: box-select, kéo nhóm, copy/paste nhiều key, scale quanh pivot                                           |
| Animate     | Graph editor (kéo bezier control points)                      | ✅         | Phase 7: nút Curve mở panel kéo 2 control point per channel                                                      |
| Animate     | Ghosting (onion skinning)                                     | ✅         | Phase 7: nút Ghost — 2 pose trước (xanh dương) + 2 sau (xanh lá)                                                 |
| Animate     | Playback speed + bước từng frame                              | ✅         | Phase 7: 0.1×–2×, nút ⏴/⏵ + phím ←/→ (frame 1/30s)                                                               |
| Animate     | Draw order timeline                                           | ✅         | Phase 7: evaluate + render; nút ↑/↓ slot trong animate mode key tại playhead                                     |
| Animate     | Slot attachment/color/deform/IK/transform timelines           | ✅         | Evaluator + auto-key (bone) đầy đủ                                                                               |
| Animate     | Event timeline                                                | ✅         | Phase 7: track events trong dopesheet, nút + Event tại playhead                                                  |
| Animate     | Preview view riêng (cửa sổ playback)                          | ❌         | Playback dùng chung viewport                                                                                     |
| Workflow    | Undo/redo, autosave, multi-select, phím tắt, resizable panels | ✅         | Sau đợt nâng cấp UI 07/2026                                                                                      |
| Workflow    | Dockable panels                                               | ❌         | Layout cố định (đã resizable)                                                                                    |
| Workflow    | Tìm kiếm/lọc trong Hierarchy                                  | ✅         | Phase 10: ô search lọc bone/slot                                                                                 |
| Workflow    | Texture packing                                               | 🟡         | Shelf packing ✅; chưa có polygon packing, rotation, strip whitespace                                            |
| Export      | Spine JSON 4.2                                                | ✅         |                                                                                                                  |
| Export      | Binary `.skel`                                                | ❌         |                                                                                                                  |
| Export      | GIF / video / PNG sequence                                    | 🟡         | Phase 10: xuất GIF (gifenc, 20fps, khung viewport); video/PNG sequence chưa làm                                  |
| Import      | Spine JSON                                                    | ✅         |                                                                                                                  |
| Import      | Atlas (`.atlas` + PNG → cắt lại region rời)                   | ✅         | Phase 10: parse cả 2 format libgdx, hỗ trợ rotate + whitespace-strip; goblins render đủ 2 skin                   |

### 6.2. Phase 7 — Công cụ animation chuyên nghiệp ✅ Hoàn thành (07/2026)

> Ghi chú thực hiện: core thêm `computeAnimatedDrawOrder`/`computeDrawOrderOffsets`,
> commands `UpsertDrawOrderKeyframe`/`DeleteDrawOrderKeyframe`/`DeleteEventKeyframe`/
> `TransformBoneKeys` (retime nhóm key `t' = pivot + (t-pivot)·scale + offset`, dịch cả
> bezier handles, 1 bước undo). Dopesheet: box-select, kéo nhóm key, xóa/copy/paste nhiều
> key, scale timing quanh key sớm nhất; track draw order (tím) + events (xanh lá).
> Graph editor (nút Curve) kéo control point trực tiếp, tự nới chiều cao panel.
> Playback speed 0.1×–2×, bước frame ⏴/⏵ + phím ←/→ (1/30s), hiển thị số frame.
> Ghosting 2 pose trước/sau. Nút ↑/↓ của slot trong animate mode key draw order tại
> playhead thay vì sửa setup. Renderer áp dụng thứ tự slot động. MCP thêm 5 tool:
> `shift_keys`, `set_draw_order_keyframe`, `delete_draw_order_keyframe`,
> `delete_event_keyframe`, `set_playback_speed`. Chưa làm: chọn key qua click track
> label; kéo/di chuyển key trên track draw order/event (mới chọn + xóa được).

1. **Graph editor**: view curve dưới dopesheet, vẽ đường cong giữa 2 key của track đang chọn,
   kéo 2 control point bezier trực tiếp (ghi `curve: [cx1,cy1,cx2,cy2,…]` per channel).
2. **Dopesheet nâng cao**: box-select key, kéo nhóm key, xóa/copy/paste nhiều key,
   scale time cả nhóm (co giãn timing), chọn key qua click track label (cả hàng).
3. **Playback**: chỉnh tốc độ (0.1×–2×), bước ←/→ từng frame (theo snap 0.01s), hiển thị FPS/frame.
4. **Ghosting**: render pose tại t±n bước với alpha thấp (tận dụng `computeAnimatedLocals` sẵn có).
5. **Draw order timeline**: `computeAnimatedDrawOrder` trong evaluator + key trong dopesheet + UI offset.
6. **Event track trong dopesheet**: hiển thị + đặt/xóa event key trực tiếp.
7. MCP: `set_curve_bezier`, `shift_keys`, `set_playback_speed`; cập nhật skill spine-animating.

### 6.3. Phase 8 — Mesh & Weights UI ✅ Hoàn thành (07/2026)

> Ghi chú thực hiện: core thêm `weights.ts` (`computeVertexWorldPositions` dùng chung
> renderer/editor, `autoWeightVertices` bind theo khoảng cách tới đoạn xương ≤4 influence,
> `adjustVertexWeight` cho brush, `boneWeightPerVertex` cho heatmap) + command
> `SetAttachmentVertices` (mesh/boundingbox/clipping/path, cả layout weighted).
> Editor: section Attachments trong Properties (kích hoạt/Edit/xóa attachment,
>
> - Bounding Box, + Point, + Clipping tạo slot mask đặt ngay trước slot đích);
>   chế độ mesh-edit trong viewport — kéo vertex (setup sửa vertices, animate auto-key
>   deform trừ deform hiện hành), Esc thoát; section Weights (bind + auto weights,
>   chọn bone paint, brush 30px falloff); renderer vẽ mask clipping thật (Pixi mask),
>   outline bbox/clip/point, vertex handles + heatmap xanh→đỏ. MCP thêm 5 tool:
>   `set_mesh_vertices`, `bind_weights`, `add_clipping`, `add_bounding_box`, `add_point`.
>   Chưa làm: thêm/xóa vertex + retriangulate (delaunay), kéo vertex mesh weighted
>   (chỉnh qua weights), UV editor.

1. **Vertex editing tool**: chế độ Edit Mesh trong viewport — chọn/kéo vertex (setup mode sửa
   `vertices`, animate mode auto-key deform), thêm/xóa vertex + retriangulate (thư viện earcut).
2. **Weights view**: bind bones vào mesh, auto-weights theo khoảng cách, brush paint weight
   (tăng/giảm/smooth), hiển thị heatmap màu theo bone đang chọn.
3. **Clipping**: vẽ polygon clipping trong viewport + render bằng Pixi mask/stencil.
4. **Bounding box & point attachments**: vẽ/hiển thị (outline màu), tạo từ Properties panel.
5. MCP: `set_mesh_vertices`, `set_weights`, `add_clipping`; skill spine-rigging bổ sung quy trình mesh.

### 6.4. Phase 9 — Constraints đầy đủ + độ chính xác evaluator ✅ Hoàn thành (07/2026)

> Ghi chú thực hiện: `pose.ts` — đủ 5 chế độ `inherit` theo logic runtime; IK thêm
> softness (soft IK 2-bone), stretch (scale chuỗi qua upper bone), compress/uniform
> (1-bone). `path.ts` — `PathSpline` (composite bezier, bảng arc-length 20 mẫu/curve),
> `applyPathConstraint` đăng ký vào pipeline computePose theo `order` (position fixed/percent,
> spacing length/fixed/percent/proportional, rotate tangent/chain/chainScale, mixRotate/X/Y);
> evaluator sample timelines position/spacing/mix của path constraint. `physics.ts` —
> `PhysicsSimulator`: spring-damper offset x/y + con lắc góc (inertia/strength/damping/
> gravity/wind/mass/limit), bước cố định 1/60s, tiến incremental khi play, re-simulate từ 0
> khi tua ngược/đổi animation (deterministic); Viewport tự dùng khi có physics constraint.
> Editor: nút + Path (spline mặc định 2 điểm), render curve + anchor vuông/handle tròn,
> sửa điểm path bằng vertex editor sẵn có. MCP thêm 5 tool: `add_path`,
> `add_path_constraint`, `add_physics_constraint`, `add_transform_constraint` (+
> `get_skeleton_tree` trả cả transform/path/physics). Xấp xỉ có chủ đích: physics không
> cam kết trùng số tuyệt đối với runtime chính thức (game chạy mô phỏng thật khi import);
> `constantSpeed: false` của path được coi như true; chainScale scale theo trục X.

1. **Path attachments UI**: vẽ composite bezier spline (thêm/kéo điểm, handle đối xứng), closed path.
2. **Path constraint evaluation**: sample spline theo arc-length; modes `position/spacing/rotate`
   (fixed/percent/length), chain bones bám theo path — đối chiếu kết quả với runtime chuẩn bằng fixture.
3. **Physics constraint evaluation**: spring-damper cho x/y/rotate/scale/shear
   (inertia, strength, damping, gravity, wind, limit); bước mô phỏng cố định (deterministic)
   để preview ổn định; reset state khi scrub ngược.
4. **IK chính xác hoàn toàn**: softness, stretch, compress, uniform.
5. **Bone inherit**: 3 chế độ còn lại đúng theo runtime chuẩn (noRotationOrReflection, noScale, noScaleOrReflection).
6. Nghiệm thu: fixture JSON có path/physics từ tài liệu công khai round-trip + pose khớp số liệu kỳ vọng.

### 6.5. Phase 10 — Skins, Import/Export & Workflow ✅ Hoàn thành (một phần, 07/2026)

> Ghi chú thực hiện: **Đã xong** — commands CreateSkin (kèm copyFrom nhân bản)/RemoveSkin;
> `activeSkin` trong store, renderer resolve attachment theo active skin → default → skin khác
> (kể cả trường `name` của attachment như "goblin/left-foot"); section Skins trong Hierarchy;
> attach ảnh vào skin đang active. `parseAtlas` (core) đọc cả format libgdx cũ (xy/size/orig/
> offset) lẫn Spine 4.x (bounds/offsets), `sliceAtlas` (editor) cắt region qua canvas hỗ trợ
> rotate 90° + whitespace-strip; nút Import Atlas (chọn .atlas + PNG cùng lúc); nghiệm thu
> bằng goblins: import atlas → đổi skin goblin/goblingirl render đầy đủ. Xuất **GIF** qua
> gifenc (20fps, khung viewport, playhead khôi phục sau khi xuất). Ô search lọc bone/slot
> trong Hierarchy. MCP thêm 3 tool: `create_skin`, `switch_skin`, `import_atlas` (47 tools).
> **Chưa làm** — binary `.skel`, import PSD, xuất video/PNG sequence, dockable panels,
> texture packer nâng cấp (rotation/strip), bone color/icon.

1. **Skins UI**: panel Skins (tạo/xóa/nhân bản), chọn active skin để render + đặt attachment
   theo skin; renderer resolve theo active skin thay vì chỉ `default`.
2. **Atlas import**: đọc `.atlas` (libgdx format) + PNG → cắt về texture rời theo region
   (giải quyết việc load sample chỉ có atlas như goblins).
3. **Export ảnh/video**: PNG sequence từ evaluator + đóng gói GIF (gifenc) / WebM (MediaRecorder).
4. **Binary `.skel` 4.2**: writer + reader (spec công khai) — ưu tiên sau JSON vì runtime đọc được JSON.
5. **Import PSD**: `ag-psd`, mỗi layer → image asset + vị trí ban đầu theo layer offset.
6. **Workflow**: search/filter Hierarchy, bone color/icon, dockable panels (flexlayout-react),
   texture packer nâng cấp (rotation, strip whitespace, max size, padding config).
7. MCP: `switch_skin`, `import_atlas`, `export_gif`, `import_psd`.

### 6.6. Nguyên tắc thực hiện chung

- Mỗi feature đi kèm: command undoable trong `core` → UI editor → MCP tool → cập nhật SKILL.md
  → unit test + verify Chromium thật (pattern các phase trước).
- Không nhúng Spine Runtimes; mọi evaluation tự viết, đối chiếu bằng fixture tự tay + số liệu
  từ tài liệu format công khai.
- Ưu tiên đề xuất: **7 → 8 → 9 → 10** (giá trị animation trước, rigging nâng cao sau,
  cuối cùng là hệ sinh thái import/export). Trong từng phase, mục nào độc lập có thể làm song song.

## 7. Backend Python + AI tạo ảnh & auto-rig (Phase 11–14) — kế hoạch

Yêu cầu: repo chia 2 phần **frontend** (editor hiện tại) và **server** (Python); server có
tài khoản (đăng nhập / đăng xuất / quên mật khẩu), danh sách project đã tạo, lưu lịch sử
chat, settings; tích hợp API key AI gen ảnh, gen ảnh tách từng thành phần, AI chat tự tạo
ảnh → tách part → tự dựng rig Spine + chuyển động.

### 7.1. Vì sao Python (thay cho phương án Fastify ban đầu)?

Bản nháp đầu chọn Fastify/Node chỉ vì một lý do: server có thể import thẳng
`@spine-editor/core` (TypeScript) khi cần dựng skeleton headless. Chuyển sang Python
được nhiều hơn mất:

- **Stack AI/vision là Python-first**: `rembg`, SAM 2 (PyTorch), MediaPipe Pose,
  Pillow/OpenCV chạy in-process trong server; bản Node phải qua onnxruntime bindings
  hoặc spawn process Python phụ. Segmentation là phần nặng nhất của toàn pipeline.
- **Điều khiển editor không phụ thuộc ngôn ngữ**: bridge ops là JSON qua WebSocket
  (`ws://localhost:8017`) — Python dispatch 47 ops y hệt MCP server Node đang làm.
  Auto-rig chạy qua editor tab đang mở nên người dùng nhìn thấy từng bước.
- **Đánh đổi chấp nhận được**: Python không tái dùng serializer/command của `core`.
  Khi nào thật sự cần build Spine JSON headless (không mở editor) thì thêm một CLI
  worker Node mỏng (import `core`, nhận ops JSON qua stdin) — hoãn tới lúc có nhu cầu.

### 7.2. Cấu trúc repo & kiến trúc

```
spine_editor/
├── packages/          # FRONTEND — pnpm monorepo hiện tại (editor/core/mcp-server/shared)
└── server/            # SERVER — Python 3.12, FastAPI + uvicorn, quản lý deps bằng uv
    ├── app/main.py        # FastAPI app, CORS cho Vite dev, mount routers
    ├── app/api/           # routers: auth, projects, keys, settings, generate, segment, chat
    ├── app/auth/          # JWT access + refresh, băm argon2id, token quên mật khẩu
    ├── app/db/            # SQLAlchemy 2 + Alembic; SQLite khi dev → Postgres khi deploy
    ├── app/providers/     # adapter gen ảnh: openai | stability | runware | fal (httpx)
    ├── app/segment/       # rembg, SAM 2, MediaPipe Pose — chạy in-process
    ├── app/pipeline/      # job async: ảnh → parts → rig → animation, tiến độ qua ws
    ├── app/chat/          # anthropic SDK (claude-opus-4-8) vòng lặp tool-use, tools = ops
    ├── app/bridge.py      # WebSocket client nói protocol bridge với editor tab
    └── tests/             # pytest + httpx TestClient
```

- Editor ⇄ server: **REST** cho auth/projects/settings/keys, **WebSocket** cho chat
  streaming + tiến độ job.
- Frontend thêm: màn hình đăng nhập/đăng ký/quên mật khẩu, dashboard "My Projects"
  (mở project → vào editor), panel Chat, mở rộng Settings (server URL, API keys, theme).
- Editor **vẫn chạy standalone** không cần server (deploy GitHub Pages như cũ) — server
  là opt-in, phát hiện qua Settings.

### 7.3. Tài khoản, project, chat history, settings (đặc tả Phase 11)

- **Đăng ký / đăng nhập**: email + mật khẩu (băm argon2id); JWT access ngắn hạn (~15')
  giữ trong memory phía client + refresh token trong cookie httpOnly (bảng
  `refresh_tokens`, revoke được từng phiên).
- **Đăng xuất**: revoke refresh token phía server + xóa cookie (đăng xuất mọi thiết bị =
  revoke cả bảng theo user).
- **Quên mật khẩu**: token một lần hết hạn 30' (bảng `password_resets`), gửi qua SMTP
  cấu hình được (dev: in ra log / mailbox giả); response không tiết lộ email có tồn tại
  hay không; rate-limit cả login lẫn forgot-password.
- **Danh sách project**: CRUD theo user — tên, thumbnail (PNG chụp viewport lúc save),
  `updated_at`; nội dung = Spine JSON + assets (file trên đĩa, path trong DB);
  autosave định kỳ từ editor khi đã đăng nhập.
- **Lịch sử chat**: bảng `conversations` + `messages` lưu đủ text lẫn tool_use/
  tool_result — mở lại phiên cũ là tiếp tục đúng ngữ cảnh; gắn conversation với project.
- **Settings per-user**: theme, provider gen ảnh mặc định, tham số gen; API keys BYOK ở
  bảng riêng `api_keys`, mã hóa AES-256-GCM bằng secret trong env server, masked khi
  liệt kê, không bao giờ trả full key về client.
- Schema: `users, refresh_tokens, password_resets, projects, assets, api_keys, settings,
conversations, messages, jobs`.

### 7.4. Khảo sát provider (07/2026)

| Nhu cầu                    | Lựa chọn chính                                                           | Ghi chú                                                       |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Gen ảnh nền trong suốt     | OpenAI `gpt-image-1.5` (`background: "transparent"`)                     | `gpt-image-2` KHÔNG hỗ trợ transparent — phải route về 1.5    |
| Gen ảnh alpha gốc          | LayerDiffuse (qua Runware API hoặc self-host diffusers)                  | alpha sinh trong latent, tóc/viền sạch hơn remove-bg          |
| Sửa/inpaint/xóa nền cloud  | Stability AI (stable-image: inpaint, remove-bg, search-and-replace)      | rẻ, endpoint rời từng thao tác                                |
| Xóa nền local, free        | `rembg` (MIT, U2-Net/IS-Net) — thư viện Python, import trực tiếp         | mặc định không cần key; CPU ~10s/ảnh                          |
| Segmentation theo điểm/box | SAM 2/3 (Apache-2.0) — PyTorch self-host hoặc fal.ai API                 | prompt point/box từ pose landmark → mask từng part            |
| Pose landmark (khớp xương) | MediaPipe Pose (package Python chính chủ)                                | vị trí khớp → sinh bone + điểm prompt SAM                     |
| AI chat điều khiển editor  | Claude API `claude-opus-4-8`, anthropic Python SDK, tool-use + streaming | tools = 47 ops bridge sẵn có; adaptive thinking               |
| Tham chiếu auto-rig        | Meta Animated Drawings (open source, Python)                             | pipeline mẫu: detect → segment → joints → rig → preset motion |

### 7.5. Pipeline "prompt → nhân vật Spine chuyển động"

Hai chiến lược tách thành phần, làm cả hai và cho người dùng chọn:

- **A. Gen-từng-part** (chất lượng cao nhất): gen ảnh full-body T-pose trước làm tham
  chiếu style, rồi gọi edit/reference-image endpoint gen từng part (đầu, thân, 2 tay ×
  2 khúc, 2 chân × 2 khúc…) nền trong suốt, cùng style — tránh style drift.
- **B. Gen-rồi-tách** (nhanh, dùng được với ảnh upload): gen (hoặc nhận) 1 ảnh
  full-body → MediaPipe tìm khớp → SAM prompt point/box theo từng chi → mask từng part
  → cắt PNG rời → inpaint phần bị che khuất (vd. thân sau cánh tay).

Sau khi có parts (PNG rời + vị trí gốc + landmark khớp):

1. **Auto-rig** (server dispatch ops qua bridge): dựng chuỗi bone theo landmark
   (hip→spine→head, 2 tay, 2 chân — quy ước +X dọc bone như skill rigging),
   `import_image` + `attach_image` từng part, `set_draw_order` theo thứ tự che khuất,
   IK 2-bone cho tay/chân, mesh + `bind_weights` cho part bắc qua 2 bone.
2. **Auto-animate**: thư viện preset (idle/walk/run/jump/wave) lưu dạng timeline tương
   đối theo tên bone chuẩn → retarget sang rig vừa dựng (map vai trò bone, scale theo
   độ dài chi); chuyển động tự do ("vẫy tay chào") thì AI chat tự đặt keyframe qua ops.
3. Người dùng xem preview, sửa tay bằng UI sẵn có, xuất Spine JSON/GIF như hiện tại.

### 7.6. Các phase

#### Phase 11 — Server nền tảng + tài khoản (`server/`) ✅ Hoàn thành (07/2026)

> Ghi chú thực hiện: FastAPI + SQLAlchemy 2 (SQLite, `create_all` khi khởi động — Alembic
> để khi cần migration thật; Python 3.11+ thay vì 3.12 theo môi trường). Auth đủ theo đặc
> tả 7.3: argon2id, JWT access 15' (ký bằng khóa dẫn xuất SHA-256), refresh cookie httpOnly
> path `/api/auth` xoay vòng single-use, logout revoke, forgot/reset (token 30', outbox
> log khi chưa cấu hình SMTP, không lộ email tồn tại, rate-limit in-memory 10 req/phút).
> Key vault AES-256-GCM (nonce 12 byte, masked last4). Projects CRUD lưu nguyên payload
> `spine-editor-project` (assets data-URL nằm trong JSON — bảng assets rời để khi cần).
> Frontend: `src/server/api.ts` (fetch wrapper tự refresh 1 lần khi 401) + `useServer`
> store; ServerModal (URL + Test, 4 tab Sign in/Register/Forgot/Reset, quản lý key
> masked); ProjectsModal (Save/Save-as-new + thumbnail chụp viewport 200px, Open, xóa);
> autosave lên server debounce 3s khi đã bind project. 10 pytest + e2e Chromium thật
> (`packages/editor/e2e/server.mjs`: đăng ký → lưu key → save project → reload giữ phiên
> qua cookie → open lại đủ bones → forgot/reset qua outbox → đăng nhập lại). CI thêm job
> `server` (uv + ruff check/format + pytest). Settings per-user endpoint có sẵn, UI theme/
> provider mặc định sẽ dùng ở Phase 12.

1. Scaffold FastAPI + uvicorn + SQLAlchemy + pytest + ruff; `uv` quản lý deps;
   CI thêm job Python (ruff + pytest) chạy song song job Node.
2. Auth đầy đủ theo đặc tả 7.3: đăng ký, đăng nhập, đăng xuất, quên mật khẩu, refresh.
3. Project CRUD + danh sách + thumbnail + autosave; upload/serve assets.
4. Settings per-user + key vault BYOK (mã hóa AES-256-GCM).
5. Frontend: màn hình Login/Register/Forgot, dashboard My Projects, Settings mở rộng;
   editor Open/Save lên server (giữ export file như cũ).

#### Phase 12 — Tích hợp AI gen ảnh ✅ Hoàn thành (07/2026)

> Ghi chú thực hiện: `app/providers/` — interface `ImageProvider` (generate → PNG bytes,
> `supports_transparent`, `approx_cost_usd`) + 5 adapter: `openai` (gpt-image-1.5,
> `background: transparent` — gpt-image-2 không hỗ trợ), `stability` (stable-image core,
> không alpha), `runware` (LayerDiffuse alpha gốc), `fal` (FLUX schnell), `mock` (PNG
> phẳng sinh local, free — dùng cho test/e2e/thử UI). Key giải mã từ vault ngay trước
> call, không log/echo. REST: `POST /api/generate` (chặn transparent với provider không
> hỗ trợ, 400 khi thiếu key, 502 khi provider lỗi), gallery `GET/GET id/DELETE`
> (ảnh lưu data-URL trong DB để sống sót đĩa ephemeral của Render),
> `GET /api/generate/providers` (has_key/cost/capability cho dialog). Editor: nút
> Generate trên toolbar → dialog prompt + checkbox "Game-asset template" (bọc prompt
> T-pose/flat-shading/nền trong suốt), chọn provider/size/transparent, hiện ước tính
> chi phí trước khi gọi, preview nền caro, "Add to Images" đặt tên từ prompt, gallery
> import/xóa. MCP tool thứ 48: `generate_image` (chạy qua phiên đăng nhập của editor
> tab, import thẳng thành asset). 4 pytest mới (guards, gallery per-user); e2e
> server.mjs thêm luồng generate mock → import asset. Rate limit auth cấu hình được
> (`SPINE_SERVER_AUTH_RATE_LIMIT`). **Chưa làm** — edit/inpaint/reference-image
> (Phase 13 dùng cho chiến lược A), remove-background Stability (Phase 13).

1. Interface `ImageProvider` (generate / edit / inpaint / remove_background) + adapters
   `openai` (gpt-image-1.5 transparent), `stability`, `runware` (LayerDiffuse), `fal`.
2. Prompt template game asset: T-pose/A-pose, side-view, flat shading, nền trong suốt,
   khung part-sheet; tham số style thống nhất giữa các lần gọi.
3. UI: dialog "Generate Image" (prompt, provider, size) → gallery theo user → import
   làm asset một click; ước tính chi phí trước khi gọi.
4. MCP tool `generate_image` (proxy qua server) để agent ngoài cũng dùng được.

#### Phase 13 — Tách thành phần (segmentation) ✅ Slice 1 hoàn thành (07/2026)

> Ghi chú thực hiện (slice 1 — chiến lược B end-to-end): `server/app/segment/` —
> `parts.py` (PART_RECIPES 10 part từ landmarks, thuần logic), `engines.py` (rembg
> in-process + MediaPipe Tasks PoseLandmarker, model cache `server/data/models/`,
> env `SPINE_SERVER_SEGMENT_FAKE=1` thay bằng fake deterministic cho test/e2e/CI),
> `backends.py` (protocol `SegmentBackend`: `FalSam2Backend` gọi `fal-ai/sam2/image`
> BYOK + `MockBackend` free), `cutout.py` (mask → crop RGBA + tọa độ gốc). REST
> `/api/segment`: remove-bg, pose (kèm prompts gợi ý), parts (auto hoặc custom
> prompts, guards: thiếu fal key 400 / provider 502 / không thấy người 422 / >4096px
> 400 / >20 part 400), backends. Editor: nút Segment → dialog review (overlay màu
> từng part, đổi tên, click thêm fg point / Alt+click bg point, re-run từng part,
> xóa), Import parts thành assets kèm `origin` (round-trip qua project JSON) + "Place
> on canvas" tạo slot+attachment đúng vị trí trong 1 Composite undo. 21 pytest mới +
> e2e server.mjs (fake engines): 10 part, rename, import, slot, origin — đều pass.
> **Chưa làm (slice 2)**: inpaint phần che khuất, chiến lược A gen-từng-part, MCP
> tool `segment_image`, SAM local (torch).

1. `rembg` in-process mặc định (không cần key) cho remove-bg.
2. MediaPipe Pose → khớp + bounding box từng chi.
3. SAM 2: chạy PyTorch local (GPU nếu có, checkpoint tải lần đầu) hoặc fal.ai BYOK —
   prompt point/box từ landmark → mask từng part; chiến lược B hoàn chỉnh kèm inpaint.
4. Chiến lược A: orchestration gen-từng-part với ảnh tham chiếu.
5. UI review masks: overlay từng part, sửa nhanh (thêm/bớt point prompt), đặt tên part
   → "Import parts" thành assets kèm vị trí gốc.

#### Phase 14 — AI chat auto-rig & auto-animate

1. Chat panel trong editor (streaming, hiển thị tool call, lưu/khôi phục history);
   server chạy vòng lặp tool-use anthropic SDK (`claude-opus-4-8`, adaptive thinking)
   với tools = ops bridge + `generate_image` + `segment_image` + `rig_from_parts`.
2. `rig_from_parts`: auto-rig từ landmark + parts (mục 7.5) thành một op server-side.
3. Preset motion library + retarget; op `apply_preset_animation`.
4. Nghiệm thu end-to-end: một câu chat "tạo nhân vật hiệp sĩ và cho nó đi bộ" → gen ảnh
   → tách part → rig → walk cycle trong viewport; e2e Chromium thật (mock provider để
   CI không cần key/GPU).

### 7.7. Rủi ro & giảm thiểu

- **Hai ngôn ngữ trong repo** → tách hẳn `server/` với toolchain riêng (uv, ruff,
  pytest), CI hai job độc lập; protocol chung định nghĩa bằng JSON schema trong
  `packages/shared` để hai bên cùng đối chiếu.
- **Style drift giữa các part gen riêng** → luôn gen ảnh tham chiếu trước, dùng
  edit/reference endpoint; fallback chiến lược B.
- **Segmentation sai ở khớp/che khuất** → human-in-the-loop mọi bước (UI sửa mask, sửa
  bone), inpaint phần khuất; không hứa "1 click hoàn hảo".
- **Bảo mật tài khoản & key** → argon2id, rate-limit auth, refresh token revoke được,
  key mã hóa at rest + không log/echo; server mặc định bind localhost khi self-host.
- **Chi phí API của người dùng** → hiện estimate trước khi gọi, cache kết quả, mặc định
  rembg local free.
- **License**: SAM 2 Apache-2.0, rembg MIT, MediaPipe Apache-2.0 — tương thích license
  Apache-2.0 của repo. Vẫn tuyệt đối không nhúng Spine Runtimes.
- **CI không có key/GPU** → provider mock + fixture ảnh nhỏ cho unit/e2e.
