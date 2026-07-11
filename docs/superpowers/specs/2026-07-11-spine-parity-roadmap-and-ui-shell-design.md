# Spec: Lộ trình Spine-parity (Phase 15–22) + Phase 15 — UI Shell

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Nguồn nghiên cứu**: esotericsoftware.com — spine-in-depth, spine-user-guide (TOC
  đầy đủ), spine-ui, spine-tools, spine-preview, spine-dopesheet; 5 screenshot Spine
  (Tree/Weights/IK panel/Graph/Dopesheet) do user cung cấp; inventory code hiện tại.
- **Phạm vi spec này**: (1) gap matrix + roadmap 8 phase ghi vào PLAN.md §8;
  (2) chi tiết **Phase 15 — UI Shell** (slice U1) để lập plan ngay.

## 1. Gap matrix (tóm tắt nghiên cứu)

Năng lực lõi đã ngang Spine: bones/slots + đủ 6 loại attachment, 4 loại constraint
(IK softness/stretch, transform, path arc-length, physics preview), mesh + weights +
auto-weights, skins, events, draw order, dopesheet + graph bezier + ghosting +
auto-key, atlas import/export, GIF export. Lợi thế riêng: AI gen/segment/chat,
auto-rig, server accounts.

Khoảng cách chính:

| Nhóm              | Spine có, ta chưa                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UI paradigm**   | Tree hợp nhất bên phải (bones lồng slots/attachments + sections Constraints/Skins/Events/Animations) với cột visibility + icon màu; properties dock ở đáy tree; mode banner trong viewport; cụm tool + ô số transform + trục Local/Parent/World + filter matrix ở đáy viewport; breadcrumb; Views dropdown; tab Graph/Dopesheet với toolbar Sync/Shift/Offset/Adjust + Current/Loop Start/End; key tick màu theo loại timeline |
| **Views**         | Preview (blend/crossfade đa track), Playback, Audio (waveform), Metrics, Slot Color, Welcome, Settings, Texture Packer settings                                                                                                                                                                                                                                                                                                |
| **Features**      | add/remove mesh vertex, tint black, PSD import, binary .skel, video/PNG-sequence export, hotkeys kiểu Spine (B/N/G/C/V/X/Z), numeric entry `+`/`*`/`/`, compensation buttons (Images/Bones)                                                                                                                                                                                                                                    |
| **Ngoài phạm vi** | Sliders constraint (Spine 4.3 — ta target 4.2), multiple skeletons/project, CLI, Skeleton Viewer                                                                                                                                                                                                                                                                                                                               |

## 2. Roadmap Phase 15–22 (ghi vào PLAN.md §8)

Nguyên tắc: nhái bố cục/hành vi, **tự vẽ icon SVG riêng** (không copy asset Esoteric);
core chỉ thêm không sửa semantics; mỗi phase một spec→plan→PR; 4 e2e
(smoke/anim/bridge/chat) xanh sau mỗi phase (cập nhật selector khi UI đổi).

| Phase  | Tên                                | Nội dung chính                                                                                                                                                                                                                                                                 |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **15** | UI Shell (U1)                      | Theme + titlebar + mode banner + cụm tool đáy viewport + breadcrumb + zoom + Views dropdown (chi tiết §3)                                                                                                                                                                      |
| **16** | Unified Tree (U2)                  | Tree hợp nhất phải (bones lồng slots/attachments, sections Constraints/Skins/Events/Animations/Images), cột visibility, icon màu, search+filter, rename inline, context menu; properties dock đáy tree theo selection (đúng field trong screenshot); thay Hierarchy+Properties |
| **17** | Animate dock (U3)                  | Tab Graph/Dopesheet + toolbar (Sync, copy/paste key, filter, lock, Shift/Offset/Adjust, Current/Loop Start/End) + transport; dopesheet key tick màu theo loại, trắng = trùng frame, đường nối theo interpolation (thẳng/cong/chấm), hàng tổng diamond                          |
| **18** | Preview + Playback + Ghosting view | Bộ trộn track trong core (TrackEntry-style: speed/mix/repeat/alpha/hold-previous/additive, 4 track); view Preview (danh sách animations, controls per-track), Playback view, Ghosting view                                                                                     |
| **19** | Weights view + Mesh tools          | Panel Weights chuẩn (Influence/Prune, Direct/Update, Smooth/Auto/Weld, bảng bones màu, Bind/Swap/Remove, Pies/Overlay/Selected); add/remove mesh vertex (đóng gap §6); Mesh Tools                                                                                              |
| **20** | Audio view                         | Asset audio, waveform trong dopesheet, event volume/balance, scrub có tiếng                                                                                                                                                                                                    |
| **21** | Views phụ + polish                 | Slot Color view; tint black (model+serializer+renderer); Metrics view; Welcome screen; Settings; hotkeys Spine-style                                                                                                                                                           |
| **22** | IO pack                            | PSD import (`@webtoon/psd` client-side), binary .skel import/export, video/PNG-sequence export, Texture Packer settings dialog                                                                                                                                                 |

## 3. Phase 15 — UI Shell (U1), chi tiết

Mục tiêu: mở editor lên **nhìn ra Spine ngay** — chrome, cụm tool, banner, breadcrumb —
mà chưa đụng Hierarchy/Properties/Timeline (U2/U3).

### 3.1. Theme tokens

- `styles.css` chuyển sang CSS variables ở `:root`: `--bg` (nền app), `--panel`,
  `--panel-2` (đậm hơn), `--border`, `--text`, `--text-dim`, `--accent`
  (xanh selection kiểu Spine), `--warn`. Palette xám Spine (panel ~#3a3d40,
  viewport checkerboard giữ nguyên, chữ 12px). Các rule hiện có đổi sang dùng token
  (thay giá trị hex trùng lặp); KHÔNG đổi class name trong slice này trừ nơi nêu rõ.

### 3.2. Titlebar (thay `Toolbar.tsx` phần trên)

- Trái → phải: logo chữ `spine editor` nhỏ; nút **menu ☰** mở dropdown chứa toàn bộ
  mục file hiện là button chữ (New, Open Project, Save Project, Import Images,
  Import JSON, Import Atlas, Export JSON, Export Atlas) — các button chữ cũ bỏ khỏi
  titlebar; icon **Open / Save / Undo / Redo**; tên project + dấu `*` khi dirty
  (doc.history có thay đổi chưa save — dùng revision so với lần save gần nhất,
  lưu `savedRevision` trong store khi Save/Open/New).
- Phải: giữ nguyên cụm **Server / Projects / Generate / Segment / Chat** (text button,
  e2e phụ thuộc) + dropdown **Views ▾** (checkbox toggle: Hierarchy, Properties,
  Timeline — store `panelVisibility`, mặc định tất cả bật; mục Timeline disabled ở
  setup mode; nền cho views sau).
- Tool buttons (Select/Translate/Rotate/Create) và Undo/Redo chữ RỜI titlebar —
  tool xuống cụm đáy viewport (§3.4), Undo/Redo thành icon titlebar.

### 3.3. Mode banner (trong viewport, góc trên-trái)

- `.mode-banner`: icon người + chữ **SETUP** / icon chạy + chữ **ANIMATE** (SVG tự
  vẽ, chữ lớn mờ kiểu Spine); click → toggle mode (gọi `setMode` hiện có).
- Thay thế `.modes` buttons cũ trên toolbar; e2e `anim.mjs` đổi selector sang
  `.mode-banner` (bấm toggle).

### 3.4. Cụm tool đáy viewport (floating, giữa)

- **Hàng breadcrumb** (trên cụm): chuỗi `root ▸ hip ▸ …` của primary bone selection
  (đi ngược parent chain); click phần tử = select bone đó; ẩn khi không chọn bone.
- **Cột tool** (trái cụm): Select, Translate, Rotate, **Scale (mới)**, **Shear
  (mới)**, Create — 6 nút icon+chữ; Scale/Shear là viewport tool mới: drag đổi
  scaleX/scaleY (shear tương tự) qua `SetBoneTransform` (setup) / auto-key path hiện
  có (animate). Create vẫn setup-only. Giữ text label để e2e (`button:has-text`)
  còn dùng được.
- **4 ô số transform** (giữa): Rotate (1 ô), Translate (x,y), Scale (x,y), Shear
  (x,y) — hiển thị live transform LOCAL của primary bone; gõ giá trị + Enter ghi
  (setup → `SetBoneTransform`; animate + Auto Key bật → key offset như drag viewport
  — tái dùng chính helper auto-key trong `Viewport.tsx`); hỗ trợ tiền tố `+5`
  (cộng), `*2` (nhân), `/2` (chia) như docs Spine; mỗi ô có nút key nhỏ bên phải
  (animate: key giá trị hiện tại tại playhead).
- **Trục**: toggle 3 nút **Local / Parent / World** — store `axesMode`
  (mặc định Local); Translate drag di theo trục đã chọn; Rotate hiển thị theo trục.
  (World = trục màn hình; Parent = hệ bone cha; Local = hệ bone.)
- **Filter matrix** (phải cụm): 3 hàng **Bones / Images / Others** × 3 cột
  (🖱 selectable, 👁 visible, 🏷 labels) — store `viewFilters`; Viewport tôn trọng:
  hit-test bỏ qua nhóm tắt selectable; renderer ẩn nhóm tắt visible; labels = vẽ tên
  bone cạnh gốc xương (renderer thêm text layer, mặc định off). "Others" =
  bbox/point/clipping/path outline.
- **Auto Key** (chỉ animate): nút toggle bật/tắt — store `autoKey` (mặc định BẬT,
  giữ hành vi hiện tại); khi TẮT, drag viewport + ô số ở animate không làm gì và
  hiện hint "Auto Key đang tắt". (Pose-tạm-không-key đúng kiểu Spine cần overlay
  pose tạm trên evaluator — chuyển sang Phase 17.)

### 3.5. Zoom (góc dưới-trái viewport)

- Slider dọc + nút `+`/`−`/fit; drive `renderer.zoom` quanh tâm viewport (thêm
  method `setZoomCenter(zoom)` cạnh `zoomAt` hiện có); đồng bộ 2 chiều khi wheel-zoom.

### 3.6. Icons

- `components/icons.tsx`: bộ SVG inline tự vẽ (menu, open, save, undo, redo, select,
  translate, rotate, scale, shear, create, setup-figure, animate-figure, eye, tag,
  cursor, key) — stroke đơn sắc `currentColor`, 14–16px. Không dùng asset Esoteric.

### 3.7. E2E + kiểm chứng

- Cập nhật `smoke.mjs`/`anim.mjs`: selector tool (`.tool-cluster button:has-text`),
  mode (`.mode-banner`), timeline "New" giữ nguyên. `bridge.mjs`/`chat.mjs` không
  đụng UI toolbar → chỉ chạy xác nhận.
- Nghiệm thu: 4 e2e xanh; screenshot smoke đối chiếu bố cục (banner, cụm tool,
  breadcrumb, zoom hiện diện đúng vị trí); suites + pytest xanh; ô số transform
  round-trip (gõ 45 vào Rotate → bone quay 45°, undo được).

### 3.8. Không làm trong U1

- Tree hợp nhất, properties dock (U2); animate dock/tab (U3); Pose/Weights tool;
  smart selection không-tool; docking kéo-thả panel; compensation buttons
  (Images/Bones — vào U2 cùng properties); hotkeys B/N/G/C/V/X/Z (Phase 21).
