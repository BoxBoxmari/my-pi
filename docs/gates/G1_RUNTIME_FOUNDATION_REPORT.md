# G1 — Runtime Foundation, Policy, Cancellation, LSP Spike

Status: **PARTIAL** — Node foundation implemented, built, and 26/26 tests pass (in-process MCP conformance included). Blocked items: LSP feasibility spike (no language server), OS-pipe subprocess response capture (harness EOF race), real host conformance.

## Implemented
- **Contracts** (`@my-pi/contracts`): `ids`, `errors` (22-code taxonomy), `diagnostics`, `artifact`, `workspace`, `fingerprint` (raw-byte sha256), `snapshot`, `encoding` (BOM/newline/binary), `capability-result`/context.
- **Policy** (`@my-pi/policy`): sensitive/secret path matcher (defaults: `.env`, `*.key`, `.aws/**`, `.ssh/**`, `credentials*`, `secrets*`, …), capability-class gating, PolicyEngine (secret deny-by-default + mode + unavailable-class).
- **Workspace runtime** (`@my-pi/workspace-runtime`): startup single workspace, `path-normalize` (canonicalize/symlink containment), `path-policy` (containment + secret authorize), `mutation-mutex` (per-workspace async mutex), `atomic-replace` (temp + fsync + rename + read-back verify, bounded busy retry), `snapshot-store` (anchor ambiguity rejection), `workspace-runtime` (revision bump + snapshot invalidation on mutation).
- **Observability** (`@my-pi/observability`): metrics counters, trace span, redaction.
- **Artifact store** (`@my-pi/artifact-store`): bounded local artifact store.
- **Native ports** (`@my-pi/native-ports`): search/ast/vcs backend interfaces (frozen G1.9 shape); native backends not yet implemented (G0 spike blocked).
- **MCP adapter** (`@my-pi/mcp-adapter`): official SDK v2 stdio server + `registerTool` schema (zod), error mapping (`MyPiError`→MCP), era placeholder, 13-tool surface; `workspace_info`, `fs_stat`, `fs_read` implemented; other 10 tools return typed `ERR_UNSUPPORTED_CAPABILITY` until their gates.
- **Host profiles** (`@my-pi/host-profiles`): 9 profiles (2 blocking, 7 monitoring), config renderer (JSON / claude-code CLI), `my-pi host-config <profile>`.
- **App** (`apps/my-pi-mcp`): `main.ts` CLI — `--workspace` / `MY_PI_WORKSPACE_ROOT`, `host-config` subcommand.

## Evidence
- **build**: `tsc --build` exit 0 (also the typecheck).
- **tests**: `node --experimental-strip-types --test "packages/*/test/*.test.ts"` → **26 pass / 0 fail**, including:
  - encoding/BOM/newline/binary round-trips;
  - secret deny + mode gating + external allow-list;
  - traversal & secret containment rejection;
  - mutation-mutex serialization;
  - atomic-replace round-trip + committed-hash verify;
  - snapshot anchor ambiguity rejection;
  - **MCP in-process conformance** via official SDK `Client` + `InMemoryTransport`: 13 tools discoverable, `workspace_info`/`fs_read`/`fs_stat` return correct structured results, `.env` denied end-to-end, unimplemented tool → typed error.
- **host-config smoke**: `node apps/my-pi-mcp/dist/main.js host-config cursor-local|claude-code-local|nope` → correct JSON/CLI output, unknown-profile error (exit 1).
- **boot smoke**: standalone `my-pi-mcp --workspace <dir>` starts, opens workspace (stderr log: `workspace=… mode=workspace-write transport=stdio`), connects stdio, exits 0.

## Architecture / security checks
- host/protocol leakage into core: **PASS** (SDK only imported by `mcp-adapter`; contracts/runtime/policy have no MCP or host imports).
- path/secret policy: **PASS** (tests + end-to-end MCP denial).
- stale mutation / atomic write: **PASS** (mutex + read-back verify unit tests).
- stdout protocol isolation: **PARTIAL** (adapter writes MCP only to stdout; startup log routed to stderr — verified in boot smoke).
- supplier/provenance: **PASS for scaffold** (no OMP production dep; provenance files present).

## Blocked / not executed
- **LSP feasibility spike**: no TypeScript language server installed (`typescript-language-server` absent). Contract `A20` unmet; see `G1_LSP_FEASIBILITY_REPORT.md`.
- **Real host conformance** (Claude Code / OpenCode): hosts absent (same blocker as G0).
- **OS-pipe stdio response capture** in this harness hit an EOF/`spawnSync`-close race on Windows; the same message handling is covered by the in-process SDK conformance test. Not treated as a pass for real hosts.

## Open risks / deviations
- Node runtime is v26 (not normative v24) → Node 24 support claim is **unverified**.
- `V1_MCP_ERA` is a placeholder (see `G0_MCP_ERA_DECISION.md`).
- LSP, native search, AST, VCS remain unimplemented placeholders pending their gates.

## Exit artifacts
- `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `docs/SECURITY_MODEL.md`, `docs/HOST_COMPATIBILITY.md`
- `docs/gates/G1_RUNTIME_FOUNDATION_REPORT.md`, `docs/gates/G1_LSP_FEASIBILITY_REPORT.md`

## Next gate
G2 (Read/Search tracer bullet) can begin on the **pure Node fallback** path once LSP/native G0 blockers are resolved; it is NOT blocked by the missing host probe. However, per `execution_scope`, production search extraction should wait for G0/G1 acceptance evidence — the foundation is PARTIAL, so G2 should not start production native extraction yet.
