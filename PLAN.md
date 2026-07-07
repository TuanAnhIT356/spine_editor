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

### Phase 4 — Tính năng nâng cao

- Mesh attachment: tạo lưới, chỉnh vertex, **weights** (bind bone, paint weight).
- IK constraints + timeline IK.
- Events + event timeline.
- **Texture atlas packer**: xuất `.atlas` (format libgdx) + PNG.
- Import file Spine JSON có sẵn để chỉnh sửa.

### Phase 5 — MCP + Skill cho AI _(có thể làm song song từ sau Phase 1)_

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

### Phase 6 — Hoàn thiện

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
