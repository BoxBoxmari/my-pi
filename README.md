# my-pi

<p align="center">
  <strong>Security-first local MCP runtime for coding agents and IDEs</strong><br>
  <sub>Bounded filesystem, structural search, LSP, and Git capabilities over controlled stdio.</sub>
</p>

<p align="center">
  <a href="https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://img.shields.io/github/actions/workflow/status/BoxBoxmari/my-pi/ci.yml?branch=main&label=CI&logo=github&style=flat-square" alt="CI status" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/BoxBoxmari/my-pi/release.yml?label=release%20qualification&logo=github&style=flat-square" alt="Release qualification status" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/actions/workflows/codeql.yml?query=branch%3Amain"><img src="https://img.shields.io/github/actions/workflow/status/BoxBoxmari/my-pi/codeql.yml?branch=main&label=CodeQL&logo=github&style=flat-square" alt="CodeQL status" /></a>
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Alpha release status" />
  <a href="https://github.com/BoxBoxmari/my-pi/releases/tag/v0.1.0-alpha.1"><img src="https://img.shields.io/github/v/tag/BoxBoxmari/my-pi?sort=semver&label=release&style=flat-square" alt="Latest release tag" /></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@koonwang03/my-pi"><img src="https://img.shields.io/npm/v/%40koonwang03%2Fmy-pi?label=npm&logo=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@koonwang03/my-pi"><img src="https://img.shields.io/npm/dm/%40koonwang03%2Fmy-pi?label=downloads&logo=npm&style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/stargazers"><img src="https://img.shields.io/github/stars/BoxBoxmari/my-pi?logo=github&style=flat-square" alt="GitHub stars" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/issues"><img src="https://img.shields.io/github/issues/BoxBoxmari/my-pi?logo=github&style=flat-square" alt="Open issues" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/BoxBoxmari/my-pi?style=flat-square" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.6.0%20%7C%2024%20LTS-339933?logo=nodedotjs&logoColor=white&style=flat-square" alt="Node.js support" />
  <img src="https://img.shields.io/badge/pnpm-11.2.2-F69220?logo=pnpm&logoColor=white&style=flat-square" alt="pnpm version" />
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP%20SDK-2.0.0-6366f1?style=flat-square" alt="Model Context Protocol SDK" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Supported platforms" />
</p>

---

## Product overview

**my-pi** is a deterministic coding capability runtime exposed through the official **Model Context Protocol (MCP)**. It gives coding agents a controlled interface to local workspaces through explicit workspace authority, bounded reads, compare-and-swap writes, structural search, language-server integration, and Git operations.

> **Release channel:** Alpha · `0.1.0-alpha.1`<br>
> The public package is intended for evaluation and controlled local development. Review the [security model](docs/SECURITY_MODEL.md) before enabling the trusted profile.

Rather than granting unrestricted shell access or relying on fragile line-based edits, **my-pi** enforces **Compare-And-Swap (CAS)** atomic mutations, pre-read credential protection, Tree-Sitter AST structural search, and multi-language Language Server Protocol (LSP) intelligence directly over a local stdio transport.

---

## Product status

The badges above link to the live GitHub Actions, npm, release, and repository views. The table below records the product metadata shipped by this checkout.

| Signal | Current state |
| :--- | :--- |
| Public package | [`@koonwang03/my-pi@0.1.0-alpha.1`](https://www.npmjs.com/package/@koonwang03/my-pi) |
| Release channel | Alpha; suitable for evaluation and controlled local development |
| Runtime | Node.js `>=22.6.0` |
| Package manager | pnpm `11.2.2` |
| MCP integration | Official MCP SDK `2.0.0` over stdio |
| Supported hosts | Windows, macOS, and Linux |
| License | [MIT](LICENSE) |
| CI entry point | GitHub Actions on pushes and pull requests targeting `main` |

The npm download badge is maintained by npm and reflects its rolling download count. GitHub stars, issues, workflow results, and release tags are read directly from their linked GitHub views.

---

## Production Next (experimental)

The checkout also contains an opt-in local coordination candidate. Start one daemon for a logical project with `my-pi-daemon --workspace /path/to/your/project`, then connect an agent host with `my-pi-mcp --workspace /path/to/your/project --coordination`. Add `--evaluation` only when the evaluation plane is required.

The stable public claim remains the 13-tool MCP capability surface. Coordination, code-state, change-receipt, evaluation, and feedback behavior are experimental and remain subject to PN6/PN8/PN9 benchmark and promotion gates. The candidate keeps source and detailed code state local, does not select models or spawn agents, and does not require a hosted control plane.

Candidate qualification commands are `pnpm bench:impact-arms`, `pnpm bench:evaluation-feedback-arms`, `pnpm dogfood:self-host`, `pnpm bench:local-reliability`, and `pnpm verify:production-next`. These commands report candidate evidence; they do not admit a release.

---

## Key features

| Feature | Description | Guarantee |
| :--- | :--- | :--- |
| **Compare-and-swap (CAS)** | File updates verify raw SHA-256 byte fingerprints before write | Rejects stale or unguarded overwrites |
| **Pre-read security policy** | Denies sensitive paths (`.env*`, `.aws/`, `.ssh/`, `*.key`) prior to descriptor allocation | Sensitive files stay outside model context |
| **Explicit security profiles** | Read-only is the default; writes and LSP require `--security-profile trusted` | Workspace authority is never silently inherited from CWD |
| **Deterministic AST search** | Structural syntax tree queries via Tree-Sitter for 5 core languages | Accurate AST node filtering across large codebases |
| **Multi-language LSP engine** | Integrated lifecycle for TypeScript, Python, Rust, and Go when compatible host servers are available | Hover, definition, references, and diagnostics |
| **Large diff spillover** | Massive VCS diffs stream into a private, expiring local artifact store | Token context conservation without full-diff buffering |
| **No paid API dependency** | Local-first core with no secondary LLM or paid API dependency | Core execution stays on the host |

---

## System architecture

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
        Native backend boundary          Pure Node.js Fallback
            (deferred)                 (authoritative for alpha)
```

---

## 13-tool MCP surface

**my-pi** exposes a 13-tool catalog over standard MCP stdio; clean-install qualification exercises the representative core capabilities. The catalog remains stable while the default read-only profile disables workspace mutation and LSP process startup until explicitly elevated.

### 1. Filesystem & Mutation
- **`fs_read`**: Byte-bounded window streaming with SHA-256 fingerprinting, byte-offset pagination, and automatic UTF-8 / UTF-16 / BOM / CRLF decoding.
- **`fs_write`**: Safe file creation with strict no-clobber semantics or CAS-validated overwrites (`expected_hash`).
- **`fs_patch`**: Hunk-based anchored patching with stale detection; fails closed if anchor lines diverge.
- **`fs_stat`**: Comprehensive file metadata, size, timestamps, POSIX mode bits, and binary classification.

### 2. Search & Exploration
- **`search`**: Incremental grep and glob traversal with exact total count pagination, nested `.gitignore` handling, and pre-read sensitive path policy blocking.
- **`workspace_info`**: Authoritative workspace root canonicalization, active revision tracking, and capability manifest discovery.

### 3. Structural AST & Semantic Navigation
- **`ast_search`**: Structural AST query engine powered by Tree-Sitter across **TypeScript, JavaScript, Python, Rust, and Go**.
- **`lsp_status`**: Language server health monitoring, registered server state, and capability inspection.
- **`lsp_symbols`**: Document and workspace symbol search (classes, methods, interfaces, functions).
- **`lsp_navigate`**: Precise definition jumping, reference discovery, and hover documentation.
- **`lsp_diagnostics`**: Real-time compiler diagnostics and lint errors from active language servers.

### 4. Version Control System (VCS)
- **`vcs_status`**: Real-time git status isolating repository boundaries and modified/untracked files.
- **`vcs_diff`**: Secret-filtered, streaming Git diff generation with automatic spillover when exceeding inline budgets.

---

## Quickstart

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
# Install and run the published alpha package for a target workspace
# https://www.npmjs.com/package/@koonwang03/my-pi
pnpm add --global @koonwang03/my-pi@0.1.0-alpha.1
my-pi-mcp --workspace /path/to/your/project

# Optional elevated profile for writes and language-server processes
my-pi-mcp --workspace /path/to/your/project --security-profile trusted
```

The default security profile is read-only. `--security-profile trusted` is an
explicit opt-in for workspace writes and LSP processes. If the workspace is not
provided, startup fails; use `--allow-cwd` only when granting the current
directory is intentional.

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

## Reliability and security guarantees

- **Atomic Mode Bit & Encoding Fidelity**: File replacements preserve POSIX executable bits (`0o755`), UTF-8 BOM, UTF-16 LE/BE, and CRLF line endings byte-for-byte.
- **Fail-Closed Locking**: Windows NTFS sharing violations and locked handles trigger typed `ERR_FILE_BUSY` exceptions rather than corrupting file buffers.
- **Clean Subprocess Eviction**: Cancellation signals (`AbortSignal`) instantly terminate long-running git commands, searches, and spawned language server processes.

---

## Benchmarks and performance

Deterministic synthetic benchmarks run automatically across generated repository structures:

- **MCP Stdio Latency**: The benchmark records observed overhead per run; thresholds are not release-blocking until runner variance is qualified.
- **Glob and Grep Throughput**: Smoke and release profiles record candidate-bound timings for the pure Node.js fallback.
- **Server Memory**: The stdio benchmark samples the RSS of the spawned MCP server process, not the benchmark parent. Missing platform samples are reported as unavailable.
- **Release Scalability**: A 100,000-file result is release-qualified only when its commit, SBOM, and artifact match the strict release verifier.

---

## Verification and CI matrix

Every commit and pull request is checked by the configured multi-platform GitHub Actions workflows:

```bash
# Run local code, test, evidence, and smoke verification
pnpm verify

# Run the full unit and integration test suite
pnpm test

# Verify all 50 gate evidence criteria
pnpm bind:evidence
node scripts/verify-gates.mjs

# Validate the candidate SBOM
pnpm verify:sbom

# Release admission (binds evidence to the exact candidate first)
pnpm bind:evidence
pnpm verify:release

# Execute PR smoke test in isolated sandbox
node scripts/pr-smoke.mjs
```

| OS platform | Node 22 LTS | Node 24 LTS | CI configuration |
| :--- | :---: | :---: | :---: |
| **Ubuntu Linux** (`ubuntu-latest`) | Configured | Configured | See the live CI badge |
| **Microsoft Windows** (`windows-latest`) | — | Configured | See the live CI badge |
| **Apple macOS** (`macos-latest`) | — | Configured | See the live CI badge |

---

## Package topology

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
├── host-profiles/      # Configuration renderers for IDE hosts
├── change-runtime/     # Compare-and-swap proposals and receipts
├── code-state/         # AST, filesystem, LSP, and VCS code state
├── coordination-client/ # Versioned local daemon client
├── coordination-runtime/ # Claims, work graph, intents, and sync
├── coordination-store/ # SQLite event and projection store
├── evaluation-runtime/ # Evaluation, feedback, and acceptance flow
└── impact-engine/      # Bounded impact and routing decisions
```

OpenCode examples live under `host-configs/`; the repository root intentionally
does not contain an auto-loaded `opencode.json`. Generate a host configuration
with `my-pi-mcp host-config <profile>` when needed.

Search ignore behavior is documented in [`docs/SEARCH_IGNORE.md`](docs/SEARCH_IGNORE.md);
it is a traversal optimization, not a substitute for sensitive-path policy.

---

## License

This project is open-source software licensed under the [MIT License](LICENSE).

