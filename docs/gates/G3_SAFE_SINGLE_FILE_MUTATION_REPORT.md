# G3 — Safe Single-File Mutation

Status: **PASS (Node scope)** — stale-safe atomic single-file writes/patches implemented and verified. Windows-native locking remains unverified (platform limitation, not a code gap).

## Implemented
- `@ccr/hashline`: minimal single-file patch parser + applier (`applyHunks`), full digest authority, anchor ambiguity rejection.
- `fs_write`: whole-file CAS write (optional `expected_hash`), preserves existing encoding/BOM via detection.
- `fs_patch`: hashline-style single-file patch, stale rejection, binary/unsupported-encoding typed errors.
- Both serialize through the **per-workspace mutation mutex**, use temp + fsync + atomic rename + read-back hash verify, then bump revision + invalidate snapshot.
- No journal / no rollback / no multi-file (invariants A7–A10).

## Evidence
- build: `tsc --build` exit 0.
- tests (43/43): `read -> patch`, stale `expected_hash` rejected, atomic write round-trip, concurrent-writer serialization, hunk missing/ambiguous rejection. Verified both in-memory and over **real stdio subprocess**.

## Architecture / security checks
- stale mutation/atomic write: PASS (mutex + read-back verify).
- path/secret policy: PASS (write denied on sensitive paths).
- stdout protocol isolation: PASS.

## Not verified / blocked
- Windows locked-file and atomic-replace failure under real sharing violations: not exercised here (would require controlled lock injection on Windows CI).
- Node 24 (runtime here is Node 26).

## Exit artifact
This report.
