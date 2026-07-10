# Spec: Bridge hardening (nền cho Phase 14)

- **Ngày**: 2026-07-10
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: `packages/shared`, `packages/mcp-server`, `packages/editor` (bridge + 1 ô nhập ServerModal), `packages/core` (commands + tests + doc comment), skill spine-rigging, e2e bridge.mjs. Không đụng `server/` Python.

## 1. Bối cảnh & mục tiêu

Phase 14 (AI chat auto-rig) sẽ chạy trực tiếp trên WebSocket bridge — đợt phân tích
07/2026 chỉ ra bridge là chỗ yếu nhất hệ thống. Batch này vá 7 điểm trước khi xây tiếp:

1. Op name là chuỗi trần lặp 3 nơi (`tools.ts` → wire → `ops.ts`), typo chỉ lộ lúc runtime.
2. Editor tab đóng giữa chừng → request đang bay treo đủ 20s (pending map không được drain).
3. `generate_image` (gọi AI ngoài, có thể >20s) chịu chung timeout 20s → lỗi giả.
4. Tab mới cướp kết nối im lặng; tab cũ tự reconnect sau 3s → **hai tab ping-pong vô hạn**
   (bug tiềm ẩn xác nhận từ `bridge.ts` `onclose → setTimeout(connect, 3000)`).
5. Bridge không xác thực — process local nào cũng điều khiển được editor, kể cả proxy
   `generate_image` chạy bằng BYOK key của user đang đăng nhập.
6. Chỉ có `RemoveIkConstraint` — không xóa undoable được transform/path/physics constraint.
7. Thiếu test: `PhysicsSimulator` (222 LOC stateful) không có test riêng; atlas writer/parser
   chưa có round-trip test; header `evaluate.ts` lỗi thời; path applier đăng ký qua
   import side-effect chỉ trong barrel.

## 2. Thiết kế

### 2.1. Op protocol dùng chung (`packages/shared/src/index.ts`)

```ts
export const BRIDGE_OPS = [
  'ping',
  'get_project_state',
  // …53 op hiện có còn lại (liệt kê đủ lúc implement, nguồn: switch trong ops.ts)…
  'remove_ik_constraint',
  'remove_transform_constraint',
  'remove_path_constraint',
  'remove_physics_constraint',
] as const; // 59 ops
export type BridgeOp = (typeof BRIDGE_OPS)[number];

export interface BridgeRequest {
  id: number;
  op: BridgeOp; // trước là string
  params?: Record<string, unknown>;
}

export interface BridgeNotice {
  notice: 'replaced';
}
```

- `tools.ts`: `forward(op: BridgeOp)` — op sai là lỗi compile.
- `ops.ts`: `dispatchOp(op: string, …)` giữ signature ở boundary, bên trong
  `const o = op as BridgeOp; switch (o) { …59 case… default: }` với default gán
  `const _exhaustive: never = o` rồi throw `Unknown op` như cũ — **thiếu case nào
  là lỗi compile**, chuỗi lạ lúc runtime vẫn throw như hành vi hiện tại.
- Danh sách op lấy từ `ops.ts` hiện có (55 case) — đối chiếu bằng codegraph/grep lúc
  implement, không được bịa thêm/bớt.

### 2.2. Reject pending khi disconnect (`bridge-server.ts`)

`ws.on('close')` hiện chỉ `this.editor = null`. Thêm: drain toàn bộ `pending` —
với mỗi entry `clearTimeout(timer)` + `reject(new Error('Editor tab disconnected while handling "<op>".'))`
rồi `pending.clear()`. `Pending` interface thêm field `op: string` để báo lỗi rõ.

### 2.3. Timeout theo op (`bridge-server.ts` hoặc file const cạnh nó)

```ts
const OP_TIMEOUTS: Partial<Record<BridgeOp, number>> = {
  generate_image: 120_000,
  import_atlas: 60_000,
};
// request(): timeoutMs = opts?.timeoutMs ?? OP_TIMEOUTS[op] ?? 20_000
```

### 2.4. Takeover notice + hết ping-pong

- Server (`connection` handler): trước khi `close()` tab cũ, gửi nó
  `JSON.stringify({ notice: 'replaced' } satisfies BridgeNotice)` rồi
  `close(4000, 'replaced by new editor tab')`.
- Editor (`bridge.ts` `onmessage`): parse xong, nếu object có key `notice` →
  không dispatch; với `'replaced'`: set store error
  `"MCP bridge đã chuyển sang tab khác — reload tab này để giành lại."`,
  đặt cờ `replaced = true`.
- `onclose`: nếu `replaced` → **không reconnect** (hết ping-pong); ngược lại giữ
  retry 3s như cũ.

### 2.5. Token auth opt-in

- **Server**: đọc `process.env.SPINE_BRIDGE_TOKEN` lúc khởi tạo `BridgeServer`.
  Nếu đặt: trong `connection` handler, parse `req.url` (`/editor?token=…`);
  token thiếu/sai → `ws.close(4001, 'invalid bridge token')`, không gán `this.editor`.
- **Editor** (`bridge.ts`): đọc `localStorage['spine-editor.bridge-token']`; nếu có,
  URL nối `?token=<encodeURIComponent>`. `onclose` với code 4001 → set store error
  `"Bridge token sai hoặc thiếu — nhập trong Server ▸ MCP Bridge."` một lần, retry
  giãn thành 15s (thay vì 3s) để đỡ spam.
- **UI** (`ServerModal.tsx`): section nhỏ "MCP Bridge" — 1 input password + nút Save
  ghi localStorage; đổi token xong gọi lại kết nối (reload bridge: đơn giản nhất là
  hướng dẫn reload tab trong label, KHÔNG xây cơ chế reconnect nóng).
- Không đặt env = server nhận mọi kết nối (như hiện tại). Token chỉ so sánh bằng
  (không hash — secret local dev, threat model là process khác trên máy).

### 2.6. Core: Remove{Transform,Path,Physics}Constraint

3 class mới trong `commands/constraints.ts`, mirror `RemoveIkConstraint`
(constraints.ts:122): `findIndex` theo tên trong `data.transform|path|physics` →
không có thì throw; quét `data.animations` — animation nào có
`anim.transform|path|physics[name]` thì throw
`Cannot remove … referenced by animation "<tên>"`; splice + nhớ index; undo splice
lại đúng vị trí. Export qua `index.ts`.

MCP: 4 tool mới `remove_ik_constraint`, `remove_transform_constraint`,
`remove_path_constraint`, `remove_physics_constraint` (params: `{ name: string }`)
→ 4 op cùng tên trong `ops.ts` gọi command tương ứng (IK dùng command sẵn có).
Tổng tool 48 → **52**. `skills/spine-rigging/SKILL.md` thêm 1 dòng về xóa constraint.

### 2.7. Tests + docs hygiene

- `packages/core/test/physics.test.ts` (mới): cùng `t` gọi 2 lần → pose y hệt
  (determinism); tua ngược → kết quả khớp mô phỏng fresh từ 0; gravity/wind đổi dấu
  → offset đổi hướng; `limit` clamp biên; 2 constraint độc lập không lẫn state.
- `packages/core/test/atlas-roundtrip.test.ts` (mới): `packAtlas` → `atlasToText` →
  `parseAtlas` → regions khớp tên/kích thước/vị trí (thêm case region xoay nếu packer
  hỗ trợ rotation flag — nếu packer chưa từng ghi `rotate: true` thì chỉ test không xoay,
  ghi chú rõ trong test).
- `packages/core/test/constraints.test.ts` (mới hoặc mở rộng file test sẵn có):
  3 command mới — xóa được, blocker theo animation, undo đúng index giữa mảng.
- `packages/mcp-server/test/bridge-server.test.ts` (**test đầu tiên của package**,
  vitest + `ws` client thật, port ngẫu nhiên): (a) close editor giữa request → reject
  ngay với message disconnect; (b) `OP_TIMEOUTS` áp dụng đúng op; (c) token đặt +
  client đúng/sai/thiếu token → nhận/close 4001; (d) tab thứ hai kết nối → tab đầu
  nhận `{notice:'replaced'}` + close 4000.
- `evaluate.ts` header (dòng 5–8): sửa thành mô tả đúng hiện trạng (IK/transform/path
  đã evaluate, physics preview qua simulator, colors/deform/draw-order đã evaluate;
  events + transform-mix/physics-property/inherit/two-color/sequence timelines chưa).
- `evaluate.ts` thêm `import './path.js';` (kèm comment "registers the path-constraint
  applier — see pose.ts registerPathConstraintApplier") + comment đối xứng tại
  `pose.ts` điểm đăng ký. `index.ts` giữ import như cũ.
- E2E `packages/mcp-server/e2e/bridge.mjs`: sau probe IK sẵn có, thêm
  `remove_ik_constraint` → `get_skeleton_tree` xác nhận constraint biến mất → undo
  → xác nhận trở lại.

## 3. Tương thích & lỗi

- Mọi thay đổi additive; editor build cũ nhận notice sẽ parse ra object không có
  `id` → nhánh notice mới xử lý, code cũ chỉ bỏ qua (dispatch fail im lặng như trước).
- Không token = hành vi hiện tại. `BridgeRequest.op` đổi type chỉ ảnh hưởng compile-time.
- Lỗi mới đều là `Error` message rõ ràng qua kênh response sẵn có.

## 4. Nghiệm thu

1. `pnpm typecheck` — xóa 1 case bất kỳ khỏi switch `ops.ts` phải LỖI compile (thử tay
   lúc dev, không giữ lại); build sạch khi đủ case.
2. `pnpm test` xanh — gồm 4 file test mới (physics, atlas round-trip, constraints
   remove, bridge-server).
3. E2E `bridge.mjs` pass với probe remove-constraint mới (52 tools).
4. Smoke tay 2 tab: mở tab 2 → tab 1 hiện thông báo replaced và không cướp lại.
5. Smoke token: đặt `SPINE_BRIDGE_TOKEN=abc`, editor chưa nhập token → error 4001 +
   retry giãn; nhập đúng token + reload → kết nối OK.
6. `pnpm lint && pnpm format:check` xanh.

## 5. Không làm (YAGNI)

- Không refactor switch `ops.ts` thành registry (chỉ thêm exhaustiveness check).
- Không origin-check, không rate-limit bridge, không hash token.
- Không đụng `server/` Python (Phase 14 sẽ tự tiêu thụ `BRIDGE_OPS` khi đến lúc).
- Không xây hot-reconnect khi đổi token (hướng dẫn reload tab).
