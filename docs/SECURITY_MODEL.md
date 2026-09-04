# my-pi Security Model (v1.1)

Host permission UX is **defense-in-depth, never the trust boundary** (A6). All policy is
enforced server-side.

## Path resolution pipeline
```
input -> normalize separators -> resolve vs workspace -> canonicalize/realpath
       -> resolve symlink/junction -> containment check
       -> sensitive-path policy -> capability-class policy -> revalidate -> execute
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
`read/write/network/exec/debug/secret`. The default CLI profile is `read-only`.
The explicit `trusted` profile enables workspace writes and LSP processes;
`review-required` remains fail-closed until a real approval mechanism exists.
`network/exec/debug/secret` remain unavailable through the MCP capability guard.

## Mutation safety
- Single-file only (A7); per-workspace mutex (A8).
- Temp-file + fsync + atomic rename + read-back hash verify.
- `fs_read` uses a raw-byte window and streams the full-file hash/metadata without
  retaining the complete file in memory.
- Never truncate-and-overwrite; Windows busy → bounded retry → `ERR_FILE_BUSY` / `ERR_ATOMIC_REPLACE_FAILED`.
- Git is never automatic rollback (A10).

## Native / supply chain
- `napi-rs` bridge; pure Node fallback for walk/glob/grep (A14).
- OMP leaf crates only as qualified pinned suppliers; `pi-natives`, ToolSession, agent/provider
  layers excluded (A15).
- G0 requires SBOM, transitive license inventory, advisory scans; no unapproved critical advisory.

## Transport & observability
- `stdout` = MCP protocol only; logs to `stderr`.
- The built-in request log shape contains only tool, outcome, duration, and
  typed error code; it does not include source content or credentials.
- `@my-pi/observability` redaction helpers are defense in depth for future
  telemetry and are not the workspace authorization boundary.
- LSP subprocesses use byte-correct framing, workspace-bound roots, a sanitized
  environment, and no Node `shell:true` argument joining.
- VCS diff disables external diff/textconv, filters sensitive changed paths, and
  streams overflow into a private expiring artifact directory.
- HTTP is post-V1; if enabled later it is disabled by default and requires bearer auth
  before non-loopback exposure.

## Verified evidence
- Containment/traversal + secret denial + mode gating: unit + end-to-end MCP tests PASS.
- End-to-end `.env` denial through the MCP tool surface: PASS.
- LSP byte framing, root authority, navigation filtering, and process lifecycle:
  covered by deterministic unit tests plus host-dependent integration tests.
- Native acceleration and network/HTTP transport remain deferred by design.

## Production Next local coordination (experimental)

The local daemon is the coordination authority for one logical project. Local IPC uses a project-specific Unix socket or Windows named pipe under a restricted runtime directory; no public TCP listener is created. Lock and health metadata support stale-crash recovery but do not authenticate a human identity.

Client-supplied host names, roles, and agent labels remain untrusted attribution metadata. Trusted `PrincipalRef` values can only come from an authenticated adapter or enterprise control plane. Policy decisions are separate from enforcement, and approval bindings include operation, plan digest, resource preconditions, policy version, principal, and expiry.

Evaluation output is untrusted input. Required evidence must match the exact target state, evaluator errors remain distinct from code failures, evidence and feedback are bounded, and arbitrary model-supplied shell is not an evaluator definition. Source content is excluded from audit records by default.
