# Coding Capability Runtime (CCR) v1.1

> **Host-neutral coding capability substrate exposed through MCP — not an agent framework, not a Pi/Oh My Pi wrapper.**

Trạng thái hiện tại: **Production Foundation — 8/13 tools hoạt động, 43/43 tests pass, 2 blocking hosts đã kết nối thật.**

---

## 1. Trạng thái Production hiện tại (2026-09-01)

| Nhóm | Trạng thái | Bằng chứng |
|---|---|---|
| **Foundation (G0/G1)** | ✅ PARTIAL — scaffold + provenance hoàn chỉnh | `pnpm-lock.yaml`, `provenance/*`, `tsc --build` exit 0 |
| **FS (G1/G3)** | ✅ PASS (Node scope) | `fs_read`, `fs_stat`, `fs_write`, `fs_patch` + Hashline CAS, mutex, atomic replace, read-back verify |
| **Search (G2)** | ✅ PASS (Node fallback) | `search(mode=grep\|glob)` — NodeFallbackSearchBackend, chặn sensitive, `backend=node-fallback` |
| **VCS (G4)** | ✅ PASS | `vcs_status`, `vcs_diff` qua git CLI read-only |
| **MCP Adapter** | ✅ 8/13 tools functional | `workspace_info` + 5 FS/search/vcs; 5 còn lại trả `ERR_UNSUPPORTED_CAPABILITY` |
| **Host Profiles** | ✅ 9 profiles + renderer | `ccr host-config <profile>` |
| **Host Integration** | ✅ 2 blocking hosts **connected** | `opencode mcp list` → `ccr ✓ connected` · `claude mcp list` → `ccr √ Connected` |
| **Stdio Conformance** | ✅ Real OS pipe | Test `StdioClientTransport` spawn binary thật → 13 tools discoverable |
| **Tests** | ✅ 43/43 pass | `node --experimental-strip-types --test "packages/*/test/*.test.ts"` |
| **Các tool chưa xong** | ⛔ BLOCKED (5) | `ast_search`, `lsp_status/diagnostics/symbols/navigate` — cần supplier native / LSP spike |
| **Native (N-API)** | ⛔ BLOCKED | Cần Node 24 × 3 OS (hiện chỉ có win32 + Node 26) |
| **Supply-chain audit** | ⛔ BLOCKED | Cần `cargo-audit`/`cargo-deny` + SBOM từ graph |

> **Kết luận:** Đây là **Production Foundation** — có thể chạy như một MCP server thực tế cho 8 thao tác cốt lõi, đã được kiểm chứng end-to-end qua SDK thật và qua 2 host thật. Không tuyên bố V1 freeze; các mục BLOCKED được ghi rõ trong `docs/gates/`.

---

## 2. Cấu trúc sau khi dịch chuyển

Toàn bộ `coding-capability-runtime/` đã được **dịch chuyển ra thư mục gốc `my-pi/`** và xóa folder trung gian. `my-pi` hiện là monorepo gốc:

```
my-pi/
├── apps/ccr-mcp/          # CLI + MCP stdio server
├── packages/              # @ccr/* — contracts, policy, workspace-runtime, hashline, search, vcs, mcp-adapter, ...
├── crates/ccr-native/     # Scaffold Rust (chưa build native)
├── provenance/            # UPSTREAM.lock.json, EXTRACTION_MAP.json, SUPPLIER_DEPENDENCIES.json, THIRD_PARTY_NOTICES.md, SBOM.cdx.json
├── docs/
│   ├── ARCHITECTURE.md, CONTRACTS.md, SECURITY_MODEL.md, HOST_COMPATIBILITY.md
│   └── gates/             # 10 báo cáo G0–G6
├── fixtures/demo/         # Workspace demo
├── opencode.json          # MCP config cho OpenCode (đã trỏ về my-pi)
├── Cargo.toml, pnpm-workspace.yaml, tsconfig.*.json
└── README.md              # (file này)
```

Các folder **có chủ ý để trống** (đã thêm `.gitkeep`):
- `benchmarks/` — dành cho benchmark suite (G2+)
- `host-configs/` — output của `ccr host-config` (sinh động, không commit)
- `upstream/` — checkout bất biến của `earendil-works/pi` và `can1357/oh-my-pi` (sẽ clone khi cần audit)

Các folder `.agent/agent-skills`, `.cursor/.mcp/*` trống là placeholder của harness, không phải lỗi.

---

## 3. Yêu cầu hệ thống

- **Node.js ≥ 24** (khuyến nghị 24 LTS; hiện test trên 26.7.0 — Node 24 chưa kiểm chứng)
- **pnpm ≥ 11**
- **Rust ≥ 1.90** (chỉ cần khi build native)
- **Git** (cho `vcs_status`/`vcs_diff`)
- Windows x64 / macOS arm64 / Linux x64

---

## 4. Cài đặt & Kiểm tra toàn vẹn

```powershell
# Cài đặt (sửa lại symlink sau khi di chuyển)
CI=true pnpm install

# Build (typecheck + emit)
npx tsc --build

# Tests (43 tests — contracts, policy, workspace-runtime, hashline, vcs, host-profiles, mcp-adapter in-memory + real stdio)
node --experimental-strip-types --test "packages/*/test/*.test.ts"

# Kiểm tra empty folders có chủ ý (chỉ còn lại .gitkeep và harness placeholders)
Get-ChildItem -Recurse -Directory | Where-Object { (Get-ChildItem $_.FullName -Force | Measure-Object).Count -eq 0 }
```

Toàn vẹn sau di chuyển đã được kiểm chứng: `packages/*` đã được khôi phục đầy đủ (11 packages, 43 tests pass), `opencode.json` và `.claude.json` đã được cập nhật đường dẫn từ `coding-capability-runtime` về `my-pi`.

---

## 5. Chạy MCP Server

### 5.1 Chạy trực tiếp (stdio)
```powershell
node --experimental-strip-types apps/ccr-mcp/dist/main.js --workspace C:\path\to\workspace
# hoặc với APP:  CCR_WORKSPACE_ROOT=C:\path\to\workspace node apps/ccr-mcp/dist/main.js
```

Server khởi động, log ra `stderr`: `[ccr] workspace=... mode=workspace-write transport=stdio`, `stdout` chỉ chứa MCP protocol.

### 5.2 Tích hợp host

```powershell
# Sinh config cho từng host
node apps/ccr-mcp/dist/main.js host-config opencode-current-local
node apps/ccr-mcp/dist/main.js host-config claude-code-local
node apps/ccr-mcp/dist/main.js host-config cursor-local

# OpenCode — đã wire sẵn trong opencode.json (ccr ✓ connected)
opencode mcp list

# Claude Code — đã wire
claude mcp list   # ccr ... √ Connected
```

### 5.3 13 Tools

| # | Tool | Trạng thái | Mô tả |
|---|---|---|---|
| 1 | `workspace_info` | ✅ | Kiểm tra workspace |
| 2 | `fs_read` | ✅ | Đọc file + fingerprint/snapshot |
| 3 | `fs_stat` | ✅ | Stat file |
| 4 | `fs_write` | ✅ | Ghi file nguyên (CAS single-file) |
| 5 | `fs_patch` | ✅ | Patch Hashline single-file |
| 6 | `search` | ✅ | Grep/glob (Node fallback) |
| 7 | `ast_search` | ⛔ | Cần supplier pi-ast |
| 8 | `lsp_status` | ⛔ | Cần LSP spike |
| 9 | `lsp_diagnostics` | ⛔ | Cần LSP spike |
| 10 | `lsp_symbols` | ⛔ | Cần LSP spike |
| 11 | `lsp_navigate` | ⛔ | Cần LSP spike |
| 12 | `vcs_status` | ✅ | Trạng thái git |
| 13 | `vcs_diff` | ✅ | Diff git |

---

## 6. Tính toàn vẹn sau di chuyển — Giải trình

**Thesis ban đầu:** Dịch chuyển `coding-capability-runtime/*` ra `my-pi/` bằng `Move-Item` giữ toàn vẹn; các folder trống là có chủ ý.

**Antithesis (kiểm chứng):**
- `packages/*` sau di chuyển báo 0 file → **mất toàn bộ src** (bug do `Move-Item` với pnpm symlinks trên Windows).
- `benchmarks`, `host-configs`, `upstream` trống — có phải cũng là bug hay có chủ ý?

**Synthesis (đã khắc phục và kiểm chứng lại):**
- `packages/*` đã được **khôi phục đầy đủ từ nguồn** (11 packages, 43/43 tests pass sau `CI=true pnpm install && tsc --build`).
- `benchmarks`, `host-configs`, `upstream` **có chủ ý để trống** theo `Repository Structure v1.1` (placeholders cho benchmark suite, host-config output, upstream checkout). Đã thêm `.gitkeep` để làm rõ.
- `opencode.json` và `C:\Users\Admin\.claude.json` đã được **cập nhật đường dẫn** từ `coding-capability-runtime` về `my-pi` và kiểm chứng `*mcp list` vẫn `connected`.

**Bằng chứng cuối:** `node --experimental-strip-types --test` → 43 pass, `opencode mcp list` → `ccr ✓ connected`, `claude mcp list` → `ccr √ Connected`.

---

## 7. Báo cáo Gate

Xem `docs/gates/`:
- `G0_BASELINE_REPORT.md` — PARTIAL (scaffold + provenance; native/host/supply-chain blocked)
- `G0_NATIVE_SPIKE_REPORT.md`, `G0_MCP_ERA_DECISION.md`, `G0_SUPPLY_CHAIN_REPORT.md` — BLOCKED có lý do
- `G1_RUNTIME_FOUNDATION_REPORT.md` — PARTIAL (Node foundation pass; LSP spike blocked)
- `G2_SEARCH_TRACER_BULLET_REPORT.md`, `G3_SAFE_SINGLE_FILE_MUTATION_REPORT.md`, `G4_AST_VCS_READ_REPORT.md` — PASS/PARTIAL
- `G6_HOST_CERTIFICATION_REPORT.md` — PARTIAL (2 hosts connected, V1 freeze chưa đạt)

---

## 8. Bước tiếp theo

1. Cài `typescript-language-server` và thực hiện **LSP feasibility spike** → đưa 4 `lsp_*` tool lên hoạt động.
2. Thêm `ast_search` qua `@ast-grep/napi` (cùng engine, win32) hoặc hoàn thành supplier `pi-ast`.
3. Chạy `cargo-audit`/`cargo-deny` và sinh SBOM thật khi `crates/ccr-native` được kích hoạt.

---

*Generated: 2026-09-01 — CCR v1.1 Production Foundation*
