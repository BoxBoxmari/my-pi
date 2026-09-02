# Migration: CCR → my-pi

This project was renamed from **CCR (Coding Capability Runtime)** to **my-pi**. The rename follows an alias-deprecation strategy: `my-pi` is canonical, `ccr` remains a deprecated alias for one major version.

## Name mapping

| Old (CCR) | New (my-pi) | Notes |
|---|---|---|
| Package scope `@ccr/*` | `@my-pi/*` | Workspace packages renamed atomically |
| App package `@ccr/app` | `@my-pi/app` | |
| Binary `ccr-mcp` | `my-pi-mcp` | `bin` keeps BOTH entries for 1 major |
| App dir `apps/ccr-mcp` | `apps/my-pi-mcp` | `git mv` (history preserved) |
| Crate `ccr-native` | `my-pi-native` | `crates/my-pi-native` |
| Crate `ccr-search` | `my-pi-search` | placeholder crate |
| Root package `ccr` | `my-pi` | |
| Error class `CcrError` | `MyPiError` | `CcrError = MyPiError` alias export |
| `isCcrError` | `isMyPiError` | alias kept |
| `CCR_ERROR_CODES` | `MY_PI_ERROR_CODES` | alias kept; `ERR_*` strings UNCHANGED |
| `CcrServer` | `MyPiServer` | alias kept; default server name `my-pi` |
| `ccrCodeToMcpCode` | `myPiCodeToMcpCode` | alias kept |
| `CcrMetrics` / `ccr_*` metric keys | `MyPiMetrics` / `my_pi_*` | `snapshotWithLegacyShadows()` dual-emits `ccr_*` for 1 major |
| `CCR_NATIVE_VERSION` | `MY_PI_NATIVE_VERSION` | alias kept |
| Era hash prefix `ccr-era:` | `my-pi-era:` | |
| Host config key `ccr` | `my-pi` | host-profiles render emits BOTH keys |
| `claude mcp add ccr` | `claude mcp add my-pi` | render emits BOTH commands |

## Environment variables (dual-read)

| Variable | New | Legacy (dual-read, deprecated) |
|---|---|---|
| Workspace root | `MY_PI_WORKSPACE_ROOT` | `CCR_WORKSPACE_ROOT` (stderr warning when used) |
| Desired MCP era | `MY_PI_MCP_ERA` | `CCR_MCP_ERA` |

Read precedence is `MY_PI_* ?? CCR_*`. The legacy read emits a deprecation warning on stderr (never stdout — stdout carries MCP protocol bytes only).

## MCP registration keys

Host config renders (opencode.json, mcpServers, servers blocks) now emit both `my-pi` (primary) and `ccr` (deprecated alias) keys pointing at the same command. Hosts configured with the old `ccr` key keep working during the deprecation window.

## Removal timeline (v1.0)

- **v0.x (now)**: dual aliases everywhere — bin names, env vars, type/class aliases, metric shadows, host keys.
- **v1.0**: all `ccr` aliases, `CCR_*` env fallbacks, `ccr_*` metric shadows, and the `ccr` host key are REMOVED. `my-pi` only.
- `ERR_*` error-code strings are a wire contract and were never renamed.

## Notes

- Imports were codemodded `from "@ccr/` → `from "@my-pi/` across `packages/*/src/**`, `packages/*/test/**`, `apps/my-pi-mcp/src/**` atomically with the manifest rename (workspace resolution would break otherwise).
- Temp-file prefixes (`.ccr-tmp-`, `.ccr-create-`, tmpdirs `ccr-*`) renamed to `.my-pi-*` / `my-pi-*`; these are internal and safe.
- Gate evidence JSON files record historical observations; strings were swept for consistency.
