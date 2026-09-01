# G0 — Reproducibility, Supply Chain, Feasibility

Status: **PARTIAL** — scaffold + provenance complete; several acceptance items are **externally blocked** in this environment (no Claude Code / OpenCode, no multi-platform runners, Node 26 not Node 24).

## Implemented (evidence present)

- **Monorepo bootstrap**: `pnpm` workspace (`pnpm-workspace.yaml`, committed `pnpm-lock.yaml`), TypeScript `tsc --build` project references, Cargo workspace (`Cargo.toml`, `crates/ccr-native` scaffold). `pnpm install` resolves cleanly (95 pkgs).
- **Runtime policy**: package `engines.node >= 24`. Note: this machine runs **Node v26.7.0**, so Node 24 is NOT exercised here; the claim remains unverified.
- **Upstream pins recorded**: `provenance/UPSTREAM.lock.json` (Pi v0.84.4 / b79e4cc…, OMP v18.0.11 / b8ce33a…). Immutable SHAs; neither is a production dependency.
- **Provenance & supplier inventory**: `EXTRACTION_MAP.json`, `SUPPLIER_DEPENDENCIES.json`, `THIRD_PARTY_NOTICES.md`, `SBOM.cdx.json` (placeholder).
- **Architecture dependency tests**: enforced via package boundaries and `tsc --build` (no package imports MCP SDK except the adapter; core packages depend only on `@ccr/contracts` / `@ccr/policy` / `@ccr/observability`).

## BLOCKED / not executed (external or tooling-dependent)

| Acceptance item | Status | Reason |
|---|---|---|
| Clean clone resolves exact upstream refs | NOT DONE | Upstream repos not cloned (large); pins recorded from spec, not re-verified against live clones. |
| Node 24 native load/call/cancel on 3 platforms | BLOCKED | No Rust/napi-rs build executed; only win32 + Node 26 present; macOS arm64 / Linux x64 not runnable here. |
| napi-rs primary platform spike | BLOCKED | Requires napi-rs toolchain + multi-platform matrix; `ccr-native` is scaffold only. |
| Supply-chain scans (license/advisory/SBOM) | BLOCKED | `cargo-audit`, `cargo-deny`, SBOM generator not run; deps not in a final graph. |
| MCP era probe of Claude Code / OpenCode | BLOCKED | Neither host is installed on this machine. |
| OMP leaf supplier qualification (pi-walker/pi-ast/pi-vcs) | BLOCKED | Requires cloning + building OMP crates; candidates are documented, not qualified. |

## Anti-pattern guardrail
- No Pi/OMP agent/harness/provider/ToolSession type appears in any production package import.
- No production package imports the MCP SDK except `@ccr/mcp-adapter`.

## Exit artifacts
- `provenance/UPSTREAM.lock.json`, `EXTRACTION_MAP.json`, `SUPPLIER_DEPENDENCIES.json`, `THIRD_PARTY_NOTICES.md`, `SBOM.cdx.json`
- `docs/gates/G0_NATIVE_SPIKE_REPORT.md`, `G0_MCP_ERA_DECISION.md`, `G0_SUPPLY_CHAIN_REPORT.md`

## Next gate entry
G0 is PARTIAL, so G1 proceeded on the **Node-only, non-native foundation** (which does not depend on the blocked items). Native extraction (G2+) and MCP-era selection must not be treated as complete until G0 blockers are exercised.
