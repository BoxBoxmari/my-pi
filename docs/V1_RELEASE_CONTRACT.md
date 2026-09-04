# my-pi V1 Release Contract

**my-pi (formerly Coding Capability Runtime (my-pi)) v1.1** — Host-neutral coding capability substrate exposed through Model Context Protocol (MCP).

---

## 1. 13-Tool MCP Surface

my-pi v1.1 advertises a complete 13-tool MCP catalog over stdio transport; clean-install qualification exercises representative operations:

| Category | Tools | Capabilities & Guarantees |
|---|---|---|
| **Inspection** | `workspace_info` | Normalized authoritative root, revisions, operational capability catalog |
| **Filesystem** | `fs_read`, `fs_stat`, `fs_write`, `fs_patch` | Bounded chunk streaming, SHA-256 fingerprinting, content-preconditioned single-file mutation, Hashline anchor patching, atomic replacement |
| **Search** | `search` | Grep & Glob with pre-read policy boundary, gitignore respect, exact total count |
| **AST** | `ast_search` | Tree-Sitter structural search across 5 languages (TypeScript, JavaScript, Python, Rust, Go) |
| **LSP** | `lsp_status`, `lsp_diagnostics`, `lsp_symbols`, `lsp_navigate` | Multi-language server lifecycle (TypeScript, Python, Rust, Go), auto-restart with exponential backoff, hover/definition/references/symbols |
| **VCS** | `vcs_status`, `vcs_diff` | Working-copy status, hunk diffs with automatic artifact spilling past size limit |

---

## 2. Invariant Security & Safety Model

1. **Pre-read Policy Boundary (P0.2)**: Sensitive and secret files (`.env*`, `.aws/`, `id_rsa`, etc.) are denied *before* reading or traversal into directories.
2. **Read-Spy Verification**: Zero unauthorized file handles are opened on denied visible paths.
3. **Content-Preconditioned Mutation (P0.8)**: `fs_write` and `fs_patch` on existing files require `expected_hash` matching the current file content. Stale writes fail closed.
4. **Atomic Replacement (P0.9)**: File mutations write to adjacent temporary files and atomically replace targets, preserving file modes and avoiding partial writes.
5. **No-Clobber File Creation (R0.1.4)**: New file creations fail closed if target path appears prior to publication.
6. **Deterministic Cancellation (P0.4)**: In-flight MCP requests abort with typed `ERR_ABORTED` on client cancellation.

---

## 3. Supported Languages Matrix

| Language | AST Backend | Compatible LSP Server (host-provided) | Root Markers |
|---|---|---|---|
| **TypeScript / JS** | Tree-Sitter (`tree-sitter-typescript`, `tree-sitter-javascript`) | `typescript-language-server` | `tsconfig.json`, `package.json` |
| **Python** | Tree-Sitter (`tree-sitter-python`) | `pyright-langserver` / `pylsp` | `pyproject.toml`, `setup.py`, `requirements.txt` |
| **Rust** | Tree-Sitter (`tree-sitter-rust`) | `rust-analyzer` | `Cargo.toml` |
| **Go** | Tree-Sitter (`tree-sitter-go`) | `gopls` | `go.mod` |

The package integrates with these language-server protocols but does not bundle
the server executables. Hosts must provide a compatible executable when an LSP
operation needs one.

---

## 4. Performance & Scalability Floor

- **Traversal**: 100,000-file validation is a candidate-bound release gate, not a permanent claim until the strict release run passes.
- **Stdio Protocol Overhead**: Observed per benchmark run; no cross-runner latency threshold is release-blocking for alpha.
- **Memory Footprint**: Bounded RSS with automatic idle server teardown after 30s.
- **Spill Artifacts**: VCS diffs and large query responses spill to local artifact store to prevent MCP token exhaustion.

---

## 5. Verification & Conformance Gates

All local verification criteria must pass executable machine checks (`pnpm verify`, `pnpm test`, `node scripts/pr-smoke.mjs`, `node scripts/verify-gates.mjs`). Release admission is a separate candidate-bound step: run `pnpm bind:evidence` and then `pnpm verify:release` for the exact commit under qualification:
- `G0`: Protocol era negotiation (`2025-11-25`)
- `G1`: 13-tool discovery and JSON-RPC lifecycle
- `G2`: Search pre-read policy and exact count
- `G3`: Single-file safe mutation matrix (UTF-8, UTF-16 BOM, CRLF, LF)
- `G4`: Tree-Sitter AST 5-language search & VCS operations
- `G5`: Multi-language LSP lifecycle and recovery
- `G6`: Host compatibility with blocking (Claude Code, OpenCode) and monitoring hosts (Cursor, Antigravity, Copilot)
- `R0`: Architectural boundaries, composite project references, and error type safety.
