# G4 — AST Search + VCS Read Plane

Status: **PARTIAL** — VCS read plane DONE; AST search BLOCKED (native supplier qualification pending G0).

## VCS (implemented, tested)
- `@my-pi/vcs` `GitVcsBackend` (read-only): `vcs_status` (`git status --porcelain`) and `vcs_diff` (`git diff --unified=3`).
- Controlled subprocess only; no shell interpolation; forbidden mutations (commit/reset/checkout/branch) never invoked (A10).
- Non-git workspace → typed non-crashing behavior.
- Tools: `vcs_status`, `vcs_diff` wired; backend metadata `"typescript"`.

### VCS evidence
- Tests (git fixture): clean/modified reporting, hunks + additions/deletions/files summary. 43/43 overall.

## AST (blocked)
- `ast_search` returns `ERR_UNSUPPORTED_CAPABILITY`. Requires `pi-ast` (or a narrower tree-sitter) supplier qualification, which depends on the G0 native/build-size/license/advisory evidence — not executable here.

## Decision
- VCS uses git CLI read-only as the pragmatic path until a qualified `gix`/`pi-vcs` backend is available. This is a documented deviation from "no shell requirement"; it is read-only and gated (no mutations).
- AST stays out of V1 until a supplier is qualified.

## Exit artifact
This report.
