# my-pi

<p align="center">
  <strong>The Host-Neutral Coding Capability Substrate for AI Agents & IDEs</strong>
</p>

<p align="center">
  <a href="https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml"><img src="https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.6.0%20%7C%2024%20LTS-brightgreen.svg" alt="Node.js" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP%20Protocol-2025--11--25-6366f1.svg" alt="MCP Protocol Era" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9%20Strict-3178c6.svg" alt="TypeScript" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-2021%20Stable-dea584.svg" alt="Rust" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Multi-Platform" />
  <img src="https://img.shields.io/badge/Architecture-Local--First%20%2F%20Zero--Inference-059669.svg" alt="Zero Cost" />
</p>

---

## 📌 Executive Summary

**my-pi** is a high-performance, deterministic coding capability runtime exposed through the official **Model Context Protocol (MCP)**. Engineered as a unified execution foundation for autonomous coding agents (such as Claude Code, OpenCode, Cursor, and Google Antigravity), **my-pi** bridges LLMs and local workspaces with strict safety invariants, zero-distortion file operations, and native-grade intelligence.

Rather than granting unrestricted shell access or relying on fragile line-based edits, **my-pi** enforces **Compare-And-Swap (CAS)** atomic mutations, pre-read credential protection, Tree-Sitter AST structural search, and multi-language Language Server Protocol (LSP) intelligence directly over a local stdio transport.

---

## 🌟 Key Features

| Feature | Description | Guarantee |
| :--- | :--- | :--- |
| **🛡️ Compare-And-Swap (CAS)** | All file updates verify raw SHA-256 byte fingerprints before write | Zero accidental overwrites or stale race conditions |
| **🔒 Pre-Read Security Policy** | Denies sensitive paths (`.env*`, `.aws/`, `.ssh/`, `*.key`) prior to descriptor allocation | Zero secret leakage to LLM context |
| **⚡ Deterministic AST Search** | Structural syntax tree queries via Tree-Sitter for 5 core languages | Accurate AST node filtering across large codebases |
| **🧠 Multi-Language LSP Engine** | Integrated background lifecycle for TypeScript, Python, Rust, and Go | Hover, definition, references, and diagnostics |
| **📦 Large Diff Spillover** | Massive VCS diffs automatically spill into local artifact storage | Token context conservation & bounded memory |
| **🎯 Zero Operating Cost** | 100% local execution — no secondary LLMs, paid APIs, or cloud daemons required | Complete data privacy & zero subscription costs |

---

## 🏛️ System Architecture

```
                            AI CLIENT HOSTS
       Claude Code  ·  OpenCode  ·  Cursor  ·  Google Antigravity
                                 │
                         MCP STDIO TRANSPORT
                        (Official SDK v2 Edge)
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │   my-pi MCP Adapter   │
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │  Capability Contracts │
                     └───────────┬───────────┘
                                 │
                                 ▼
     ┌───────────────────────────────────────────────────────────┐
     │                    CAPABILITY RUNTIME                     │
     │  Workspace Manager │  Policy Engine  │  Artifact Spill    │
     │  FS Subsystem      │  Search Engine  │  AST (Tree-Sitter) │
     │  LSP Lifecycle     │  VCS Manager    │  Cancellation Bus  │
     └───────────────────────────┬───────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
        Native Rust Engine              Pure Node.js Fallback
         (napi-rs bridge)              (Zero-Dependency Core)
```

---

## 🛠️ Complete 13-Tool MCP Surface

**my-pi** exposes a comprehensive 13-tool suite over standard MCP stdio:

### 1. Filesystem & Mutation
- **`fs_read`**: Bounded chunk streaming with SHA-256 fingerprinting, offset pagination, and automatic UTF-8 / UTF-16 / BOM / CRLF decoding.
- **`fs_write`**: Safe file creation with strict no-clobber semantics or CAS-validated overwrites (`expected_hash`).
- **`fs_patch`**: Hunk-based anchored patching with stale detection; fails closed if anchor lines diverge.
- **`fs_stat`**: Comprehensive file metadata, size, timestamps, POSIX mode bits, and binary classification.

### 2. Search & Exploration
- **`search`**: High-speed grep and glob search supporting recursive directory traversal, exact total count pagination, and pre-read sensitive path policy blocking.
- **`workspace_info`**: Authoritative workspace root canonicalization, active revision tracking, and capability manifest discovery.

### 3. Structural AST & Semantic Navigation
- **`ast_search`**: Structural AST query engine powered by Tree-Sitter across **TypeScript, JavaScript, Python, Rust, and Go**.
- **`lsp_status`**: Language server health monitoring, registered server state, and capability inspection.
- **`lsp_symbols`**: Document and workspace symbol search (classes, methods, interfaces, functions).
- **`lsp_navigate`**: Precise definition jumping, reference discovery, and hover documentation.
- **`lsp_diagnostics`**: Real-time compiler diagnostics and lint errors from active language servers.

### 4. Version Control System (VCS)
- **`vcs_status`**: Real-time git status isolating repository boundaries and modified/untracked files.
- **`vcs_diff`**: Structured patch diff generation with automatic spillover to artifact storage when exceeding inline budgets.

---

## 🚀 Quickstart

### Prerequisites
- **Node.js**: `v22.6.0+` or `v24 LTS`
- **pnpm**: `v11.2.2+`
- **Rust**: `stable` (optional, for native acceleration)

### 1. Clone & Build
```bash
git clone https://github.com/BoxBoxmari/my-pi.git
cd my-pi

# Install dependencies (frozen lockfile)
pnpm install --frozen-lockfile

# Compile all TypeScript packages
pnpm build
```

### 2. Start MCP Server Locally
```bash
# Global installation from npm
npm install -g my-pi

# Launch stdio MCP server for a target workspace
my-pi-mcp --workspace /path/to/your/project

# Or directly via npx
npx my-pi --workspace /path/to/your/project
```

### 3. Generate Host IDE Configurations
`my-pi` includes built-in profile generators for all major coding hosts:

```bash
# Generate configuration snippet for Claude Code
my-pi-mcp host-config claude-code-local

# Generate configuration snippet for Cursor
my-pi-mcp host-config cursor-local

# Generate configuration snippet for OpenCode
my-pi-mcp host-config opencode-current-local
```

---

## 🛡️ Reliability & Security Guarantees

- **Atomic Mode Bit & Encoding Fidelity**: File replacements preserve POSIX executable bits (`0o755`), UTF-8 BOM, UTF-16 LE/BE, and CRLF line endings byte-for-byte.
- **Fail-Closed Locking**: Windows NTFS sharing violations and locked handles trigger typed `ERR_FILE_BUSY` exceptions rather than corrupting file buffers.
- **Clean Subprocess Eviction**: Cancellation signals (`AbortSignal`) instantly terminate long-running git commands, searches, and spawned language server processes.

---

## 📈 Benchmarks & Performance

Deterministic synthetic benchmarks run automatically across generated repository structures:

- **MCP Stdio Latency**: Overhead $p_{50} \le 3.5\text{ms}$ (measured $\approx 0.80\text{ms}$ in CI), $p_{95} \le 6.0\text{ms}$ over direct capability calls.
- **Glob Throughput**: Glob over 5,000+ files resolves in under $400\text{ms}$ ($<15\text{ms}$ on Linux).
- **Grep Throughput**: Grep over 5,000+ files resolves in $\approx 1.25\text{s}$ (Linux) to $6.2\text{s}$ (Windows NTFS) with pure Node.js fallback (native acceleration deferred).
- **Release Scalability**: Validated on up to 100,000 files in tagged release benchmark profile.
- **Memory Footprint**: Strict RSS delta control with bounded stream buffers.

---

## 🧪 Verification & CI Matrix

Every commit and pull request is strictly verified across multi-platform GitHub Actions workflows:

```bash
# Run complete verification suite
pnpm verify

# Run 106 unit & integration tests
pnpm test

# Verify 39 gate evidence invariants
node scripts/verify-gates.mjs

# Execute PR smoke test in isolated sandbox
node scripts/pr-smoke.mjs
```

| OS Platform | Node 22 LTS | Node 24 LTS | Status |
| :--- | :---: | :---: | :---: |
| **Ubuntu Linux** (`ubuntu-latest`) | ✅ PASS | ✅ PASS | Active |
| **Microsoft Windows** (`windows-latest`) | — | ✅ PASS | Active |
| **Apple macOS** (`macos-latest`) | — | ✅ PASS | Active |

---

## 📦 Package Topology

```text
packages/
├── contracts/          # Core interfaces, error codes, and fingerprinting
├── workspace-runtime/  # Path normalization, atomic replacement, mutex
├── policy/             # Pre-read sensitive path protection engine
├── artifact-store/     # Disk-backed artifact spillover management
├── observability/      # OpenTelemetry-compatible tracing and metrics
├── native-ports/       # Hardware/native backend interfaces
├── native-loader/      # Safe fallback platform loader
├── fs/                 # Hardened filesystem operations
├── search/             # High-throughput grep & glob search
├── hashline/           # CAS chunk-based patch engine
├── ast/                # Tree-Sitter 5-language structural search
├── lsp/                # Multi-language LSP client and process pool
├── vcs/                # Git-backed status and diff engine
├── mcp-adapter/        # Official Model Context Protocol stdio server
└── host-profiles/      # Configuration renderers for IDE hosts
```

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).

