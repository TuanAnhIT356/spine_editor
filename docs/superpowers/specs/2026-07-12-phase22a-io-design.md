# Phase 22a — Editor IO: PSD import, Texture Packer settings, video/PNG export (design)

Ngày: 2026-07-12 · Nhánh: `claude/phase22a-io` · Trạng thái: đã duyệt design, chờ review spec

## 1. Mục tiêu

Slice 1/2 của Phase 22 (IO pack, PLAN.md §8 row 22). Slice này gồm 3 hạng mục
thuần editor: **PSD import** (`@webtoon/psd`), **Texture Packer settings**
(AtlasDialog + `buildAtlas` options), **video/PNG-sequence export** (tái dùng
vòng lặp GIF). Slice 22b (binary .skel import/export trong core) có chu trình
spec/plan riêng sau khi 22a merge.

Quyết định đã chốt: 2 slice; MCP `import_psd` trong slice này → **64 tools**
(`export_skel` sẽ vào 22b → 65).

## 2. Ngoài scope (22a)

- Binary .skel (slice 22b). MP4 (encoder wasm quá nặng — WebM đủ).
- PSD: group→bone mapping, blend modes, adjustment layers, text layers
  (chỉ layer ảnh raster; layer ẩn bỏ qua).
- Atlas multi-page settings (buildAtlas 1 trang như hiện tại; maxSize chỉ chặn
  kích thước trang), rotation packing.

## 3. Dependencies mới (đều MIT, client-side)

- `@webtoon/psd` — parse PSD trong browser (ArrayBuffer → layer tree +
  `layer.composite()` trả RGBA pixels).
- `fflate` — zip PNG sequence (`zipSync`).

## 4. PSD import

### 4.1. `src/state/psd-import.ts` (module mới)

- `parsePsdToCuts(buffer: ArrayBuffer): Promise<{ cuts: SegPartCut[]; width: number; height: number }>`
  — dùng `Psd.parse(buffer)`; duyệt cây layer theo thứ tự PSD **từ dưới lên**
  (layer dưới cùng trước → draw order đúng khi place); bỏ layer ẩn
  (`layer.isHidden`), bỏ group node (chỉ lấy layer ảnh có width/height > 0).
  Mỗi layer: `await layer.composite()` → `ImageData` → canvas → PNG dataUrl;
  cut = `{ name: layer.name (không rỗng, fallback "layer"), image: dataUrl,
x: layer.left, y: layer.top, width, height }` (px, gốc trên-trái — đúng
  chuẩn `SegPartCut`/origin của segment).
- Import parts qua **`importParts(cuts, { w: psd.width, h: psd.height }, placeOnCanvas)`**
  (helper sẵn có của segment — dedupe tên, origin, slot trên root, 1 undo step).

### 4.2. UI

- Menu ☰ thêm item **Import PSD** (sau Import Atlas) + input `.psd` hidden.
  Flow: đọc file → `parsePsdToCuts` → `importParts(..., true)` (luôn place —
  giống segment mặc định) → banner lỗi qua setError nếu parse fail.

### 4.3. MCP

- BRIDGE_OPS +1 `import_psd`; TOOL_DEFS 63 → **64** (shared test count).
- `import_psd { dataUrl: string (data:...psd base64 hoặc application/octet-stream), place_on_canvas?: boolean (default true) }`
  — decode base64 → ArrayBuffer → `parsePsdToCuts` → `importParts`; trả
  `{ assets: string[], slots: string[], width, height }`.
- bridge.mjs: fixture **`client/packages/mcp-server/e2e/fixtures/tiny.psd`**
  (PSD 2 layer nhỏ, tạo 1 lần bằng script Node khi viết plan — commit file
  binary ~vài KB) → bước 10d: `import_psd` → assert 2 assets + 2 slots +
  `get_project_state` chứa assets → summary `psdImportWorks: true`.

## 5. Texture Packer settings

### 5.1. `buildAtlas` options (`src/state/atlas.ts`)

- Chữ ký mới: `buildAtlas(assets, pngName, options?: AtlasOptions)` với

  ```ts
  export interface AtlasOptions {
    padding: number; // px giữa các region, default 2
    maxSize: 1024 | 2048 | 4096; // cạnh tối đa của trang, default 2048
    powerOfTwo: boolean; // làm tròn kích thước trang lên lũy thừa 2, default false
    trim: boolean; // cắt viền trong suốt, default false
  }
  ```

- `padding`/`maxSize`/`powerOfTwo` áp vào packer hiện tại (đọc code thật khi
  viết plan — packer đơn giản xếp hàng/cột). Quá maxSize → throw Error rõ
  ("Atlas exceeds ...; giảm ảnh hoặc tăng maxSize").
- `trim: true`: mỗi asset tính bbox alpha > 0 (canvas getImageData), pack phần
  cắt; entry .atlas ghi `offsets: x, y` + `orig: w, h` theo format libgdx
  (parser atlas của ta đã đọc offset/orig — Phase 10 hỗ trợ rotated/offsets khi
  import). Region attachment giữ kích thước gốc nhờ orig.

### 5.2. AtlasDialog (`components/AtlasDialog.tsx`)

- Mở từ nút Export Atlas hiện tại (menu ☰ — đổi handler mở dialog thay vì xuất
  ngay; text nút giữ nguyên "Export Atlas"). Modal nhỏ (pattern modal sẵn có):
  4 field (Padding number 0–16, Max size select, Power of two checkbox, Trim
  checkbox) + nút **Export** (gọi buildAtlas với options → download như cũ) +
  Cancel. Options persist localStorage `spine-editor.atlas-options`.
- MCP `export_atlas` op giữ nguyên (default options) — không đổi kết quả bridge
  e2e hiện có (atlasHasRegion).

## 6. Video/PNG-sequence export

### 6.1. Refactor vòng lặp chung (`src/state/frame-export.ts` mới)

- `captureFrames(fps: number, onFrame: (img: HTMLImageElement, index: number, total: number) => Promise<void> | void): Promise<{ width: number; height: number; frames: number }>`
  — trích từ `exportGif`: step animation trên lưới fps, renderNow + screenshot,
  Image decode, khôi phục playhead/playing trong `finally`. `exportGif` refactor
  dùng helper (hành vi giữ nguyên, composite nền + quantize như cũ).

### 6.2. PNG sequence (`exportPngSequence(fps)` trong frame-export.ts)

- Mỗi frame vẽ vào canvas (giữ alpha — KHÔNG composite nền), `canvas.toBlob('image/png')`
  → `Uint8Array`; gom `files['frame-0001.png'] = bytes` (đánh số 4 chữ số, 1-based)
  → `zipSync(files)` (fflate) → download `"<animation>-frames.zip"` qua downloadBlob.

### 6.3. Video WebM (`exportWebm(fps)` trong frame-export.ts)

- Canvas + `canvas.captureStream(0)` (manual frame) hoặc `captureStream(fps)`:
  dùng **captureStream(fps) + vẽ theo nhịp thật**: MediaRecorder mimeType thử
  `video/webm;codecs=vp9` → fallback `vp8` → fallback `video/webm`; không hỗ
  trợ → Error "Trình duyệt không hỗ trợ MediaRecorder WebM.". Vòng: vẽ frame i
  (composite nền viewport #232327 — video không alpha), đợi `1000/fps` ms
  (setTimeout), requestFrame nếu dùng manual track (`track.requestFrame()` khi
  captureStream(0) khả dụng — ưu tiên manual để không lệ thuộc timing). Stop
  recorder → Blob webm → download `"<animation>.webm"`.

### 6.4. UI — ExportAnimationDialog (`components/ExportAnimationDialog.tsx`)

- Menu ☰ item mới **Export Animation…** (chỉ enable khi animate mode + có
  animation): modal với **Format** select (GIF / WebM video / PNG sequence
  (zip)), **FPS** number (default 20 GIF — giữ mặc định cũ, 30 cho WebM/PNG),
  nút Export (gọi exportGif/exportWebm/exportPngSequence, hiện trạng thái
  "Exporting… frame i/n" qua callback — dialog disable nút khi đang chạy) +
  Cancel. Nút GIF hiện có trong TimelinePanel giữ nguyên hành vi cũ (gọi
  exportGif trực tiếp) — không đổi selector/text.

## 7. Verify

- Suites: shared 3 (64 tools), core 157 không đổi, mcp-server 4; pytest không đổi.
- bridge.mjs: bước `import_psd` với fixture tiny.psd → `psdImportWorks: true`;
  `export_atlas` giữ assertions cũ. Battery 4 e2e đầy đủ.
- Unit test editor không có harness (như trước) — logic thuần (trim bbox, POT
  rounding) đặt trong atlas.ts thuần hàm để 22b/tương lai test được nếu thêm
  harness; verify qua typecheck/build/e2e/manual.
- Manual: import 1 file PSD thật (layer đúng vị trí + draw order), export atlas
  trim thấy offsets trong .atlas, export WebM mở chạy được, PNG zip đủ frame.
- Docs: CLAUDE.md (Phase 22a done, 64 tools, Next: 22b), PLAN.md row 22 ghi
  chú "22a ✅ (07/2026) — còn .skel (22b)".

## 8. Rủi ro & xử lý

- **@webtoon/psd cần WASM?** — thư viện thuần TS/JS (không wasm); nếu bundle
  Vite cần cấu hình gì thêm sẽ xử lý trong plan (thư viện hỗ trợ ESM).
- **PSD lớn** — composite từng layer tốn RAM; chấp nhận (editor desktop-class);
  lỗi parse → setError, không crash.
- **MediaRecorder timing** — frame có thể lệch nhẹ theo tải máy khi dùng
  captureStream(fps); ưu tiên manual `requestFrame()` khi có để chính xác.
- **Trim đổi kết quả export_atlas mặc định?** — không: trim default false,
  bridge e2e giữ nguyên.
