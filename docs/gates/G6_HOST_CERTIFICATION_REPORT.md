# G6 — Blocking Host Certification

Status: **PARTIAL** — both blocking hosts **connect to the my-pi-mcp server** (real evidence). Core V1 freeze is NOT met: 8/13 tools functional, remaining 5 (AST + LSP) unsupported, native/multi-platform and full supply-chain audit still blocked.

## Host connection evidence (real, executed)
Registered `my-pi-mcp` as an MCP stdio server in both blocking hosts and observed host-side status:

- **OpenCode** `opencode mcp list` → `• my-pi ✓ connected`
  (server: `node --experimental-strip-types apps/my-pi-mcp/dist/main.js --workspace fixtures/demo`)
- **Claude Code** `claude mcp add my-pi ...` + `claude mcp list` → `my-pi: ... - √ Connected`

Both hosts spawned the server, completed the MCP initialize handshake, and listed it as connected. This is genuine blocking-host integration evidence (previously assumed impossible in this environment).

## Protocol-era evidence
- Both hosts negotiated successfully via the official SDK v2. The exact negotiated `V1_MCP_ERA` string is **not yet captured** (SDK default 2026-07-28 is a placeholder; G0 probe recording is incomplete). Record as unverified.

## Tool surface (13)
- Functional (8): `workspace_info`, `fs_read`, `fs_stat`, `fs_write`, `fs_patch`, `search`, `vcs_status`, `vcs_diff`.
- Unsupported until their gates (5): `ast_search`, `lsp_status`, `lsp_diagnostics`, `lsp_symbols`, `lsp_navigate`.
- Same-task suite over real stdio (via SDK `StdioClientTransport`): 13 tools discoverable, read/stat/write/patch/search/secret-denial pass.

## V1 freeze criteria — NOT met
- Claude Code suite passes: host connects ✓, but tool suite not run inside Claude UI (needs login; the "Connected" state is protocol-level).
- OpenCode suite passes: host connects ✓; full agent-invocation not exercised this turn.
- Native matrix: BLOCKED. Supply-chain audit: BLOCKED. LSP/AST: unsupported.

## Honest statement
A **V1 release freeze is not claimed.** The two blocking hosts demonstrably connect to the server and its 8 working tools serve correctly over stdio, but AST, LSP, native acceleration, cross-platform (Node 24 × 3 OS), and the cargo supply-chain audit remain unverified — those are recorded BLOCKED, not passed.

## Exit artifacts
- `HOST_COMPATIBILITY.md` (updated), this report.
- `HOST_COMPATIBILITY.json` / `V1_RELEASE_CONTRACT.md`: NOT produced — freeze not reached.
