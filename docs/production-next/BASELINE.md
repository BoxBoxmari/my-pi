# Production Next Baseline

This record freezes the compatibility starting point for Production Next. It describes the repository before PN-A changes; it is not evidence that Production Next has been implemented.

## Identity

- Baseline SHA: `273ed28947a94a2495b10721f725447ea769994d`
- Branch at capture: `main`
- Package version: `0.1.0-alpha.1`
- Node requirement: `>=22.6.0`
- Package manager: `pnpm@11.2.2`
- MCP SDK line: `2.0.0`
- Capture date: `2026-09-04`

## Legacy public surface

The compatibility catalog contains exactly these 13 tools:

`workspace_info`, `fs_read`, `fs_stat`, `fs_write`, `fs_patch`, `search`, `ast_search`, `lsp_status`, `lsp_diagnostics`, `lsp_symbols`, `lsp_navigate`, `vcs_status`, and `vcs_diff`.

The machine-relevant schemas are defined in `packages/mcp-adapter/src/stdio.ts` and are locked by `test/compat/legacy-tool-catalog.test.mjs` after PN-A. The default profile is read-only; the trusted profile explicitly enables workspace mutation and LSP process startup.

## Verification snapshot

The pre-PN-A local run on Windows/Node 26 recorded 134 passing tests and 1 skipped platform-specific test in the unit suite, followed by 35 passing release tests. Existing gate evidence contained 50 structurally valid criteria, with G0, G2, and G3 marked `PARTIAL` because external or platform-specific checks were not all exercised.

The committed G0–G6/R0 evidence and traversal benchmarks were still bound to `fc89a0d2cf1f260f7617a09454f93d5fb75efa31` at capture time. They must be regenerated and strictly revalidated for any later release candidate; the stale documents are not current release admission.

## Carried limitations

- Native acceleration is deferred and the pure Node.js fallback remains authoritative for the alpha line.
- macOS/Linux and Node 24 qualification are not established by this Windows/Node 26 run.
- The current runtime is one MCP stdio process per configured workspace.
- Mutation serialization is process-local and is not a multi-process coordination authority.
- Snapshot metadata and artifact retention are not yet a durable coordination store.
- No Production Next coordination, code-state, impact-routing, change-runtime, evaluation, or enterprise package is part of this baseline.
