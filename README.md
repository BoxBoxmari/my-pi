# Coding Capability Runtime (CCR) v1.1

> **Host-neutral coding capability substrate exposed through MCP — not an agent framework, not a Pi/Oh My Pi wrapper.**

**Current stage: Integration Foundation / Alpha (post-R0 remediation).** 8 of 13 catalog tools are functional. Hosts are connected at transport level — that is handshake evidence, not certification. No performance claims exist (benchmarks not yet run).

---

## Remediation status (R0 — passed 2026-09-01)

All P0 correctness/security findings are closed with regression evidence:

| P0 | Fix |
|---|---|
| P0.1 VCS authority | Workspace-resolved absolute path mandatory; typed failures (non-git, git-missing, permission, abort, generic) — never fake empty data |
| P0.2 Sensitive files | Policy gate enforced during traversal, before any read (read-spy proven; visible sensitive files never opened) |
| P0.3 Search scoping | Searches `resolved.absolute`; file scope → typed error; sibling isolation proven |
| P0.4 Cancellation | SDK `ctx.mcpReq.signal` wired end-to-end (search, git subprocess, retry delays); cancel survives connection |
| P0.5 SDK v2 | Official `@modelcontextprotocol/server@2.0.0` + `core@2.0.0` + client `2.0.0`; legacy v1 dep removed; `zod@4.5.4` |
| P0.6 Era truth | Observed-over-wire: **2025-11-25** (SDK supports 2025-11-25…2024-10-07; the old "2026-07-28" placeholder was an assumption, removed) |
| P0.7 UTF-16 | BOM detection precedes binary heuristic; LE/BE end-to-end read/patch proven |
| P0.8 Stale-safe writes | Overwrite REQUIRES `expected_hash`; create verifies non-existence at commit |
| P0.9 Metadata | Mode bits captured/restored; read-only target fails closed (`ERR_FILE_BUSY`, never truncate) |

P1: capability boundaries enforced by `scripts/architecture-check.mjs` (fs logic lives in `@ccr/fs`); 13-tool catalog with per-tool `ccr/availability` `_meta`; truthful `backendHealth`; exact search `totalCount` (Contract A); real monotonic `timing.totalMs`; CI workflow (win+ubuntu, Node 24).

**Documented environment BLOCKED items** (armed tests, CI-covered, not silently passed): POSIX executable-bit preservation; true Windows lock-injection; benchmarks (P1.7).

## Repository layout

16 package directories: `apps/ccr-mcp` + `packages/{contracts, workspace-runtime, policy, artifact-store, observability, native-ports, native-loader, fs, search, hashline, ast, lsp, vcs, mcp-adapter, host-profiles, testing}` plus `crates/ccr-native` (Rust scaffold), `provenance/`, `fixtures/`, `docs/gates/`.

## Build & test

```powershell
CI=true pnpm install          # or: pnpm install --frozen-lockfile
npx tsc --build                # build + typecheck
node --experimental-strip-types --test "packages/*/test/*.test.ts"
node scripts/architecture-check.mjs
```

Current evidence: **76 tests — 75 pass, 0 fail, 1 skip** (POSIX-mode test, win32 reason recorded). Architecture check PASS. Frozen-lockfile install PASS.

## Run the MCP server

```powershell
node --experimental-strip-types apps/ccr-mcp/dist/main.js --workspace <path>
```

Registered in hosts (transport-connected evidence):
- OpenCode: `opencode mcp list` → `ccr ✓ connected`
- Claude Code: `claude mcp list` → `ccr √ Connected`

Generate host configs: `node apps/ccr-mcp/dist/main.js host-config <profile>` (9 profiles).

## Tool catalog (13) — availability

| Tool | Status |
|---|---|
| `workspace_info`, `fs_read`, `fs_stat`, `fs_write`, `fs_patch`, `search`, `vcs_status`, `vcs_diff` | **implemented** |
| `ast_search`, `lsp_status`, `lsp_diagnostics`, `lsp_symbols`, `lsp_navigate` | planned (typed `ERR_UNSUPPORTED_CAPABILITY`) |

Each tool advertises `ccr/availability` in `_meta`; catalog stays capped at 13.

## Status terms

Scaffold / Connected / Functional / Certified / PASS / PARTIAL / BLOCKED — see `docs/gates/R0_REMEDIATION_GATE_REPORT.md`. "Connected" ≠ "Certified".

## Gate reports

`docs/gates/`: G0 (PARTIAL), G1 (PARTIAL), G2 (PARTIAL — Node fallback only), **G3 (PASS, re-earned, 2 documented platform BLOCKED)**, G4 (PARTIAL — VCS done, AST blocked), G5 (BLOCKED), G6 (PARTIAL — hosts connected, not certified), **R0 (PASS)**.

## Next (post-R0, in order)

1. AST search backend qualification (`pi-ast` or narrower) → `ast_search`.
2. LSP feasibility spike → `lsp_*`.
3. Persistent read-only LSP (G5).
4. G6 same-task behavioral certification on Claude Code + OpenCode.
