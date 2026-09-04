# my-pi Architecture (v1.1)

my-pi is a **host-neutral coding capability substrate** exposed through MCP. It is not an
agent framework, not a Pi/Oh My Pi wrapper, and not a client-specific plugin.

## Layering (dependencies point inward)

```
apps/my-pi-mcp
  -> mcp-adapter
  -> capability packages (fs, search, ast, lsp, vcs)
  -> workspace-runtime / policy / contracts
  -> native-ports -> native-loader
```

Forbidden: `workspace-runtime -> mcp-adapter`, `contracts -> host-profiles`, capability core
-> any host-specific package or OMP harness/ToolSession/provider layer, native -> `pi-natives`.

## Frozen invariants (A1–A22)

- **A1** MCP is an adapter, not the domain model.
- **A2** Node.js 24 LTS is normative. *(This machine runs Node 26 — unverified.)*
- **A3** V1 transport is stdio only.
- **A4** Exactly one empirically selected MCP era is release-blocking. *(placeholder: 2026-07-28)*
- **A5** Claude Code + OpenCode are blocking hosts; others monitoring.
- **A6** Workspace auth, path containment, secret/deny policy are server-side.
- **A7/A8** Mutations are single-file and serialize through a per-workspace mutex.
- **A9/A10** No journaled WorkspaceTransaction; Git is never automatic rollback.
- **A11/A12** Raw bytes define fingerprints; Windows locking/CRLF/atomic replace are first-class.
- **A13/A14** napi-rs native bridge; pure Node fallback for walk/glob/grep.
- **A15** OMP leaf crates are suppliers only after G0 qualification; `pi-natives` excluded.
- **A16/A17** AST + LSP read-only in V1; tool surface capped at 13.
- **A18** Cancellation is a platform contract (G1).
- **A19/A22** Supply-chain/SBOM/advisory are G0; no gate passes on static inspection alone.

## Current implemented surface

- Contracts, policy, workspace-runtime, observability, artifact-store, native-ports (ports only).
- MCP adapter with the 13-tool surface. Read/search/AST/VCS capabilities are
  implemented; workspace mutation and LSP processes require the explicit
  `trusted` security profile.
- Host profiles + `my-pi host-config`.

## Status

The current source has deterministic framing, byte-bounded reads, streamed
search/VCS paths, and both in-process and real-stdio tests. Native acceleration
and external host certification remain separate qualification work; their
historical gate reports are not current runtime status.

## Production Next experimental layers

The repository contains an additive candidate path above the frozen capability layer:

```text
MCP / CLI adapters
  -> coordination-client
  -> local my-pi-daemon
  -> coordination-runtime + SQLite coordination-store
  -> daemon-managed code-state/worktree lifecycle -> impact-engine -> context-router
  -> change-runtime -> evaluation-runtime
```

The daemon is one local authority per logical project and uses a Unix socket or Windows named pipe, never public TCP in the local profile. Coordination and evaluation are opt-in; the legacy MCP entry point remains usable without a daemon. The candidate records evidence and bounded retry state but does not spawn replacement agents. PN6, PN8, and PN9 remain empirical gates before enterprise positioning.

The daemon registers canonical worktree roots before indexing them. Code-state
reads pass through the workspace path and sensitive-path policy. File events are
invalidation hints; bounded reconciliation keeps fingerprints authoritative when
recursive watching is unavailable or overflows. Impact is materialized at intent
or code-state update time, while `coord_sync` reads bounded events and does not
recompute the full graph on every poll.
