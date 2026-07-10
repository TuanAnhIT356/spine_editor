# Spec: Tích hợp codegraph vào dev workflow

- **Ngày**: 2026-07-10
- **Trạng thái**: Đã duyệt design, chờ implementation plan
- **Phạm vi**: Dev-tooling + docs. Không đụng code sản phẩm (`packages/`, `server/` giữ nguyên logic).

## 1. Bối cảnh & mục tiêu

AI agent (Claude Code) làm việc trên repo này hiện phải grep/read nhiều file để trả lời
câu hỏi cấu trúc ("command dispatch từ editor xuống core thế nào?", "cái gì gọi
`computePose`?"). Tích hợp [codegraph](https://github.com/colbymchenry/codegraph)
(colbymchenry, MIT, ~59k★) — code knowledge graph local-first — để agent trả lời các câu
hỏi đó bằng **một call MCP** `codegraph_explore`, giảm token và tool call.

Yêu cầu bắt buộc:

- Index phủ cả TypeScript/TSX (`packages/`) lẫn Python (`server/`) trong một index.
- 100% local, không API key, không service ngoài.
- Tự sync index khi code thay đổi (file watcher mặc định của codegraph).

## 2. Quyết định & các phương án đã loại

**Chọn: colbymchenry/codegraph v1.4+** — cài qua npm (`@colbymchenry/codegraph`),
SQLite + FTS5 tại `.codegraph/codegraph.db`, bundle sẵn runtime (không cần build),
1 MCP tool mặc định (`codegraph_explore`) trả về source + call paths + blast radius.

Đã cân nhắc và loại:

- **CodeGraphContext** (3.9k★, pip): cần graph DB backend (FalkorDB Lite đòi Python
  3.12+, server đang chạy 3.11+), nhiều tool → tốn token hơn.
- **codegraph-ai/CodeGraph** (35★): phải build bằng cargo, solo maintainer — rủi ro.
- **websines/codegraph-mcp** (13★): không auto-sync, gần như không maintain.
- **Tự xây indexer**: chi phí maintain không đáng so với tool có sẵn.

## 3. Thiết kế chi tiết

5 file thay đổi, không file nào thuộc code sản phẩm:

### 3.1. `package.json` (root)

Thêm devDependency, pin theo minor:

```jsonc
"devDependencies": {
  "@colbymchenry/codegraph": "^1.4.0",
  // ... giữ nguyên phần còn lại
}
```

- Lý do devDependency thay vì global: pin version, mọi dev/máy CI (nếu cần) có sau
  `pnpm install`, chạy qua `pnpm exec codegraph`.
- pnpm 10 chặn build script của dependency theo mặc định: nếu binary platform của
  codegraph cần postinstall, thêm `pnpm.onlyBuiltDependencies` với đúng tên package
  (xác định chính xác lúc implement bằng `pnpm approve-builds`).

### 3.2. `.mcp.json` (root — file mới, commit vào repo)

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "codegraph", "serve", "--mcp"]
    }
  }
}
```

- Cùng style với entry `spine-editor` đã hướng dẫn trong README (command `pnpm`).
- Claude Code tự nhận `.mcp.json` project-scoped (hỏi user approve lần đầu).
- Không thêm entry `spine-editor` vào file này trong scope hiện tại (xem §7).

### 3.3. `.gitignore`

Thêm:

```
# codegraph index (rebuild per-machine: pnpm exec codegraph init .)
.codegraph/
```

Upstream gợi ý commit index để clone có sẵn graph; repo này chọn **ignore** vì index
build lại nhanh (repo cỡ nhỏ) và tránh churn file binary trong git. Đổi ý sau chỉ cần
xóa dòng ignore.

### 3.4. `CLAUDE.md`

Thêm mục ngắn (tiếng Anh, cùng ngôn ngữ file) sau phần Commands:

- Agent ưu tiên tool MCP `codegraph_explore` cho câu hỏi cấu trúc/flow/callers trước
  khi grep/read thủ công.
- Setup lần đầu: `pnpm exec codegraph init .` (tạo `.codegraph/`, gitignored,
  tự sync khi code đổi). Rebuild: `pnpm exec codegraph index . --force`.
- Tắt telemetry: `pnpm exec codegraph telemetry off`.

### 3.5. `README.md`

1 đoạn trong mục Development: giới thiệu codegraph là dev-tool tùy chọn cho AI agent,
lệnh init, ghi chú fallback `npm i -g @colbymchenry/codegraph` nếu không muốn dùng
qua pnpm.

## 4. Luồng hoạt động

1. Dev mở Claude Code tại repo → Claude Code đọc `.mcp.json` → spawn
   `pnpm exec codegraph serve --mcp` (stdio, chạy local).
2. Agent gọi `codegraph_explore("how does the editor dispatch commands to core?")`
   → tool query `.codegraph/codegraph.db` → trả source các symbol liên quan + call
   paths trong một kết quả.
3. Khi code đổi, watcher (FSEvents trên macOS) debounce và sync index — không cần
   thao tác tay.

## 5. Xử lý lỗi

| Tình huống | Xử lý |
| --- | --- |
| Chưa init index | Docs (CLAUDE.md + README) ghi rõ lệnh init một lần |
| Lock file kẹt (crash giữa chừng) | `pnpm exec codegraph unlock` — ghi trong CLAUDE.md |
| pnpm không cài được binary platform | Fallback trong README: `npm i -g @colbymchenry/codegraph` **và** đổi `.mcp.json` command từ `pnpm` thành `codegraph` gọi trực tiếp từ PATH (README ghi cả hai bước) |
| Index lỗi thời/sai | `pnpm exec codegraph index . --force` |

## 6. Nghiệm thu (verification)

Chạy thật trên máy dev (không cần CI):

1. `pnpm install` xong, `pnpm exec codegraph --version` in đúng version.
2. `pnpm exec codegraph init .` chạy xong không lỗi; `codegraph status` báo số
   file/symbol > 0 cho **cả** `packages/` (TS/TSX) **và** `server/` (Python).
3. CLI smoke: `pnpm exec codegraph explore "how does the editor dispatch commands to core"`
   và `pnpm exec codegraph callers computePose` trả kết quả trỏ đúng file thật.
4. MCP handshake: script stdio nhỏ (scratch, không commit) gửi `initialize` +
   `tools/list` tới `pnpm exec codegraph serve --mcp`, xác nhận tool
   `codegraph_explore` có trong danh sách.
5. Auto-sync: sửa 1 file TS (thêm function tạm), đợi debounce, `codegraph query <tên>`
   thấy symbol mới; revert.
6. `pnpm lint && pnpm format:check` vẫn xanh (file mới không phá format config).

## 7. Không làm (YAGNI)

- Không đưa codegraph vào CI (index chỉ phục vụ dev-time agents).
- Không commit `.codegraph/`.
- Không bật thêm MCP tool phụ qua `CODEGRAPH_MCP_TOOLS` (mặc định 1 tool đủ).
- Không thêm entry `spine-editor` vào `.mcp.json` trong scope này (server đó cần
  editor tab đang mở; cân nhắc sau nếu muốn).
- Không liên quan Phase 13–14 của sản phẩm (segmentation/AI chat).

## 8. Rủi ro & lưu ý

- **Telemetry**: codegraph có anonymous telemetry — docs hướng dẫn tắt; không chứa
  code repo nhưng cứ tắt cho sạch.
- **Kích thước devDependency**: package bundle runtime riêng theo platform (optional
  deps) — tăng dung lượng `node_modules`, chấp nhận được cho dev-tool.
- **License**: tool MIT, chỉ là dev-dependency — không ảnh hưởng license Apache-2.0
  của repo (không ship cùng sản phẩm).
- **Độ chính xác `pnpm exec` trong `.mcp.json`**: cần verify lúc implement rằng
  Claude Code spawn command với cwd = repo root (nếu không, đổi sang đường dẫn
  tuyệt đối `node_modules/.bin/codegraph`).
