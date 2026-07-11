# Spec: Phase 14 Slice 2 — AI chat auto-rig/animate (chat ws + anthropic loop)

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: `packages/shared` (TOOL_DEFS + chat protocol types), `packages/mcp-server`
  (refactor registerTools — parity 55 tools), `server/` (deps anthropic/websockets, bảng
  `conversations`/`messages`, `app/chat/` loop + fake, REST + ws `/api/chat`),
  `packages/editor` (ChatClient + ChatWindow nổi, nút Toolbar), e2e mới
  `packages/editor/e2e/chat.mjs`, docs. Đây là hạng mục roadmap cuối (PLAN §7.6 Phase 14
  mục 1+4).

## 1. Bối cảnh & mục tiêu

Slice 1 đã có `rig_from_parts` + `apply_preset_animation`; toàn bộ pipeline
gen → segment → rig → animate gọi được từng bước qua MCP. Slice 2 đưa pipeline vào
**một câu chat trong editor**: user gõ "tạo hiệp sĩ và cho nó đi bộ", model Claude tự
gọi tool, user nhìn rig hình thành trong viewport theo thời gian thực. Server chạy vòng
lặp (anthropic Python SDK, key BYOK trong vault), lịch sử lưu DB, mở lại phiên cũ tiếp
tục đúng ngữ cảnh.

Quyết định đã chốt khi brainstorm:

- **Toolset**: full parity **55 tools** (không subset) — schema đi từ TypeScript sang
  Python bằng phương án **A: hello ws** (editor gửi JSON Schema khi kết nối, zero drift).
- **UI**: cửa sổ chat **nổi kéo-thả** (không phải panel dock, không phải modal).

## 2. `packages/shared` — TOOL_DEFS + chat protocol

`shared` thêm dependencies `zod` (^3.24, trùng bản mcp-server) và `zod-to-json-schema`.

```ts
export interface ToolDef {
  name: string; // tên tool (= op, trừ screenshot_viewport → op 'screenshot')
  description: string;
  shape: ZodRawShape; // schema params (zod), giữ nguyên từ tools.ts
  op: BridgeOp; // op bridge tương ứng
  result: 'text' | 'image' | 'atlas'; // cách trình bày kết quả
}
export const TOOL_DEFS: ToolDef[]; // đúng 55 phần tử, thứ tự như tools.ts hiện tại

export interface ToolJsonSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema type:"object"
}
export function toolJsonSchemas(): ToolJsonSchema[]; // zodToJsonSchema(z.object(shape))
```

- `result: 'image'` chỉ có `screenshot_viewport`; `'atlas'` chỉ có `export_atlas`;
  còn lại `'text'`.
- Toàn bộ 55 `(name, description, shape)` chuyển **nguyên văn** từ
  `packages/mcp-server/src/tools.ts` (kể cả `curveSchema` dùng chung).

Chat ws message types (discriminated unions trên `type`):

```ts
// editor → server
export type ChatClientMsg =
  | { type: 'hello'; tools: ToolJsonSchema[] }
  | { type: 'user'; text: string }
  | { type: 'op_result'; id: number; ok: true; content: unknown[] } // anthropic content blocks
  | { type: 'op_result'; id: number; ok: false; error: string }
  | { type: 'stop' };

// server → editor
export type ChatServerMsg =
  | { type: 'ready'; conversation: number; title: string }
  | { type: 'delta'; text: string } // text assistant streaming
  | { type: 'thinking'; text: string } // summarized thinking delta
  | { type: 'op'; id: number; tool: string; params: Record<string, unknown> }
  | { type: 'turn_done'; stopReason: string }
  | { type: 'title'; text: string }
  | { type: 'error'; message: string };
```

Server chỉ nói chuyện bằng **tên tool** (nó chỉ có JSON Schema từ hello, không biết
op): message `op` mang `tool`; editor resolve `tool → TOOL_DEFS → (op, result)` rồi
`dispatchOp`. Không cần message tool_started/tool_done riêng — editor tự render chip
tool từ chính message `op` nó xử lý (✓/✗ theo `op_result` nó gửi).

## 3. `packages/mcp-server` — refactor parity

`registerTools` thành vòng lặp trên `TOOL_DEFS`:

- `result === 'text'` → handler `forward(def.op)` như cũ.
- `result === 'image'` → presenter screenshot hiện tại (dataUrl → image content).
- `result === 'atlas'` → presenter export_atlas hiện tại (text + image contents).

Hành vi phải **byte-identical**: e2e `bridge.mjs` giữ nguyên mọi expectation
(`toolCount: 55`, tools hoạt động như cũ) — đó là bằng chứng parity, không cần test mới.

## 4. `server/` — deps, DB, REST

- `pyproject.toml` thêm: `anthropic>=0.40`, `websockets>=13` (uvicorn ws support).
- `models.py`:

```python
class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] (PK)
    user_id: Mapped[int] (FK users.id, index)
    project_id: Mapped[int | None] (FK projects.id, nullable)  # gắn project khi có
    title: Mapped[str] (String(200), default "New chat")
    created_at / updated_at (DateTime tz, như Project)

class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] (PK)
    conversation_id: Mapped[int] (FK conversations.id, index)
    role: Mapped[str] (String(16))            # "user" | "assistant"
    content: Mapped[str] (Text)               # JSON: anthropic content blocks VERBATIM
    created_at (DateTime tz)
```

- `content` lưu content blocks anthropic **nguyên văn** (text/thinking/tool_use ở
  assistant; text/tool_result ở user) → resume = replay verbatim, đúng PLAN §7.3
  "mở lại phiên cũ là tiếp tục đúng ngữ cảnh". Thinking blocks lưu kèm (kể cả
  signature) vì tool-use loop yêu cầu giữ nguyên khi replay.
- REST `app/api/chat.py` (auth bearer như các API khác, chỉ chủ sở hữu):
  - `GET /api/chat/conversations?project_id=` → `[{id, title, project_id, updated_at}]`
  - `POST /api/chat/conversations {project_id?}` → tạo mới
  - `DELETE /api/chat/conversations/{id}` (xóa kèm messages)
  - `GET /api/chat/conversations/{id}/messages` → `[{id, role, content, created_at}]`
    (content parse sẵn thành JSON cho client render lại transcript)

## 5. `server/app/chat/` — ws + vòng lặp + fake

`WebSocket /api/chat/ws?token=<access-JWT>&conversation=<id>`:

1. Verify JWT lúc connect (hàm decode access token hiện có; sai/thiếu → close 4001).
   Token hết hạn giữa phiên không ngắt ws (chỉ verify lúc connect — ghi nhận rõ).
2. `conversation` bỏ trống → tạo mới; id không tồn tại hoặc thuộc user khác →
   close 4003.
3. Đợi `hello {tools}` (bắt buộc, message đầu tiên) → trả `ready`.
4. Mỗi `user {text}`: chạy một **turn**.

Vòng lặp turn (`loop.py`, class `ChatLoop`):

- Persist user message trước khi gọi model.
- Build `messages` từ DB (content blocks verbatim) + system prompt
  (`prompt.py` — dạy pipeline: get_project_state trước, gen→segment→rig→preset, dùng
  screenshot_viewport để NHÌN kết quả, mọi thứ undoable).
- Gọi anthropic **streaming** (SDK Python `client.messages.stream`):
  model `claude-opus-4-8` (env override `SPINE_SERVER_CHAT_MODEL`),
  `thinking={"type": "adaptive", "display": "summarized"}`, `max_tokens=8192`,
  KHÔNG set temperature, `tools` = schemas từ hello.
- Stream events → ws: text delta → `delta`; thinking delta → `thinking`;
  `tool_use` hoàn chỉnh → `op {id, tool, params}` → chờ `op_result`
  (timeout 120s/op; riêng `generate_image`/`segment_image` 300s).
- Hết stream: persist assistant content blocks; nếu stop_reason `tool_use` → persist
  user message chứa **TẤT CẢ tool_result trong MỘT message** (đúng thứ tự tool_use) →
  vòng tiếp. `pause_turn` → tiếp tục tự động với messages hiện có. `refusal` →
  `error` + kết thúc turn. `end_turn`/`max_tokens` → `turn_done {stopReason}`.
- Cap 40 vòng/turn (vượt → `error` "loop limit").
- `stop` từ client: hủy stream đang chạy (đóng stream, persist phần đã nhận, op đang
  chờ bị hủy trả tool_result `is_error` "cancelled by user" — lệnh editor đã chạy thì
  vẫn hoàn tất, chỉ kết quả bị bỏ), `turn_done {stopReason: "cancelled"}`.
- Sau turn ĐẦU của conversation: `title` = 60 ký tự đầu user text (cắt tại ranh giới
  từ, không gọi model), persist + gửi `title`.
- Key anthropic: đọc vault (provider `anthropic`, đã whitelist). Thiếu →
  `error` "Add your Anthropic API key in Server ▸ API keys" ngay khi nhận `user`.
- Lỗi op (editor trả `ok: false`): tool_result `is_error: true` với message — model tự
  sửa (không ngắt turn). Lỗi anthropic API (401/429/500): `error` với message gọn +
  kết thúc turn (messages đã persist đến đâu giữ đến đó).

`fake.py` — `SPINE_SERVER_CHAT_FAKE=1`:

- Thay client anthropic bằng backend giả cùng interface streaming; **bỏ qua key check**.
- Kịch bản cố định (không phụ thuộc nội dung user text, turn đầu của conversation):
  text "Bắt đầu tạo nhân vật..." → `tool_use generate_image {provider: "mock",
prompt: "<user text>", transparent: true}` → `tool_use segment_image {backend:
"mock", asset: "<tên asset từ tool_result trước>", place_on_canvas: true}` →
  `tool_use rig_from_parts {}` → `tool_use apply_preset_animation {preset: "walk"}` →
  `tool_use screenshot_viewport {}` → text "Xong — nhân vật đang đi bộ." Mỗi tool_use
  một vòng (tuần tự, đọc tool_result trước đó); turn sau: chỉ text echo
  "fake: <user text>". Deterministic → pytest + e2e không cần key/mạng.
- Fake đọc tool_result thật từ editor → chuỗi generate/segment/rig/preset chạy THẬT
  (REST mock provider, ops, commands) — chỉ phần "trí tuệ" là kịch bản.

## 6. `packages/editor` — ChatClient + ChatWindow

`src/chat/client.ts` — `ChatClient`:

- URL ws suy từ `serverUrl()` (http→ws) + access token hiện có (module auth trong
  `src/server/api.ts` expose token getter; nếu chưa có sẵn thì thêm export nhỏ).
- Gửi `hello {tools: toolJsonSchemas()}` ngay khi open; nhận `op {id, tool, params}`
  → resolve `tool` qua `TOOL_DEFS` (lấy `op` + `result`) → `dispatchOp(def.op, params)`
  (import từ `src/bridge/ops.js`) → build content blocks theo result kind: `text` →
  `[{type:'text', text: JSON.stringify(result)}]`; `image` → `[{type:'image',
source:{type:'base64', media_type:'image/png', data}}]`; `atlas` → text + image
  blocks. Tool không có trong defs hoặc dispatch lỗi → `op_result {ok:false, error}`.
- Emit events cho UI (message list, streaming buffer, trạng thái turn).
- Không auto-reconnect giữa turn (ws đứt → hiện lỗi, user bấm mở lại; giữ đơn giản).

`components/ChatWindow.tsx` — cửa sổ nổi:

- Toggle bằng nút `Chat` trên Toolbar (cạnh Segment). Chỉ hoạt động khi đã đăng nhập
  (chưa đăng nhập → nội dung window hướng dẫn mở Server ▸ đăng nhập; thiếu key →
  render message `error` từ server, có nút mở Server modal).
- Kéo theo header (pointer events, clamp trong cửa sổ), resize bằng góc dưới-phải,
  vị trí/kích thước lưu `localStorage` (`spine-editor.chat-window`), mặc định 380×520
  góc phải-dưới. `z-index` trên viewport, dưới modal. Không che Toolbar.
- Header: title + dropdown chuyển conversation (kèm New/Delete) + nút đóng.
  Mở window → load conversations qua REST, chọn gần nhất hoặc tạo mới; đổi
  conversation → đóng ws cũ, load messages (render transcript từ content blocks),
  mở ws mới.
- Transcript: bubble user/assistant (text), thinking thu gọn (details, mờ), chip tool
  `🔧 <name> ✓/✗` (click xem params/kết quả rút gọn), auto-scroll đáy.
- Input: textarea + Send (Enter gửi, Shift+Enter xuống dòng) + nút Stop hiện khi turn
  đang chạy. Disable input khi turn đang chạy.
- Conversation gắn `project_id` khi editor đang mở project server (state project-sync
  hiện có); project local → `project_id null`.

## 7. Tests & e2e

- **shared (vitest)**: `TOOL_DEFS` có 55 phần tử, tên unique, mỗi def có description
  không rỗng và op nằm trong `BRIDGE_OPS`; `toolJsonSchemas()` trả `input_schema.type
=== 'object'` cho cả 55; screenshot_viewport/export_atlas có result đúng.
- **mcp-server**: e2e `bridge.mjs` giữ nguyên (parity). Unit test hiện có giữ xanh.
- **server (pytest, chạy với `SPINE_SERVER_CHAT_FAKE=1`)**:
  - REST conversations CRUD + auth (401 khi thiếu token, 404 conversation người khác).
  - ws: connect không token → close 4001; hello → ready; turn fake đầy đủ qua
    `TestClient.websocket_connect` — client giả trả `op_result` cứng cho từng op, xác
    nhận thứ tự messages persist (user → assistant(tool_use) → user(tool_result) → …
    → assistant(text)), `turn_done`, `title` sau turn đầu.
  - Resume: turn thứ 2 trong conversation cũ gửi kèm history (fake echo).
  - Không fake + thiếu key → `error` nhắc thêm key (test với FAKE=0, không gọi mạng vì
    chặn ngay ở key check).
- **e2e mới `packages/editor/e2e/chat.mjs`** (Chromium thật, server
  `SPINE_SERVER_CHAT_FAKE=1 SPINE_SERVER_SEGMENT_FAKE=1`, cổng riêng như server.mjs):
  đăng ký user + đăng nhập qua UI → mở Chat window → gõ "tạo hiệp sĩ và cho nó đi bộ"
  → đợi turn xong (chip `apply_preset_animation ✓`) → assert qua
  `window.__spineEditor`: bones chứa `spine`/`upper_leg_l`, animations chứa `walk`,
  transcript có ≥5 tool chips → screenshot window + viewport.
- CI: job server đã chạy pytest (fake không cần GPU/key); e2e chat chạy tay như các
  e2e khác (không đưa vào CI — cần Chromium + server).

## 8. Nghiệm thu

1. `pnpm test` + `pnpm typecheck` + lint/format xanh; `uv run pytest` xanh.
2. `bridge.mjs` pass nguyên trạng (`toolCount: 55`) — parity refactor.
3. `chat.mjs` pass: một câu chat → gen(mock) → segment(mock) → rig → walk trong
   viewport (PLAN §7.6 Phase 14 mục 4, bản fake-model).
4. Smoke tay với key anthropic thật: chat "make a simple knight and make it walk" ra
   nhân vật đi bộ; đóng mở lại editor → conversation resume đúng transcript.
5. PLAN.md đánh dấu Phase 14 ✅ (cả 2 slice, kèm ghi chú thực hiện); CLAUDE.md cập
   nhật (chat ws, bảng mới, e2e chat.mjs).

## 9. Không làm (sau này)

- Model picker UI (hardcode `claude-opus-4-8`, override qua env server).
- Đặt title bằng model; edit/regenerate/branch message; upload ảnh của user vào chat.
- Nhiều tab cùng mở một conversation (ws sau thay ws trước không đồng bộ transcript).
- Auto-reconnect ws giữa turn; rate-limit riêng cho chat.
- Chạy chat không đăng nhập / không server (chat là tính năng server-only).
