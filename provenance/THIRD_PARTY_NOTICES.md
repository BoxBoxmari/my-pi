# Third-Party Notices (CCR v1.1 scaffold)

This file documents the provenance position at scaffold time. It is **not** a completed
supply-chain audit; license/advisory/SBOM scans must be executed in G0 once the native and
JS dependency graphs are installed and tooling (`cargo-audit`, `cargo-deny`, SBOM generator,
`pnpm audit`) is available.

## Reference/supplier upstreams (pinned, non-production)

| Project | Repository | Tag | Commit | License |
|---|---|---|---|---|
| Pi | https://github.com/earendil-works/pi | v0.84.4 | b79e4cc834970cca69daebffab7df1da7d1e52c4 | MIT |
| Oh My Pi | https://github.com/can1357/oh-my-pi | v18.0.11 | b8ce33a58911c26bed1d84f0db9a5e2e727c49a2 | MIT |

Policy:

- Neither Pi nor OMP is a production dependency. Pi is an architecture reference; OMP leaf
  Rust crates are supplier **candidates** pending G0 qualification.
- The OMP `pi-natives` monolith, ToolSession, agent/harness/provider layers, and OMP MCP server
  are excluded from production.
- Supplier promotion requires: exact immutable rev, Cargo graph/lock evidence, transitive
  license inventory, advisory results, build/binary size delta, platform build evidence, API
  subset used, and a documented replacement/upgrade path.

## JS runtime dependencies (dev-time in this scaffold)

Only development tooling is referenced at scaffold time: `typescript`, `@types/node`,
and the official MCP TypeScript SDK v2 (`@modelcontextprotocol/*`) for the stdio adapter.
A full `pnpm-lock.yaml` and Node advisory scan must be produced during G0.

## Generated SBOM

`SBOM.cdx.json` is a placeholder pending live dependency-graph generation. It must be
regenerated from the resolved `pnpm-lock.yaml` and `Cargo.lock` during G0.

## Undertakings

- No unknown/unreviewed production license.
- No unresolved critical advisory without an explicit documented exception.
- No silent upstream rebase.
