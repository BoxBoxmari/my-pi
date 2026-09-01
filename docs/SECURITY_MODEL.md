# CCR Security Model (v1.1)

Host permission UX is **defense-in-depth, never the trust boundary** (A6). All policy is
enforced server-side.

## Path resolution pipeline
```
input -> normalize separators -> resolve vs workspace -> canonicalize/realpath
      -> resolve symlink/junction -> containment check
      -> sensitive-path policy -> capability-class policy -> execute
```
Hard deny: traversal outside workspace, symlink/junction escape, unauthorized UNC/alternate
drive, explicitly denied path.

## Secret/deny path policy
Default-sensitive (deny-by-default, allow-list only via external workspace config):
`.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`,
`.git-credentials`, `.aws/**`, `.ssh/**`, `credentials*`, `secrets*`.

A **model tool argument can never self-authorize a sensitive path**. V1 does no
content-based secret scanning.

## Capability classes
`read/write/network/exec/debug/secret`. V1: read allowed in-workspace; write policy-controlled
(`workspace-write`/`review-required`); `network/exec/debug/secret` unavailable.

## Mutation safety
- Single-file only (A7); per-workspace mutex (A8).
- Temp-file + fsync + atomic rename + read-back hash verify.
- Never truncate-and-overwrite; Windows busy → bounded retry → `ERR_FILE_BUSY` / `ERR_ATOMIC_REPLACE_FAILED`.
- Git is never automatic rollback (A10).

## Native / supply chain
- `napi-rs` bridge; pure Node fallback for walk/glob/grep (A14).
- OMP leaf crates only as qualified pinned suppliers; `pi-natives`, ToolSession, agent/provider
  layers excluded (A15).
- G0 requires SBOM, transitive license inventory, advisory scans; no unapproved critical advisory.

## Transport & observability
- `stdout` = MCP protocol only; logs to `stderr`.
- No content/secret/auth-header logging by default (`@ccr/observability` redaction).
- HTTP is post-V1; if enabled later it is disabled by default and requires bearer auth
  before non-loopback exposure.

## Verified evidence
- Containment/traversal + secret denial + mode gating: unit + end-to-end MCP tests PASS.
- End-to-end `.env` denial through the MCP tool surface: PASS.
- Native/HTTP/LSP hardening: NOT yet exercised (blocked in this environment).
