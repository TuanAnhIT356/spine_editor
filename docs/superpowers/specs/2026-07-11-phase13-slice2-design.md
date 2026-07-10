# Spec: Phase 13 Slice 2 — Inpaint + Chiến lược A + MCP segment_image + SAM local

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: `server/` (providers inpaint/edit, segment inpaint, part-set, SAM local extra), `packages/shared` (+1 op), `packages/editor` (SegmentModal inpaint, GenerateModal part-set, ops.ts), `packages/mcp-server` (+1 tool), skills, e2e. Hoàn thiện Phase 13.

## 1. Bối cảnh & mục tiêu

Slice 1 đã ship chiến lược B (tách part từ ảnh). Slice 2 đóng nốt Phase 13:

1. **Inpaint phần che khuất** — part bị part khác đè (tay che thân) có lỗ; vá bằng
   provider inpaint để part dùng được ngay khi rig.
2. **Chiến lược A** — gen-từng-part từ ảnh tham chiếu (PLAN §7.5.A): chất lượng part
   cao nhất, không phụ thuộc segmentation.
3. **MCP tool `segment_image`** — AI agent tự tách part qua bridge (nền Phase 14).
4. **SAM 2 local** — backend offline miễn phí, dạng uv extra tùy chọn.

## 2. Provider layer mở rộng (`server/app/providers/`)

`base.py` thêm 2 method TÙY CHỌN vào pattern (không bắt buộc mọi adapter):

```python
class ImageProvider(Protocol):
    name: str
    supports_transparent: bool
    approx_cost_usd: float
    async def generate(self, key, prompt, size, transparent) -> bytes: ...

# Kiểm tra năng lực bằng hasattr/getattr — adapter nào có thì khai báo:
#   supports_inpaint: bool = True  +  async def inpaint(self, key, image_png, mask_png, prompt) -> bytes
#   supports_edit: bool = True     +  async def edit(self, key, image_png, prompt, size, transparent) -> bytes
```

- **StabilityProvider.inpaint**: POST `https://api.stability.ai/v2beta/stable-image/edit/inpaint`
  (multipart: `image`, `mask` (trắng = vùng vá), `prompt`, `output_format=png`;
  header `authorization: Bearer <key>`, `accept: image/*`) — **xác minh field chính xác
  lúc implement từ docs Stability**. Cost ≈ $0.03/call.
- **OpenAIProvider.edit**: POST images.edit với model gpt-image-1.5 (multipart `image[]`,
  `prompt`, `size`, `background=transparent` khi transparent) — **xác minh field lúc
  implement từ docs OpenAI**. Cost ≈ $0.07/call.
- **MockProvider**: `inpaint` = Gaussian-blur fill vùng mask (PIL, local, deterministic);
  `edit` = ảnh gốc tint màu theo hash(prompt) + giữ alpha — free, dùng cho test/e2e.
- Registry `/api/generate/providers` trả thêm `supports_inpaint`, `supports_edit`.

## 3. Inpaint trong `/api/segment/parts`

- `PartsRequest` thêm: `inpaint: bool = False`, `inpaint_provider: str = "mock"`.
- Sau khi có mask mọi part: hole của part X = union(mask các part khác) ∩ bbox(X),
  đo trên ảnh nguồn rồi crop theo bbox(X). Hole > **200 px²** thì gọi
  `provider.inpaint(key, cut_png, hole_mask_png, f"seamlessly continue the {name}
texture, same art style, 2D game sprite")` và thay ảnh part.
- Guards: provider không có `supports_inpaint` → 400; thiếu key (trừ mock) → 400;
  lỗi provider → 502 (part đã cắt vẫn trả về — response thêm
  `warnings: list[str]` ghi part nào inpaint fail thay vì fail cả request).
- `PartCut` thêm field `inpainted: bool`.
- Editor SegmentModal: checkbox **"Inpaint occluded areas"** + select provider
  (lọc `supports_inpaint` từ `/api/generate/providers`) + cost note
  `~$X × số part có hole`; hiển thị `warnings` nếu có.

## 4. Chiến lược A — `POST /api/generate/part-set`

- Body: `{provider, subject?: str, reference?: dataURL, parts?: [str], size: "1024x1024"}`
  — `subject` XOR `reference` (400 nếu cả hai/không cái nào); `parts` mặc định =
  10 tên part chuẩn slice 1 (server expose qua response của `/api/segment/backends`?
  KHÔNG — hằng `DEFAULT_PART_NAMES` nằm trong `segment/parts.py`, router import).
- Luồng: (a) có `subject` → `provider.generate` với template part-sheet T-pose sẵn có
  của editor (server nhân bản template đó thành hằng `REFERENCE_TEMPLATE`) → lưu
  gallery như generate thường; (b) với reference PNG: mỗi part gọi `provider.edit(key,
reference, f"isolate only the {part}, transparent background, same character, same
art style", size, transparent=True)` — tuần tự, timeout tổng do client chờ (không
  job/queue). Trả `{reference: dataURL, parts: [{name, image}], warnings}` — part lỗi
  vào `warnings`, không fail cả set.
- Guards: provider không `supports_edit` → 400; thiếu key → 400; >20 part → 400;
  reference > 4096px → 400 (dùng lại `_decode` của segment router — chuyển helper đó
  ra module dùng chung `app/api/_images.py` để khỏi lặp).
- Editor GenerateModal: trong `.gen-result` thêm nút **"Generate part set"** (disabled
  nếu provider không supports_edit — mock luôn được) → gọi part-set với reference =
  ảnh vừa gen → grid preview part (tên + ảnh nền caro) → nút **"Add all to Images"**
  (assets thuần, không origin) + notice.

## 5. MCP tool `segment_image`

- `packages/shared`: thêm `'segment_image'` vào `BRIDGE_OPS` (59 → 60).
- `ops.ts` case `segment_image`: params `{asset: string, backend?: string = 'mock',
place_on_canvas?: boolean = true}` → lấy asset từ store (không có → throw), gọi
  `segmentParts(dataUrl, backend)` (cần phiên server đăng nhập như `generate_image`),
  import parts thành assets (suffix chống trùng như SegmentModal) + place-on-canvas
  qua Composite (tái sử dụng: **tách logic import của SegmentModal ra
  `src/segment/import-parts.ts`** — hàm `importParts(cuts, imgSize, placeOnCanvas)`
  dùng chung modal + op, hết viết đôi).
- `tools.ts`: tool `segment_image` (52 → **53 tools**), mô tả rõ cần editor đăng nhập
  server + backend mock free. `skills/spine-rigging/SKILL.md` +1 dòng.
- E2E: không thêm vào bridge.mjs (cần server chạy — giống tiền lệ `generate_image`);
  phủ bằng pytest phía server + typecheck op, smoke tay ghi vào acceptance.

## 6. SAM 2 local — uv extra

- `pyproject`: `[project.optional-dependencies] sam-local = ["torch>=2.4", "sam2>=1.1",
"huggingface-hub>=0.24"]`. CI/mặc định KHÔNG cài.
- `backends.py` thêm `LocalSam2Backend` (name `local`, cost 0): lazy-import `sam2`,
  `SAM2ImagePredictor.from_pretrained("facebook/sam2-hiera-small")` (checkpoint tự
  tải HF cache lần đầu), device tự chọn (`mps` > `cuda` > `cpu`), predict với
  point_coords/point_labels/box từ `PartPrompt`, mask → PNG. **Xác minh API sam2
  chính xác lúc implement.** Đăng ký vào `BACKENDS` chỉ khi import thành công
  (try/except quanh registration) → `/backends` tự liệt kê, editor dropdown tự thấy.
- Test: 1 test skip-unless env `SEGMENT_LOCAL_SAM=1`. README/CLAUDE.md ghi
  `uv sync --extra sam-local`.

## 7. Tests & e2e

- pytest mới: hole-mask math (2 part chồng → hole đúng vị trí/kích thước), inpaint
  mock end-to-end qua `/parts` (`inpainted: true`, warnings rỗng), inpaint thiếu key
  400 / provider không hỗ trợ 400, part-set với mock (subject → reference + 10 part,
  reference vào gallery), part-set guards (thiếu cả subject/reference 400, >20 part
  400), payload-mapping StabilityProvider.inpaint + OpenAIProvider.edit (monkeypatch
  như FalSam2 pattern).
- e2e `server.mjs`: segment flow bật `Inpaint (mock)`; sau generate flow thêm
  part-set mock → "Add all to Images" → assert assets part chuẩn xuất hiện.
- Toàn bộ CI offline như cũ.

## 8. Nghiệm thu

1. `uv run pytest` xanh offline; ruff sạch.
2. E2E `server.mjs` pass thêm 2 luồng mới (inpaint mock + part-set mock).
3. Node suite xanh; bridge.mjs vẫn 53 tools pass.
4. Smoke tay: (a) inpaint thật qua Stability key nếu có; (b) part-set thật qua openai
   key nếu có; (c) `uv sync --extra sam-local` → backend `local` xuất hiện và tách
   được part thật; (d) MCP `segment_image` qua Claude Code với editor đăng nhập.
5. PLAN.md Phase 13 đánh dấu hoàn thành đầy đủ; CLAUDE.md cập nhật (53 tools).

## 9. Không làm

- Không job async/queue cho part-set (tuần tự, hiển thị busy; cân nhắc khi Phase 14).
- Không UI chỉnh mask pixel-level, không lưu part-set vào DB (chỉ reference vào
  gallery), không inpaint cho chiến lược A (part gen ra đã nguyên vẹn).
