# Phase 21 — Views phụ + polish (design)

Ngày: 2026-07-11 · Nhánh: `claude/phase21-views` · Trạng thái: đã duyệt design, chờ review spec

## 1. Mục tiêu

Theo PLAN.md §8 row 21, sáu hạng mục: **Slot Color view**, **tint black**
(evaluate + renderer — model/serializer đã có từ Phase 1), **Metrics view**,
**Welcome screen**, **Settings**, **hotkeys Spine-style**.

Quyết định đã chốt: 1 PR; MCP `set_slot_color` mới + `set_slot_color_keyframe`
nhận `dark` → **63 tools**; hotkey mapping B/N/G/C/V/X/Z như §7.

## 2. Ngoài scope (YAGNI)

- Key màu từ Color window khi auto-key (dùng dopesheet/MCP).
- Theme sáng; per-user settings đồng bộ server; đổi hotkey trong Settings.
- Sequence timelines (vẫn round-trip untouched).

## 3. Core — slot color + tint black

- `SetSlotProperties` (commands/slots.ts) nhận thêm trong patch:
  - `color?: string` — 8-hex RRGGBBAA, validate regex `^[0-9a-fA-F]{8}$`.
  - `dark?: string | null` — 6-hex RRGGBB bật tint black, `null` tắt (xóa field).
  - Snapshot-restore undo như hiện tại; validate-then-mutate.
- `evaluate.ts`:
  - `computeAnimatedColors` đọc thêm `rgba2` (light của SpineTwoColorKey ghi đè
    light khi timeline rgba2 tồn tại) — giữ hành vi cũ khi chỉ có rgba/alpha.
  - Hàm mới `computeAnimatedDarkColors(data, animationName, time): Map<string, string>`
    — sample `rgba2`/`rgb2` trả dark 6-hex per slot (nội suy linear/stepped/bezier
    per-channel như sampleColorTimeline; fallback setup `slot.dark`).
  - `evaluateAnimation`/hàm tổng (nếu có chỗ gom `colors:`) thêm `darkColors`.
  - Header file: bỏ "two-color (rgba2/rgb2)" khỏi danh sách Not evaluated.
- Tests: SetSlotProperties color/dark (set, tắt bằng null, validate sai hex throw,
  undo); computeAnimatedDarkColors sample giữa 2 key; round-trip slot.dark +
  rgba2 key qua serialize/parse (fixture nhỏ trong test).

## 4. Renderer — tint black (ColorMatrixFilter)

- `RenderInput` thêm `slotDarks?: ReadonlyMap<string, string>` (animate mode).
- Trong vòng render slot: `dark = input.slotDarks?.get(slot.name) ?? slot.dark`.
  - Có dark: light = animColor (như hiện tại, 8-hex). Đặt `tint = 0xffffff`,
    `alpha = light.a`, gắn **ColorMatrixFilter** với matrix:
    `R' = tex.R×(lR−dR) + dR` (tương tự G/B; hàng alpha giữ nguyên) — đúng công
    thức Spine `out = tex×light + (1−tex)×dark`.
  - Filter cache `Map<string, ColorMatrixFilter>` theo slot trong SceneRenderer
    (tạo 1 lần, update `.matrix` mỗi frame khi giá trị đổi; gỡ filter + xóa entry
    khi slot hết dark; destroy() dọn map).
  - Không dark: đường `tintOf` hiện tại (không filter).
- Viewport `buildRenderInput` truyền `slotDarks: animating ? computeAnimatedDarkColors(...) : undefined`.

## 5. Editor windows (pattern floating hiện có: drag header, localStorage pos, z-index 25)

### 5.1. ColorWindow (`components/ColorWindow.tsx`, Views ▾ → Color; nút "Color…" trong SlotDock)

- Theo slot đang chọn (selection kind `slot`; bone/khác → "Select a slot in the tree.").
- Chỉ sửa **setup**: `<input type="color">` RGB + slider Alpha 0–255 (ghép 8-hex →
  `SetSlotProperties {color}`); toggle **Tint black** — bật với dark mặc định
  `'000000'` (out = tex×light, không đổi hình ảnh cho tới khi chỉnh), tắt →
  `dark: null`; `<input type="color">` dark hiện khi bật. Mỗi change = 1 command
  (undo được).
- Animate mode: các control disable + dòng "Setup colors only — key colors via
  the dopesheet or set_slot_color_keyframe."

### 5.2. MetricsWindow (`components/MetricsWindow.tsx`, Views ▾ → Metrics)

- Bảng 2 cột, cập nhật theo `revision`: Bones, Slots, Skins, Attachments theo
  loại (region/mesh/boundingbox/path/point/clipping — đếm mọi skin), IK/Transform/
  Path/Physics constraints, Events, Animations, Images, Audio, Mesh vertices
  (tổng vertexCount), Mesh triangles (tổng triangles/3). Số liệu từ `doc.data` +
  `assets`/`audioAssets`.

### 5.3. SettingsWindow (`components/SettingsWindow.tsx`, Views ▾ → Settings)

- Store mới `settings: { fps: 24 | 30 | 60; autosave: boolean; welcome: boolean }`
  (default `{ fps: 30, autosave: true, welcome: true }`), action
  `setSettings(patch)`; persist **localStorage** key `spine-editor.settings`
  (load khi tạo store; KHÔNG vào project payload).
- FPS thay hằng 30 tại: `stepFrame` (store), ô Current (TimelinePanel `/30`),
  ghost spacing (`spacingFrames / 30` trong Viewport buildGhosts) — dùng
  `settings.fps`.
- Autosave: App.tsx subscribe check `settings.autosave` trước khi lập timer
  (server autosave giữ nguyên — chỉ local IndexedDB).
- Welcome: checkbox đồng bộ với WelcomeScreen (§5.4).

### 5.4. WelcomeScreen (`components/WelcomeScreen.tsx`, overlay z-index 30)

- Hiện khi mount App và `loadAutosave()` trả null VÀ `settings.welcome` true.
- Nội dung: tên app + phiên bản, 3 nút: **New Project** (đóng), **Open Project…**
  (mở file picker .json — tái dùng handler Toolbar qua ref/callback chung: đưa
  `onOpenProject` thành hàm export từ `state/actions.ts` nhận File), **Import
  Spine JSON…**; khu **Server projects** khi `useServer` có user: list tên
  (click → mở như ProjectsModal), nếu chưa đăng nhập: nút "Server…" mở ServerModal.
- Checkbox "Show on startup" → `setSettings({welcome})`. Nút ✕ đóng.
- **E2E**: 4 script (smoke/anim/bridge/chat) thêm 1 dòng
  `page.addInitScript(() => localStorage.setItem('spine-editor.settings', JSON.stringify({fps:30,autosave:true,welcome:false})))`
  trước `page.goto` — không đổi selector nào khác. server.mjs kiểm tra nếu cũng
  goto editor thì thêm tương tự.

## 6. Hotkeys (App.tsx keydown; guard: bỏ qua khi target là input/textarea/select/contentEditable)

| Phím | Hành động                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B    | Toggle `viewFilters.bones.visible`                                                                                                                                |
| N    | Toggle `viewFilters.bones.labels` (tên bone)                                                                                                                      |
| G    | Toggle `anim.ghost` (animate mode)                                                                                                                                |
| C    | `setTool('create')` (alias phím 6)                                                                                                                                |
| V    | `setTool('select')` (alias phím 1)                                                                                                                                |
| X    | Cycle `axesMode`: local → parent → world → local                                                                                                                  |
| Z    | Zoom viewport về 100% (qua API zoom tuyệt đối sẵn có của SceneRenderer — hàm ZoomControl đang dùng; truy cập qua bridgeRuntime.renderer, no-op nếu chưa sẵn sàng) |

- Guard input: handler hiện tại chưa có → thêm đầu handler:
  `const t = e.target as HTMLElement; if (t.closest('input, textarea, select, [contenteditable]')) return;`
  (đặt TRƯỚC mọi nhánh, kể cả 1-6 hiện có — sửa luôn lỗi tiềm ẩn gõ số trong ô số bị đổi tool).
- `SHORTCUTS` (shortcuts.ts) thêm 7 dòng để bảng ? hiển thị.

## 7. MCP + bridge

- BRIDGE_OPS +1 `set_slot_color`; TOOL_DEFS 62 → **63** (shared test count).
- `set_slot_color { slot, color?, dark? }` — color 8-hex, dark 6-hex hoặc chuỗi
  rỗng/`"none"` để tắt (map → null); gọi SetSlotProperties; trả
  `{ color, dark }` sau khi set.
- `set_event_keyframe`… (không đổi). `set_slot_color_keyframe` thêm param
  optional `dark: z.string().optional()` — khi có, ghi key **rgba2**
  `{ time?, light: color, dark }` (UpsertSlotColorKeyframe mở rộng nhận
  timeline đích rgba|rgba2 — command hiện có mở rộng thêm tham số, undo giữ).
- bridge.mjs: sau bước audio — `set_slot_color { slot: flagSlot.slot, color:
'ff8800ff', dark: '332211' }` + `set_slot_color_keyframe { ..., dark }` →
  export: `slots[].color === 'ff8800ff' && slots[].dark === '332211'` và
  `animations.flutter.slots[...].rgba2` tồn tại → summary `slotColorWorks: true`.

## 8. Verify

- Core tests mới (~8): SetSlotProperties color/dark/validate/undo,
  computeAnimatedDarkColors, rgba2 key qua UpsertSlotColorKeyframe, round-trip.
- Battery 4 e2e + `slotColorWorks: true`, `toolCount: 63`; pytest không đổi.
- Manual: đổi màu slot thấy viewport đổi; bật tint black thấy vùng tối đổi màu;
  Metrics đúng số; Welcome hiện lần đầu (xóa IndexedDB) và tắt được; đổi FPS 60
  thấy step frame mịn hơn; 7 hotkeys chạy, không fire khi gõ trong ô số.
- Docs: CLAUDE.md (Phase 21 done, 63 tools, Next: phase 22), PLAN.md row 21 ✅.

## 9. Rủi ro & xử lý

- **ColorMatrixFilter per slot tốn fillrate khi nhiều slot dark** — chấp nhận
  (editor preview; filter chỉ gắn khi dark bật).
- **Welcome che e2e** — xử lý bằng addInitScript settings (5.4); nếu sót script
  nào, welcome chỉ hiện khi không autosave nên bridge/chat (tự new_project) vẫn
  cần init — thêm đủ 4 file + server.mjs nếu goto.
- **Guard input cho hotkeys đổi hành vi phím 1-6 khi đang gõ** — là sửa lỗi
  mong muốn (trước đây gõ "3" trong ô số đổi tool Rotate), ghi rõ trong PR.
- **Đổi FPS ảnh hưởng ô Current đang hiển thị frame** — giá trị hiển thị đổi
  theo (frame = time × fps) — đúng kỳ vọng.
