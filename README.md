# my-pi

<p align="center">
  <strong>Local-first MCP runtime for coding agents — safer workspace access without an unrestricted shell</strong><br>
  <sub>Bounded filesystem · content-preconditioned writes · Tree-Sitter AST search · LSP navigation · Git tooling</sub>
</p>

<p align="center">
  <a href="https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://img.shields.io/github/actions/workflow/status/BoxBoxmari/my-pi/ci.yml?branch=main&label=CI&logo=github&style=flat-square" alt="CI status" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/actions/workflows/codeql.yml?query=branch%3Amain"><img src="https://img.shields.io/github/actions/workflow/status/BoxBoxmari/my-pi/codeql.yml?branch=main&label=CodeQL&logo=github&style=flat-square" alt="CodeQL status" /></a>
  <a href="https://www.npmjs.com/package/@koonwang03/my-pi"><img src="https://img.shields.io/npm/v/%40koonwang03%2Fmy-pi?label=npm&logo=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/stargazers"><img src="https://img.shields.io/github/stars/BoxBoxmari/my-pi?logo=github&style=flat-square" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/BoxBoxmari/my-pi?style=flat-square" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Alpha status" />
</p>

## What is my-pi?

**my-pi** is a deterministic local coding capability runtime exposed through the official **Model Context Protocol (MCP)**. It gives MCP-capable coding agents controlled access to a real workspace through explicit workspace authority, bounded reads, guarded writes, structural search, language-server intelligence, and Git operations.

It is aimed at developers who want agentic coding tools to understand and modify code **without handing the agent a general-purpose shell or silently granting the current working directory**.

### Why use it?

- **Local-first:** source code and detailed workspace state remain on the host.
- **Read-only by default:** writes and language-server process startup require explicit `trusted` elevation.
- **Safer mutation:** writes can require SHA-256 content preconditions instead of blind overwrite semantics.
- **Code-aware search:** Tree-Sitter structural search across TypeScript, JavaScript, Python, Rust, and Go.
- **Semantic navigation:** LSP symbols, definitions, references, hover, and diagnostics for supported host language servers.
- **Git-aware context:** bounded status and diff operations with secret filtering and large-diff spillover.
- **No secondary paid LLM dependency:** the core runtime executes locally and does not select models or spawn agents.

> **Release channel:** Alpha · `0.1.0-alpha.1`. Suitable for evaluation and controlled local development. Review the [security model](docs/SECURITY_MODEL.md) before enabling the trusted profile.

## Install in under a minute

Requires Node.js `>=22.6.0`.

```bash
npm install -g @koonwang03/my-pi
my-pi-mcp --workspace /path/to/your/project
```

The server starts read-only. For a workspace you explicitly trust:

```bash
my-pi-mcp --workspace /path/to/your/project --security-profile trusted
```

Or inspect a host configuration without a global install:

```bash
npx --yes --package @koonwang03/my-pi my-pi-mcp host-config cursor-local
```

Generate host-specific configuration snippets:

```bash
my-pi-mcp host-config claude-code-local
my-pi-mcp host-config cursor-local
my-pi-mcp host-config opencode-current-local
```

Starting without `--workspace` or `MY_PI_WORKSPACE_ROOT` fails closed. Use `--allow-cwd` only when granting the current directory is intentional.

## 13-tool MCP surface

| Area | Tools | Purpose |
| :--- | :--- | :--- |
| Filesystem | `fs_read`, `fs_write`, `fs_patch`, `fs_stat` | Bounded reads, guarded writes/patches, metadata |
| Search & workspace | `search`, `workspace_info` | Repository exploration and authoritative workspace state |
| AST & LSP | `ast_search`, `lsp_status`, `lsp_symbols`, `lsp_navigate`, `lsp_diagnostics` | Structural and semantic code intelligence |
| Git | `vcs_status`, `vcs_diff` | Repository status and bounded/filtered diffs |

### Key guarantees

| Capability | Behavior |
| :--- | :--- |
| Content-preconditioned mutation | File updates verify raw SHA-256 fingerprints and reject stale guarded overwrites |
| Pre-read sensitive-path policy | Sensitive paths such as `.env*`, `.aws/`, `.ssh/`, and `*.key` are denied before content is allocated to model context |
| Explicit security profiles | Default is read-only; mutation and LSP process startup require explicit elevation |
| Encoding/mode fidelity | File replacement preserves relevant encoding, line endings, BOM, and POSIX executable mode behavior |
| Cancellation | Long-running Git/search/LSP subprocess work supports cancellation and cleanup |

## Architecture

```text
MCP-capable coding host
        │
        │ stdio
        ▼
┌─────────────────────┐
│   my-pi MCP edge    │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ capability contracts│
└──────────┬──────────┘
           ▼
┌─────────────────────────────────────────────────────────┐
│ workspace │ policy │ filesystem │ search │ AST │ LSP │ Git │
└─────────────────────────────────────────────────────────┘
           │
           └── local host workspace
```

The stable public claim is the 13-tool MCP capability surface. The repository also contains an opt-in **Production Next** coordination/evaluation candidate; those coordination, code-state, change-receipt, evaluation, and feedback features remain experimental and subject to their promotion gates.

## Build from source

```bash
git clone https://github.com/BoxBoxmari/my-pi.git
cd my-pi
pnpm install --frozen-lockfile
pnpm build
```

Prerequisites for repository development:

- Node.js `v22.6.0+` or `v24 LTS`
- pnpm `v11.2.2+`
- Rust stable is optional and currently relevant only to the deferred native-backend scaffold

## Verification

```bash
# Local code, architecture, boundary, build, tests, gates and smoke verification
pnpm verify

# Unit/integration suite
pnpm test

# SBOM validation
pnpm verify:sbom

# Release admission checks
pnpm bind:evidence
pnpm verify:release
```

The configured CI matrix covers Ubuntu, Windows, and macOS lanes. See the live workflow badges above for current status rather than relying on static claims in this document.

## Benchmarks

The repository contains deterministic synthetic benchmarks for MCP stdio overhead, search/traversal throughput, memory sampling, runtime boundaries, coordination behavior, impact routing, evaluation feedback, and local reliability. Benchmark outputs are candidate evidence; performance claims should be interpreted alongside their qualification criteria and runner variance.

## Production Next (experimental)

Start the local coordination candidate for a logical project:

```bash
my-pi-daemon --workspace /path/to/your/project
my-pi-mcp --workspace /path/to/your/project --coordination
```

Add `--evaluation` only when the evaluation plane is required. The candidate keeps source and detailed code state local, does not select models or spawn agents, and does not require a hosted control plane.

Relevant qualification commands include:

```bash
pnpm bench:impact-arms
pnpm bench:evaluation-feedback-arms
pnpm dogfood:self-host
pnpm bench:local-reliability
pnpm verify:production-next
```

## Package topology

```text
packages/
├── contracts/             # Core interfaces, error codes, fingerprinting
├── workspace-runtime/     # Workspace/path normalization and mutation coordination
├── policy/                # Sensitive-path protection
├── artifact-store/        # Disk-backed spillover artifacts
├── observability/         # Tracing and metrics contracts
├── fs/                    # Hardened filesystem capabilities
├── search/                # Grep/glob traversal
├── hashline/              # Hashline-anchored patch engine
├── ast/                   # Tree-Sitter structural search
├── lsp/                   # Multi-language LSP lifecycle/client
├── vcs/                   # Git-backed status and diff
├── mcp-adapter/           # MCP stdio server adapter
├── host-profiles/         # Host configuration renderers
├── change-runtime/        # Content preconditions and change receipts
├── code-state/            # Filesystem/AST/LSP/VCS code state
├── coordination-client/   # Local daemon client
├── coordination-runtime/  # Work graph, claims, intents, sync
├── coordination-store/    # SQLite event/projection store
├── evaluation-runtime/    # Evaluation and feedback flow
└── impact-engine/         # Bounded impact/routing decisions
```

Search-ignore behavior is documented in [`docs/SEARCH_IGNORE.md`](docs/SEARCH_IGNORE.md). It is a traversal optimization, not a substitute for sensitive-path policy.

## Security

Before using trusted mode, read [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md). Security findings are welcome through the repository's documented reporting process.

## Contributing

Issues, reproducible bug reports, benchmark counterexamples, integration feedback, and focused pull requests are welcome. If you are evaluating my-pi in a real coding host, include the host, OS, Node version, security profile, and a minimal reproduction where possible.

## License

MIT — see [LICENSE](LICENSE).
