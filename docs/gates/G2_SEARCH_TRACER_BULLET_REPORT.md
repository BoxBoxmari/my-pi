# G2 — Read/Search Tracer Bullet

Status: **PARTIAL** — `fs_stat`, `fs_read`, and `search(mode=grep|glob)` implemented and tested on the **pure Node fallback**; native backend remains BLOCKED (G0 spike).

## Implemented
- `fs_stat` / `fs_read` (raw-byte fingerprint, encoding/BOM/binary detection, snapshot metadata, artifact-friendly).
- `search(mode=grep|glob)` via `@ccr/search` `NodeFallbackSearchBackend` (gitignore/hidden handling, cancellation `throwIfAborted`, result caps, sensitive-path deny).
- Result metadata: `backend="node-fallback"`, `degraded=true`.

## Evidence
- build: `tsc --build` exit 0.
- tests: search grep/glob return correct matches; sensitive results denied; degraded metadata present. 43/43 overall.
- Backend parity (native vs fallback): **N/A** — no native backend exists yet (G0 spike BLOCKED: Node 24 × 3-platform matrix not runnable here).

## Architecture / security
- path/secret policy: PASS (sensitive paths filtered from search results).
- host/protocol leakage: PASS.

## Blocked
- Native search backend (`pi-walker`/`grep.rs`): requires G0 qualification + N-API spike.
- Cross-platform parity + benchmark report (A–E layers): native layers unavailable.

## Exit artifact
This report. Native benchmark section pending G0.
