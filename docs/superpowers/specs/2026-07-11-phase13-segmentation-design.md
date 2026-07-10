# Spec: Phase 13 Slice 1 — Segmentation (chiến lược B end-to-end)

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt (scope Slice 1; SAM qua fal.ai BYOK + mock)
- **Phạm vi**: `server/` (module segment + router + deps), `packages/editor` (SegmentModal + api wrappers + ImageAsset metadata + toolbar), e2e `server.mjs`. Không đụng `core`/`mcp-server`.

## 1. Bối cảnh & mục tiêu

PLAN.md §7.5–7.6 Phase 13: từ một ảnh nhân vật full-body → tách thành các part PNG rời
(đầu, thân, tay, chân…) kèm vị trí gốc, có bước con người review/sửa mask — làm nền cho
Phase 14 auto-rig. Slice 1 = **chiến lược B hoàn chỉnh không inpaint**:
remove-bg (rembg local) → pose landmarks (MediaPipe local) → mask từng part (SAM 2 qua
fal.ai BYOK hoặc mock) → review UI trong editor → import parts thành assets (+ tùy chọn
đặt lên canvas).

**Để slice 2 / Phase 14**: inpaint phần che khuất, chiến lược A (gen-từng-part), MCP tool
`segment_image`, SAM local (torch), auto-rig.

## 2. Quyết định chính & lý do

- **SAM backend = fal.ai `fal-ai/sam2/image` (BYOK) + `mock`** — dùng chung fal key đã có
  trong vault, không thêm torch ~2.5GB; interface `SegmentBackend` để sau cắm SAM local
  không đổi API. Tham chiếu API: <https://fal.ai/models/fal-ai/sam2/image/api>
  (point prompts `{x, y, label 1|0}`, box prompts `{x_min, y_min, x_max, y_max}`) —
  **field mapping chính xác xác minh lại lúc implement từ trang API này**.
- **rembg + MediaPipe chạy in-process, local, không key** (đúng PLAN). Model tải lần đầu
  khi dùng, cache vào `server/data/models/` (rembg qua env `U2NET_HOME`, MediaPipe tải
  file `.task` thủ công bằng httpx nếu chưa có).
- **Stateless** — không bảng DB mới; kết quả trả thẳng, parts sống trong project JSON
  như assets hiện tại.
- **Python 3.11 tương thích**: rembg, mediapipe, numpy, pillow đều hỗ trợ 3.11 (CI) và
  3.12 (Docker).

## 3. Server

### 3.1. Deps (`server/pyproject.toml`)

Thêm: `rembg` (kéo onnxruntime CPU), `mediapipe`, `numpy`, `pillow`. Không torch.

### 3.2. Module `server/app/segment/`

| File          | Nội dung                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas.py`  | `Point {x, y, label}` (label 1=fg, 0=bg) · `Box {x0, y0, x1, y1}` · `PartPrompt {name, points, box?}` · `PartCut {name, image (dataURL PNG RGBA), x, y, width, height}` · request/response cho 3 endpoint                                                                                                                                                                                                                                                                   |
| `engines.py`  | `remove_background(png) -> bytes` (rembg lazy, session cache, `U2NET_HOME=server/data/models`) và `detect_pose(png) -> PoseResult {landmarks: dict[str, (x, y, visibility)] pixel, width, height}` (MediaPipe Tasks PoseLandmarker, model `pose_landmarker_lite.task` tải về `server/data/models/` lần đầu) — gộp một file vì dùng chung fake-mode + models-dir helper                                                                                                      |
| `parts.py`    | `PART_RECIPES` — 10 part chuẩn: `head, torso, upper_arm_l/r, lower_arm_l/r, upper_leg_l/r, lower_leg_l/r`. Mỗi recipe từ landmarks sinh `PartPrompt`: fg points = 2 đầu đoạn chi co vào 25% + trung điểm; bg points = tâm các part liền kề; box = bọc đoạn chi + padding 20% (head: quanh nose/ears/mắt; torso: vai→hông). `build_prompts(pose: PoseResult) -> list[PartPrompt]` thuần logic — unit-test không cần model. Part thiếu landmark (visibility < 0.5) thì bỏ qua |
| `backends.py` | `class SegmentBackend(Protocol): name; approx_cost_usd; async mask(image_png: bytes, prompt: PartPrompt) -> bytes  # mask PNG trắng/đen`. `FalSam2Backend(api_key)` — POST `https://fal.run/fal-ai/sam2/image` (key trong header `Authorization: Key …`), map points/box theo doc; ảnh gửi dạng data-URI. `MockBackend` — mask = box tô đặc (không box thì hình tròn bọc các fg points), deterministic, free                                                                |
| `cutout.py`   | `cut_part(image_png, mask_png, name) -> PartCut` — nhân alpha theo mask, crop về bbox của mask, trả kèm tọa độ gốc (x, y) trong ảnh nguồn (pixel, gốc trên-trái)                                                                                                                                                                                                                                                                                                            |

### 3.3. Router `server/app/api/segment.py` (prefix `/api/segment`, auth `CurrentUser`)

| Endpoint          | Vào → Ra                                                                                                                 | Guards                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `POST /remove-bg` | `{image}` → `{image}` (dataURL PNG)                                                                                      | ảnh > 4096px cạnh dài → 400                                                                    |
| `POST /pose`      | `{image}` → `{landmarks, width, height, parts: [PartPrompt]}` (prompts gợi ý từ recipes để UI vẽ)                        | không thấy người/landmark chính thiếu → 422 message rõ                                         |
| `POST /parts`     | `{image, parts?: [PartPrompt], backend: 'fal'\|'mock'}` → `{parts: [PartCut]}`; `parts` omitted → tự chạy pose + recipes | backend fal: thiếu key → 400 (message hướng dẫn vault); lỗi provider → 502; số part > 20 → 400 |
| `GET /backends`   | → `[{name, has_key, approx_cost_usd}]` (mock luôn has_key)                                                               | —                                                                                              |

- Key fal giải mã từ vault ngay trước call, không log — đúng pattern `generate.py`.
- **Env `SPINE_SERVER_SEGMENT_FAKE=1`**: thay rembg bằng passthrough (trả nguyên ảnh) và
  pose bằng bộ landmarks hình-người-chuẩn theo tỷ lệ ảnh (deterministic) — cho e2e/CI
  không cần tải model. Mock backend sẵn free nên không cần fake thêm.

### 3.4. Lỗi & giới hạn

- Import rembg/mediapipe fail (thiếu deps) → 503 kèm lệnh cài.
- Decode ảnh fail → 400. Timeout httpx gọi fal: 60s/part.
- Response điểm/mask ngoài biên ảnh → clamp về biên (không lỗi).

## 4. Editor

### 4.1. `src/server/api.ts`

Thêm wrappers: `segmentRemoveBg(image)`, `segmentPose(image)`, `segmentParts(req)`,
`segmentBackends()` — dùng `request<T>()` sẵn có (tự refresh 401).

### 4.2. `components/SegmentModal.tsx` (mới) + nút "Segment" trên Toolbar (cạnh Generate)

Luồng: **chọn nguồn → (Remove BG) → Detect parts → review → Import**.

- Nguồn: dropdown asset có sẵn hoặc `<input type=file>`; preview trên canvas 2D.
- "Remove BG": gọi endpoint, thay preview (giữ ảnh trước đó để Undo trong modal 1 bước).
- "Detect parts": gọi `/pose` lấy prompts gợi ý → gọi `/parts` với backend đang chọn
  (dropdown từ `/backends`, disable fal khi `has_key=false`, hiện cost ≈ n_parts × cost).
- **Review**: danh sách part bên phải (checkbox hiện/ẩn overlay màu bán trong suốt vẽ
  từ mask/bbox trên canvas, input đổi tên, nút ✕ xóa part); click canvas = thêm fg point
  cho part đang chọn, Alt+click = bg point; nút "Re-run part" gọi `/parts` chỉ với part
  đó rồi thay kết quả. Point hiển thị chấm xanh/đỏ.
- "Import parts": mỗi part → `ImageAsset` (name = tên part, dataUrl = PNG đã cắt) kèm
  metadata nguồn gốc; checkbox **"Place on canvas"** (mặc định bật): tạo một `Composite`
  gồm mỗi part một `AddSlot(slot=tên part, bone='root')` + `AddSkinAttachment` region
  đặt tại `worldX = (x + w/2) − imgW/2`, `worldY = imgH/2 − (y + h/2)` (đổi hệ Y-up,
  tâm ảnh nguồn = gốc world), draw order theo thứ tự danh sách — 1 bước undo.

### 4.3. `ImageAsset` metadata (`state/store.ts`)

Mở rộng optional: `origin?: { x: number; y: number; sourceWidth: number; sourceHeight: number }`
(tọa độ pixel gốc trên-trái trong ảnh nguồn). Serialize tự nhiên qua project payload
hiện tại (assets giữ nguyên shape khi save/load — xác nhận `collectPayload`/load giữ
field lạ; nếu load code lọc field thì thêm passthrough).

## 5. Tests & e2e

- **pytest** (mock hết engine ngoài, không tải model):
  - `parts.py`: từ landmarks giả (hình người chuẩn) → đủ 10 part, points/box đúng phía
    (arm trái ≠ phải), part thiếu landmark bị bỏ.
  - `cutout.py`: mask giả → crop đúng bbox + alpha đúng + tọa độ gốc đúng.
  - `MockBackend`: box → mask đặc đúng kích thước.
  - API: auth bắt buộc (401), fal thiếu key → 400, backend mock end-to-end với ảnh PNG
    nhỏ tự sinh + `SPINE_SERVER_SEGMENT_FAKE=1` (remove-bg passthrough, pose fake), quá
    4096px → 400, >20 part → 400.
  - Integration thật (rembg/mediapipe/fal): 1 test đánh dấu skip trừ khi `SEGMENT_REAL=1`.
- **e2e `packages/editor/e2e/server.mjs`**: server chạy với `SPINE_SERVER_SEGMENT_FAKE=1`;
  thêm luồng: mở Segment modal → upload PNG test → Remove BG → Detect parts (backend
  mock) → đổi tên 1 part → Import (place on canvas) → assert store có assets mới + slots
  mới đúng tên/vị trí.
- CI không đổi job — deps mới cài qua `uv sync` (~150MB, chấp nhận).

## 6. Nghiệm thu

1. `uv run pytest` xanh (kèm test mới, không network/model).
2. E2E `server.mjs` (fake engines) pass với luồng segment→import.
3. Chạy tay thật trên máy dev: ảnh nhân vật thật → Remove BG (rembg thật) → Detect
   (MediaPipe thật + fal thật nếu có key, mock nếu không) → import parts đặt đúng chỗ.
4. `uv run ruff check . && uv run ruff format --check .` + toàn bộ Node checks xanh.
5. PLAN.md §7.6 Phase 13 cập nhật ghi chú hoàn thành slice 1; CLAUDE.md cập nhật ngắn.

## 7. Không làm (YAGNI slice này)

- Không inpaint, không chiến lược A, không MCP tool segment, không SAM local, không
  bảng DB mới, không job/queue async (đồng bộ đủ: pose < 1s, fal ~2-5s/part), không
  brush sửa mask pixel-level (chỉ point prompts + re-run).
