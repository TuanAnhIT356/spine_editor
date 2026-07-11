# Spec: Tái cấu trúc repo thành client/ + server/

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: di chuyển toàn bộ Node/TS workspace vào `client/` (git mv, giữ history);
  sửa CI, `.mcp.json`, scripts format, docs. KHÔNG đụng code `server/`, không đổi tên
  package, không flatten `packages/`.

## 1. Bối cảnh & mục tiêu

Repo hiện trộn Node workspace (package.json, packages/, examples/, configs) với
`server/` (Python) và meta (docs, skills, CLAUDE.md) ở cùng root. Mục tiêu: root chỉ
còn **2 thư mục code** — `client/` (toàn bộ frontend/Node) và `server/` (FastAPI,
nguyên trạng) — cộng meta. Đã chốt khi brainstorm:

- Base: main sau khi merge PR #16 (Phase 14 slice 2) — `e9db408`.
- Bố cục: **`client/packages/*`** (giữ lớp `packages/`, chuyển nguyên khối).

## 2. Bố cục đích

```
spine_editor/
├── client/                     # pnpm workspace tự trị (Node >= 22)
│   ├── package.json            # scripts giữ nguyên; format thêm globs ../docs
│   ├── pnpm-workspace.yaml     # nội dung không đổi ("packages/*")
│   ├── pnpm-lock.yaml
│   ├── tsconfig.base.json
│   ├── eslint.config.js
│   ├── .prettierrc.json
│   ├── .prettierignore
│   ├── packages/
│   │   ├── core/  editor/  mcp-server/  shared/    # git mv nguyên trạng
│   └── examples/               # fixtures round-trip của core
├── server/                     # FastAPI — KHÔNG THAY ĐỔI
├── docs/   skills/   README.md   CLAUDE.md   PLAN.md   LICENSE
└── .claude/   .github/   .gitignore   .mcp.json   render.yaml
```

## 3. Di chuyển (git mv — một commit riêng, không sửa nội dung)

| Từ (root)             | Đến                          |
| --------------------- | ---------------------------- |
| `packages/`           | `client/packages/`           |
| `examples/`           | `client/examples/`           |
| `package.json`        | `client/package.json`        |
| `pnpm-lock.yaml`      | `client/pnpm-lock.yaml`      |
| `pnpm-workspace.yaml` | `client/pnpm-workspace.yaml` |
| `tsconfig.base.json`  | `client/tsconfig.base.json`  |
| `eslint.config.js`    | `client/eslint.config.js`    |
| `.prettierrc.json`    | `client/.prettierrc.json`    |
| `.prettierignore`     | `client/.prettierignore`     |

Bất biến giữ mọi thứ chạy mà không sửa code:

- `packages/*/tsconfig.json` extends `../../tsconfig.base.json` → vẫn đúng
  (`client/packages/x` → `client/`).
- `packages/core/test/{fixtures,roundtrip}.test.ts` đọc
  `../../../examples/fixtures` → vẫn đúng (`client/examples/fixtures`).
- e2e scripts resolve đường dẫn nội package (`import.meta.url`) → không đổi.
- `pnpm-workspace.yaml` glob `packages/*` tương đối với vị trí file → không đổi.
- Root `node_modules/` (untracked) xóa; `pnpm install` chạy lại trong `client/`.

## 4. Sửa nội dung (commit thứ hai)

1. **`.github/workflows/ci.yml`** — job `ci` (Node):
   - thêm `defaults: run: working-directory: client`
   - `pnpm/action-setup` thêm `package_json_file: client/package.json` (action đọc
     field `packageManager` — giờ nằm trong client)
   - `actions/setup-node` thêm `cache-dependency-path: client/pnpm-lock.yaml`
   - job `server` giữ nguyên.
2. **`.mcp.json`** — codegraph không còn resolve qua `npx` ở root (root hết
   node_modules): `"command": "client/node_modules/.bin/codegraph"`,
   `"args": ["serve", "--mcp"]`.
3. **`client/package.json`** — `format` / `format:check` thêm globs để docs root vẫn
   được prettier như hiện nay:
   `prettier --write . "../docs/**/*.md" "../*.md"` (check tương tự). `lint` giữ
   `eslint .` (chỉ client — server chưa bao giờ thuộc eslint).
4. **`.prettierignore`** (đã nằm trong client): bỏ dòng `server/` (không còn cạnh nó),
   giữ `pnpm-lock.yaml`, `e2e-out/`.
5. **Docs**:
   - `CLAUDE.md`: mục Commands → chạy pnpm từ `client/`
     (`cd client && pnpm install/build/test/...`); cây Architecture thêm lớp
     `client/`; đường dẫn e2e → `client/packages/editor/e2e/*.mjs`,
     `client/packages/mcp-server/e2e/bridge.mjs`; ghi chú codegraph
     (`cd client && pnpm install` trước, bin ở `client/node_modules/.bin`).
   - `README.md`: cập nhật cấu trúc + lệnh.
   - `.claude/skills/verify/SKILL.md`: các lệnh e2e chạy từ `client/`.
6. **`.gitignore`**: giữ nguyên (toàn glob — `node_modules/`, `e2e-out/`,
   `.codegraph/` vẫn khớp mọi cấp).
7. **KHÔNG** rewrite path trong `docs/superpowers/` cũ (tài liệu lịch sử).

## 5. Kiểm chứng

1. Từ `client/`: `pnpm install` → `pnpm lint && pnpm format:check && pnpm typecheck
&& pnpm test && pnpm build` xanh (127 tests).
2. `server/`: `uv run pytest -q` + ruff xanh (không đổi — chỉ chạy xác nhận).
3. **E2E full chain** (đường dẫn mới, chạy từ `client/`):
   - `packages/mcp-server/e2e/bridge.mjs` → `toolCount: 55`, mọi flag như cũ.
   - `packages/editor/e2e/chat.mjs` (server CHAT_FAKE+SEGMENT_FAKE) →
     `chatRigWorks: true`.
4. Codegraph re-index: `client/node_modules/.bin/codegraph init .` từ root chạy được
   (index lại sau khi cây đổi).
5. CI xanh trên PR (cả 2 job).

## 6. Không làm (sau này nếu cần)

- Đổi tên scope `@spine-editor/*`; flatten `packages/`; tách repo.
- Di chuyển `skills/` hay `docs/` (meta, không phải code).
- Đụng bất kỳ file nào trong `server/` (kể cả Dockerfile/render flow).
- Rewrite tài liệu lịch sử trong `docs/superpowers/`.
