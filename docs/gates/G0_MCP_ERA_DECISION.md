# G0 — MCP Era Decision

Status: **BLOCKED** (no blocking hosts installed).

## Contract (A4)
Exactly one empirically selected MCP era is release-blocking. Select `2026-07-28` if both Claude Code and OpenCode reliably support it; otherwise the newest common 2025-era revision. Never assume an era from marketing or SDK version.

## Evidence recorded
- **Hosts absent**: `claude`, `claude-code`, `opencode` CLIs are not installed on this machine → no probe was possible.
- SDK line available: `@modelcontextprotocol/sdk` **1.30.0** (official TS SDK v2) installed and used by `@my-pi/mcp-adapter`.
- Adapter defaults `MY_PI_MCP_ERA` to `2026-07-28` as a **placeholder only** (`packages/mcp-adapter/src/era.ts`).

## Honest state
- The in-process MCP conformance test drives the real SDK server+client and passes, but that does **not** certify any host.
- **`V1_MCP_ERA` is UNVERIFIED.** The placeholder must be replaced from a real Claude Code / OpenCode probe before G6 certification.

## Next action
Run the probe: start the stdio server under each blocking host, record negotiated era, tool discovery, cancellation behavior. Then set `setSelectedEra(...)` / `MY_PI_MCP_ERA` accordingly.
