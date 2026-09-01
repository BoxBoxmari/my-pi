# G1 — LSP Feasibility Spike

Status: **BLOCKED** (external environment).

## Contract (A20, v1.1 §30)
Prove LSP lifecycle feasibility in G1 before full LSP implementation: root detection, server discovery/config, spawn, initialize/initialized, open document, diagnostics, one navigation request, cancel an in-flight request, shutdown, forced-kill fallback, restart after simulated crash, bounded backoff, zombie/process-tree check, RSS observation. Initial language: TypeScript.

## Evidence recorded
- No language server is available: `typescript-language-server` (and equivalents) are not installed on this machine.
- The `@ccr/lsp` package is **scaffold only** (interface placeholders were not added; no process client written) because the feasibility contract explicitly forbids claiming LSP support without executing the evidence path.

## Why not executed here
- Requires an installed deterministic language server (e.g., `typescript-language-server`) plus a fixture project to drive lifecycle events.

## Honest state
- **A20 is UNMET.** `lsp_*` tools return `ERR_UNSUPPORTED_CAPABILITY` until the spike passes.
- Lifecycle state machine, restart/backoff, and process-tree cleanup are designed (v1.1 §21) but not implemented or evidenced.

## Next action
Install a deterministic language server, run the spike on a fixture, and freeze the lifecycle contract in `@ccr/lsp` before G5.
