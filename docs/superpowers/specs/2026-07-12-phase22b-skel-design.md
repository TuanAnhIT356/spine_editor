# Phase 22b — Binary .skel import/export (design)

Ngày: 2026-07-12 · Nhánh: `claude/phase22b-skel` · Trạng thái: đã duyệt design, chờ review spec

## 1. Mục tiêu

Slice 2/2 (cuối) của Phase 22 và của toàn roadmap §8: writer + reader **Spine 4.2
binary format (.skel)** trong core, menu Export/Import SKEL trong editor, MCP
`export_skel` → **65 tools**.

## 2. Kỳ vọng tương thích (đã chốt với user)

- Viết theo **tài liệu binary format công khai** của Esoteric
  (esotericsoftware.com/spine-binary-format, bản 4.2). Khi thực thi, TRƯỚC khi
  code từng section phải **WebFetch tài liệu chính thức để đối chiếu** — không
  code theo trí nhớ.
- Kiểm chứng bằng **round-trip nội bộ**: `data → writeSkel → readSkel → data′`,
  so sánh `serializeSpineJson(data)` với `serializeSpineJson(data′)` (JSON chuẩn
  hóa) — trên 2 fixtures examples + fixture tổng hợp phủ mọi nhánh.
- **KHÔNG** verify byte-level với runtime chính thức (cần Spine license) — cùng
  giới hạn đã chấp nhận ở Phase 1 với JSON; người dùng tự kiểm trong project
  game có license.

## 3. Ngoài scope

- `import_skel` qua MCP (chỉ UI); các version format khác 4.2; nén ngoài
  (deflate không thuộc format); linked mesh viết dạng đầy đủ nếu format yêu cầu
  tham chiếu đặc biệt vượt dữ liệu ta có (ghi issue thay vì đoán).

## 4. Core — `client/packages/core/src/spine-binary/`

### 4.1. `binary-io.ts` — primitives

- `class DataWriter`: buffer tự giãn; `int8/uint8`, `int32`, `float32`,
  `boolean`, `varint(value, optimizePositive)` (1–5 byte, 7 bit + continuation
  — chiều bit đúng theo tài liệu), `utf8String(s: string | null)` (0 = null,
  ngược lại length+1 rồi bytes), `color8888(hex8)`, `color888(hex6)`;
  `bytes(): Uint8Array`.
- `class DataReader`: con trỏ + các hàm đọc đối xứng; `eof` check; lỗi đọc quá
  cuối → throw Error có offset.
- Chi tiết endianness/chiều varint: LẤY TỪ TÀI LIỆU khi thực thi (bước đối
  chiếu bắt buộc) — spec này không khóa cứng để tránh chép sai từ trí nhớ.

### 4.2. `constants.ts`

Mã số theo tài liệu 4.2: attachment types (region/boundingbox/mesh/linkedmesh/
path/point/clipping), curve types (0 linear/1 stepped/2 bezier), bone timeline
types, slot timeline types, path/physics timeline types, inherit modes, blend
modes, sequence mode. Mỗi bảng kèm comment link section tài liệu.

### 4.3. `write.ts` — `writeSkel(data: SkeletonData): Uint8Array`

Thứ tự section theo tài liệu: header (hash int64 — ghi 0 nếu không có, version
"4.2.x" từ `SPINE_JSON_TARGET_VERSION`, x/y/width/height, nonessential flag +
fps/images/audio khi nonessential bật — ta LUÔN ghi nonessential=true để giữ đủ
dữ liệu), **strings table** (gom trước mọi chuỗi thuộc diện string-ref theo tài
liệu), bones, slots, ik, transform, path, physics, skins (default trước, named
sau), events, animations. Nguồn dữ liệu: `SkeletonData` (model của ta — cùng bề
mặt serializer JSON):

- Bones: đủ 5 inherit + color nonessential.
- Slots: color, dark (tint black — cờ theo format), blend, attachment ref.
- Skins: 7 loại attachment; vertices weighted/unweighted theo cờ; mesh uvs/
  triangles/hull/edges/width/height; sequence nếu có.
- Animations: mọi timeline serializer JSON đang ghi — bone
  rotate/translate(+x/y)/scale(+x/y)/shear(+x/y), slot attachment/rgba/rgb/
  alpha/rgba2/rgb2, ik, transform, path position/spacing/mix, physics
  (+reset), deform, draworder, events; curve linear/stepped/bezier
  per-channel (bezier ghi 4 float/kênh theo tài liệu; đếm bezier count đúng
  quy định của section animation).

### 4.4. `read.ts` — `readSkel(bytes: Uint8Array): { data: SkeletonData; issues: ValidationIssue[] }`

Đối xứng write; dùng factories (`createBone`…) + shapes verbatim như
`parseSpineJson` để ra `SkeletonData` chuẩn (áp Spine defaults nhất quán với
parser JSON). Trường/section chưa hỗ trợ (vd. linked mesh tham chiếu thiếu) →
push issue `severity: 'warning'`, bỏ qua an toàn, KHÔNG throw. File hỏng (magic/
version lạ, đọc quá cuối) → issue `severity: 'error'` + trả data rỗng tối thiểu.
Version check: chấp nhận prefix "4.2"; khác → error issue.

### 4.5. Export từ core index

`export * from './spine-binary/write.js'; export * from './spine-binary/read.js';`
(binary-io/constants nội bộ, không export.)

## 5. Tests (core — tầng theo section)

1. `binary-io.test.ts`: varint biên (0, 1, -1, 127, 128, giá trị lớn, âm với
   optimizePositive false), utf8 null/rỗng/unicode (tiếng Việt + emoji),
   float32 round-trip, color 8888/888.
2. `skel-roundtrip.test.ts` — helper
   `expectRoundTrip(data: SkeletonData)` = so sánh
   `JSON.stringify(serializeSpineJson(readSkel(writeSkel(data)).data))` với
   bản gốc. Cases: (a) skeleton tối thiểu; (b) bones đủ inherit/color + slots
   color/dark/blend; (c) 4 loại constraint đủ field; (d) skins: region + mesh
   weighted + boundingbox + path + point + clipping (+ skin phụ); (e) events
   đủ audio/volume/balance; (f) animations tổng hợp: mỗi loại timeline ≥1 key,
   đủ 3 loại curve (bezier per-channel), deform có offset, draworder, events
   với payload; (g) 2 fixtures examples parse JSON → round-trip skel.
3. Lỗi: bytes cụt → issues error, không throw; version "3.8" → error issue.

## 6. Editor UI

- Menu ☰: **Export SKEL** (dưới Export JSON; validate lỗi chặn như Export JSON
  → `writeSkel(doc.data)` → `downloadBlob('skeleton.skel', ...)`).
- **Import SKEL** (dưới Import JSON): input `.skel` → `readSkel(bytes)` →
  issues error → setError + không thay project; warning → banner sau khi
  `replaceProject(serializeSpineJson(result.data)... )` — dùng đường
  `replaceProject(json, assets giữ nguyên, audio giữ nguyên)` như Import JSON
  (chuyển data → json qua serializeSpineJson để đi chung validate/parse path).

## 7. MCP + bridge

- BRIDGE_OPS +1 `export_skel`; TOOL_DEFS 64 → **65** (shared test 65).
- `export_skel {}` — validate lỗi chặn như export JSON; trả
  `{ base64: string, bytes: number }` (result type 'text' JSON).
- bridge.mjs bước 10e: `export_skel` → decode base64 → assert `bytes > 100` và
  4 byte version string xuất hiện trong buffer ("4.2" dưới dạng UTF-8) →
  `skelExportWorks: true`. (Round-trip sâu đã nằm ở core tests.)

## 8. Verify

- Suites: core tests mới (~15) + 160 cũ; shared 3 (65); mcp-server 4; pytest
  không đổi. Battery 4 e2e chuẩn + `toolCount: 65`, `skelExportWorks: true`.
- Docs: CLAUDE.md (**Phase 22 done cả 22a+22b — roadmap §8 HOÀN TẤT**, 65
  tools), PLAN.md row 22 ✅ đầy đủ + §6 gap "binary .skel" đóng.

## 9. Rủi ro & xử lý

- **Nhớ sai chi tiết format** — mitigated: bước WebFetch đối chiếu tài liệu
  từng section TRƯỚC khi code là bắt buộc trong plan; round-trip test bắt lỗi
  bất đối xứng writer/reader (nhưng KHÔNG bắt được lỗi "cả hai cùng sai so với
  format" — đó là giới hạn §2 user đã chấp nhận).
- **Bezier count trong animation header** (format 4.x yêu cầu đếm trước tổng
  bezier để runtime cấp phát): writer đếm chính xác qua 1 pass trước khi ghi.
- **Linked mesh**: ta không tạo linked mesh trong editor; nếu đọc gặp → issue
  warning + skip (an toàn).
