# my-pi v1.1

> Formerly known as CCR / Coding Capability Runtime.

[![CI](https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml/badge.svg)](https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-24%20LTS-green.svg)](https://nodejs.org)
[![MCP Protocol](https://img.shields.io/badge/MCP%20Era-2025--11--25-blue.svg)](https://modelcontextprotocol.io)

> **A deterministic, host-neutral coding capability substrate exposed through the Model Context Protocol (MCP) — engineered for safety, speed, and cross-platform fidelity.**

> **Migrating from CCR?** All legacy `ccr` names (binary `ccr-mcp`, `mcp.ccr` config key, `CCR_WORKSPACE_ROOT` / `CCR_MCP_ERA` env vars, `CcrError` class, `@ccr/*` packages) keep working as deprecated aliases for one major version. See the [migration guide](docs/MIGRATION_CCR_TO_MY_PI.md) for the full old → new mapping.

---

## 🚀 Overview

**my-pi (formerly Coding Capability Runtime (CCR))** provides LLM coding agents and host IDEs with a secure, high-performance execution layer. Rather than allowing raw shell escape hatches or fragile unvalidated edits, my-pi exposes a hardened 13-tool MCP catalog with server-side security policies, raw-byte SHA-256 fingerprinting, atomic single-file mutation, AST structural querying, and persistent multi-language LSP intelligence.

```
                           PRODUCT TARGETS
    Claude Code  ·  OpenCode  ·  Cursor  ·  Google Antigravity  ·  GitHub Copilot
                             │
                      MCP COMPATIBILITY EDGE
                      V1: stdio transport
                             │
                             ▼
                    ┌─────────────────┐
                    │   MCP Adapter   │
                    └────────┬────────┘
                             │
                             ▼
                 ┌───────────────────────┐
                 │  Capability Contracts │
                 └───────────┬───────────┘
                             │
                             ▼
    ┌────────────────────────────────────────────────────────┐
    │                   CAPABILITY RUNTIME                   │
    │  Workspace  │  Policy  │  Cancellation  │  Artifacts   │
    │  FS  │  Search  │  AST (Tree-Sitter)  │  LSP  │  VCS   │
    └────────────────────────┬───────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
      Native Backend                    Pure Node Fallback
    (napi-rs / Rust)                  (Zero-Dependency Engine)
```

---

## 🛠️ Complete 13-Tool MCP Surface

my-pi v1.1 implements and exposes all 13 production tools over stdio transport:

| Domain | Tool Name | Description & Capabilities |
|---|---|---|
| **Inspection** | `workspace_info` | Returns normalized authoritative workspace root, active revision, and capability manifest |
| **Filesystem** | `fs_read` | Bounded chunk streaming, SHA-256 fingerprinting, and encoding detection |
| | `fs_stat` | Size, timestamps, mode bits, binary classification, and existence metadata |
| | `fs_write` | Atomic file creation or CAS overwrite (requires matching `expected_hash`) |
| | `fs_patch` | Stale-safe single-file chunk/hashline patch with exact anchor verification |
| **Search** | `search` | High-throughput grep & glob search respecting `.gitignore` and pre-read security policies |
| **AST** | `ast_search` | Tree-Sitter structural search across **5 languages** (TypeScript, JavaScript, Python, Rust, Go) |
| **LSP** | `lsp_status` | Returns language server health, active instances, and capabilities |
| | `lsp_diagnostics` | Retrieves compiler/linter diagnostics for open workspace files |
| | `lsp_symbols` | Workspace and document symbol navigation |
| | `lsp_navigate` | Jump-to-definition, find-references, and hover documentation |
| **VCS** | `vcs_status` | Working tree status, modified/untracked files, and branch information |
| | `vcs_diff` | Structured hunk diff generation with automatic artifact spilling past size limits |

---

## 🛡️ Core Security & Reliability Invariants

- **Pre-Read Policy Gate (P0.2)**: Sensitive paths (`.env*`, `.aws/`, `id_rsa`, `*.key`) are denied *before* opening any file descriptor. Read-spy tests prove zero unauthorized file handles.
- **Compare-And-Swap (CAS) Mutation (P0.8)**: All mutations on existing files require `expected_hash`. Stale edits fail closed, preventing race conditions and silent overwrite.
- **Atomic Replacement & No-Clobber (P0.9, R0.1.4)**: Writes occur to temporary files in the same directory before atomic rename. File mode bits (`0o755`) and encoding/BOM/newlines (LF/CRLF) are strictly preserved.
- **Windows File-Lock Resilience (G3)**: Transient sharing violations and locked handles fail closed with typed `ERR_FILE_BUSY` instead of falling back to truncate-and-overwrite.
- **Deterministic Cancellation (P0.4)**: Client cancellation signals cleanly abort in-flight searches, git subprocesses, and LSP queries with `ERR_ABORTED`.

---

## 🌐 Supported Language Intelligence

### AST Structural Engine (Tree-Sitter WebAssembly)
- **TypeScript & JavaScript**: `tree-sitter-typescript`, `tree-sitter-javascript`
- **Python**: `tree-sitter-python`
- **Rust**: `tree-sitter-rust`
- **Go**: `tree-sitter-go`

### Persistent LSP Lifecycle
- **TypeScript**: `typescript-language-server --stdio`
- **Python**: `pyright-langserver --stdio` / `pylsp`
- **Rust**: `rust-analyzer`
- **Go**: `gopls serve`
- **Lifecycle Guarantees**: Lazy initialization, exponential restart backoff (`[100ms, 200ms, 400ms]`), idle timeout eviction (30s), and synchronous process-tree termination on Windows (`taskkill /T /F`).

---

## 📦 Monorepo Structure

```text
my-pi/
├── apps/
│   └── my-pi-mcp/                 # CLI entry point and stdio server binary
├── packages/
│   ├── contracts/               # Core data interfaces, error codes, and fingerprinting
│   ├── workspace-runtime/       # Workspace root management, atomic replace, mutex locks
│   ├── policy/                  # Sensitive path detection and containment policy engine
│   ├── artifact-store/          # Large diff & output spillover storage
│   ├── observability/           # OpenTelemetry-compatible timing & metrics
│   ├── native-ports/            # Port interfaces for search, AST, and VCS
│   ├── native-loader/           # Platform detection, version sentinel & fallback loader
│   ├── fs/                      # Filesystem read/write/stat operations
│   ├── search/                  # High-performance grep/glob with pre-read policy
│   ├── hashline/                # Chunk-based anchor patcher with stale detection
│   ├── ast/                     # Tree-Sitter 5-language structural search engine
│   ├── lsp/                     # Multi-language LSP client, registry & process manager
│   ├── vcs/                     # Git-backed status and diff engine with artifact spill
│   ├── mcp-adapter/             # Official MCP SDK v2 stdio transport adapter
│   └── host-profiles/           # Config generators for Claude Code, OpenCode, Cursor, etc.
├── crates/
│   └── my-pi-native/              # Rust napi-rs bridge scaffold
├── benchmarks/                  # 100k-file synthetic generator & traversal benchmarks
├── scripts/                     # PR smoke, SBOM generator, host probe, gate verifier
└── docs/                        # Specifications, release contract, host compatibility
```

---

## ⚡ Quickstart

### Prerequisites
- **Node.js**: $\ge 24.0.0$ LTS
- **Package Manager**: `pnpm@11.2.2`
- **Rust Toolchain**: `stable` (optional, for native crates)

### Installation & Build

```bash
# Clone the repository
git clone https://github.com/BoxBoxmari/my-pi.git
cd my-pi

# Install dependencies (frozen lockfile)
pnpm install --frozen-lockfile

# Build TypeScript packages
pnpm build
```

### Running the MCP Server

```bash
# Start my-pi over stdio for a target workspace
node apps/my-pi-mcp/dist/main.js --workspace /path/to/project

# Or using environment variable
MY_PI_WORKSPACE_ROOT=/path/to/project node apps/my-pi-mcp/dist/main.js
```

### Generating Host Configurations

```bash
# Render configuration for Claude Code
node apps/my-pi-mcp/dist/main.js host-config claude-code-local

# Render configuration for Cursor
node apps/my-pi-mcp/dist/main.js host-config cursor-local

# Render configuration for OpenCode
node apps/my-pi-mcp/dist/main.js host-config opencode-current-local
```

---

## 🧪 Verification & Testing

my-pi enforces automated gate verification across all capabilities:

```bash
# Run full verification pipeline
pnpm verify

# Run unit and integration tests (106 tests)
pnpm test

# Run PR smoke suite (pack + tarball + isolated MCP stdio boot)
node scripts/pr-smoke.mjs

# Generate CycloneDX Software Bill of Materials (SBOM)
node scripts/generate-sbom.mjs

# Execute 100k repository traversal benchmark
node benchmarks/generate-100k-fixture.mjs ./fixtures/benchmark-repo 100000
node benchmarks/traversal-benchmark.mjs ./fixtures/benchmark-repo
```

---

## 📊 CI/CD Multi-Platform Matrix

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request across:
- **Operating Systems**: `windows-latest`, `ubuntu-latest`, `macos-latest`
- **Node.js**: `24 LTS` and `22 LTS` (compatibility lane)
- **Toolchain Audits**: `pnpm audit --prod`, `cargo audit`, `cargo deny check licenses`, and CycloneDX SBOM validation.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
