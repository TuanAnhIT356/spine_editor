# Phase 20 — Audio view (design)

Ngày: 2026-07-11 · Nhánh: `claude/phase20-audio` · Trạng thái: đã duyệt design, chờ review spec

## 1. Mục tiêu

Theo PLAN.md §8 row 20: asset audio, waveform trong dopesheet, event volume/balance,
scrub có tiếng. Format types + EventDock + `set_event`/`set_event_keyframe` (đủ
audio/volume/balance) đã có từ trước — phase này thêm: **audio asset thật**, section
AUDIO trong tree, **waveform** trên track events, và **phát tiếng** khi play/scrub.

Quyết định đã chốt: 1 PR; kèm MCP `import_audio` → **62 tools**. Engine: **Web Audio
API thuần** (không dependency mới) — decode + cache AudioBuffer, peaks cho waveform,
play qua Gain (volume) + StereoPanner (balance).

## 2. Ngoài scope (YAGNI)

- Preview window (mixer P18) không phát tiếng.
- GIF/video export không có audio.
- UI chỉnh `skeleton.audio` prefix (giữ mặc định; export event.audio = tên file).
- Trim/offset audio per key, waveform zoom riêng.

## 3. Assets + persistence (editor)

- `AudioAsset { name: string; dataUrl: string }` — export từ `state/store.ts`.
- Store: `audioAssets: Record<string, AudioAsset>` (editor state, đi vào project file
  như images), actions `addAudioAssets(assets: AudioAsset[])` (dedupe tên qua
  `uniqueName`), `removeAudioAsset(name)`. `newProject`/`openProject` reset/nạp lại.
- `persistence.ts`: `ProjectPayload` thêm **field optional** `audioAssets?: AudioAsset[]`
  (version giữ 1 — file cũ mở bình thường); `actions.ts saveProjectFile` + autosave +
  openProject đọc/ghi field này. Server autosave dùng chung payload → tự đi theo.

## 4. `src/audio/engine.ts` (module singleton, editor-only)

- `ensure(name, dataUrl): void` — decode async (`fetch(dataUrl)` → arrayBuffer →
  `AudioContext.decodeAudioData`), cache `AudioBuffer` theo name; decode xong gọi các
  subscriber (`onDecoded(cb)` trả unsubscribe) để component vẽ lại.
- `duration(name): number | null`; `peaks(name, buckets): Float32Array | null` — mono
  mix, mỗi bucket = max |sample|, cache theo (name, buckets); null khi chưa decode.
- `play(name, opts: { volume?: number; balance?: number; rate?: number }): void` —
  BufferSource → GainNode(volume, default 1) → StereoPannerNode(balance −1..1,
  default 0) → destination; `playbackRate = rate ?? 1`; tự dọn nguồn khi kết thúc.
- `stopAll(): void`; `muted: boolean` (get/set — khi true, `play` no-op); `remove(name)`
  xóa cache khi asset bị xóa/đổi.
- AudioContext tạo lazy ở lần play/decode đầu (tránh autoplay-policy warning);
  `ctx.resume()` trong `play` (gesture đã có vì user bấm Play/kéo chuột).

## 5. UI

### 5.1. TreePanel — section AUDIO (dưới IMAGES)

- Header "AUDIO" cùng style section hiện có; nút **Import Audio** mở
  `<input type="file" accept="audio/*" multiple>` → đọc FileReader dataUrl →
  `addAudioAssets` + `engine.ensure` từng file.
- Mỗi row: icon 🔉 + tên + nút ▶ (nghe thử qua engine, volume 1) + ✕ (gọi
  removeAudioAsset và `engine.remove`). Search box của tree lọc luôn audio rows
  (theo tên, như Images).

### 5.2. EventDock — Audio là select

- Thay ô text Audio bằng `<select>`: option rỗng "— none —", các audio asset names,
  và nếu `def.audio` hiện tại không khớp asset nào → thêm option đó (giữ giá trị,
  label "(missing)"). Volume/Balance giữ nguyên NumField.

### 5.3. Dopesheet — waveform trên track events

- Trong track `events` (TimelinePanel), với mỗi event key mà `events[key.name].audio`
  trỏ tới audio asset đã có: render 1 `<canvas class="wave">` absolute, `left` = x của
  key, `width = duration(audio) × pxPerSecond` (theo zoom hiện tại, clamp tới cuối
  track), `height` = cao track; vẽ peaks (bars dọc, màu `--accent-soft`, alpha ~0.7)
  nằm DƯỚI key ticks (z-index thấp hơn). Re-render khi zoom/animation/revision đổi và
  khi engine decode xong (subscribe `onDecoded`).
- Component con `EventWave({ name, x, pxPerSecond, height })` trong TimelinePanel file
  (hoặc file `EventWave.tsx` riêng nếu >60 dòng).

### 5.4. Transport — nút loa

- Nút 🔊/🔇 cạnh cụm transport P17 (title "Mute event audio"); toggle `engine.muted`
  (state React cục bộ + đồng bộ engine; default 🔊 bật tiếng).

## 6. Phát tiếng khi play/scrub

- **Playback**: trong RAF tick của TimelinePanel (đoạn `useEffect([anim.playing])`),
  giữ `prevTimeRef`; sau khi tính `t` mới: tập keys sự kiện với
  `prev < keyTime ≤ t` (khi loop wrap: `(prev, end] ∪ [start, t]`) → với mỗi key:
  `engine.play(def.audio, { volume: key.volume ?? def.volume ?? 1, balance:
key.balance ?? def.balance ?? 0, rate: speed })` (bỏ qua khi def không có audio
  hoặc asset thiếu). Khi bấm Pause / đổi animation / rời animate mode → `stopAll()`.
- **Scrub**: handler kéo playhead trên ruler (pointermove đang gọi `setAnimTime`) so
  `prevScrubRef` với time mới, phát key vừa vượt qua (cả 2 chiều kéo — dùng
  `min(prev,t) < keyTime ≤ max(prev,t)`), volume/balance như trên, rate 1. Bắt đầu
  drag mới → `stopAll()`.

## 7. MCP + bridge

- BRIDGE_OPS +1: `import_audio`. TOOL_DEFS 61 → **62** (shared test count đổi).
- `import_audio { name: string, dataUrl: string }` — validate `data:audio/`, thêm
  asset (uniqueName), `engine.ensure`; trả `{ asset: <tên> }`. Description gợi ý dùng
  cùng `set_event { audio }`.
- `get_project_state` trả thêm `audioAssets: string[]` (danh sách tên).

## 8. Verify

- Suites hiện có + shared test 62; core không đổi (audio thuần editor); pytest không đổi.
- `bridge.mjs`: sinh WAV PCM 16-bit ~0.2s (base64 inline trong script) →
  `import_audio` → `set_event { name: 'clang', audio: <asset> }` (event MỚI — không
  đụng assertion `eventDefs.footstep` hiện có) + `set_event_keyframe` clang → export
  JSON: `events.clang.audio === <asset>`; `get_project_state` chứa asset trong
  `audioAssets` → summary `audioWorks: true`.
- Battery 4 e2e (smoke/anim/bridge/chat) như thường lệ; không đổi selector cũ (section
  AUDIO + nút mới là text mới).
- Docs: CLAUDE.md (Phase 20 done, 62 tools, Next 21–22), PLAN.md row 20 ✅.

## 9. Rủi ro & xử lý

- **Autoplay policy**: AudioContext cần user gesture — tạo lazy + resume trong play
  (play/scrub đều từ gesture). E2E không assert tiếng, chỉ assert data.
- **File audio lớn trong project JSON**: dataUrl base64 phình file — chấp nhận (giống
  images); không giới hạn cứng, không nén.
- **Decode fail (codec lạ)**: engine bắt lỗi, `setError` "Cannot decode audio <name>";
  asset vẫn giữ (export vẫn đúng tên file).
