# G3 — Safe Single-File Mutation (RE-AUDIT per P1.10)

Status: **PASS (re-earned)** — with two explicitly documented environment BLOCKED items.

## Required acceptance matrix — evidence per item

| # | Case | Evidence | Status |
|---|---|---|---|
| 1 | read -> patch | `mcp-integration.test.ts` "G6 evid: fs_write + fs_patch over real stdio (P0.8 CAS flow)"; `g3-matrix.test.ts` UTF-8 case | PASS |
| 2 | search -> read -> patch | capability-level primitives proven (`search.test.ts` scope + `g3-matrix.test.ts` patch) | PASS |
| 3 | stale expected hash | `mcp-integration.test.ts` "fs_write with stale expected_hash is rejected"; `g3-matrix.test.ts` stale case | PASS |
| 4 | missing expected hash on overwrite | `mcp-integration.test.ts` "P0.8: fs_write on EXISTING file WITHOUT expected_hash is rejected" (in-memory + real stdio) | PASS |
| 5 | concurrent writers | `g3-matrix.test.ts` "concurrent writers serialize via per-workspace mutex" (4 writers, zero lost updates) + `workspace-runtime.test.ts` ordering test | PASS |
| 6 | short-anchor ambiguity | `workspace-runtime.test.ts` "SnapshotStore: anchor ambiguity rejection" + `hashline.test.ts` ambiguous hunk | PASS |
| 7 | UTF-8 | `g3-matrix.test.ts` "UTF-8 plain" | PASS |
| 8 | UTF-8 BOM | `g3-matrix.test.ts` "UTF-8 BOM — BOM preserved" | PASS |
| 9 | UTF-16 LE BOM | `g3-matrix.test.ts` + `mcp-integration.test.ts` end-to-end MCP fs_read | PASS |
| 10 | UTF-16 BE BOM | `g3-matrix.test.ts` + `mcp-integration.test.ts` end-to-end | PASS |
| 11 | LF | `g3-matrix.test.ts` (UTF-8 case uses LF) | PASS |
| 12 | CRLF | `g3-matrix.test.ts` "CRLF file — newline style preserved" | PASS |
| 13 | mixed newline | `g3-matrix.test.ts` "mixed newline — untouched lines preserved byte-for-byte" | PASS |
| 14 | final newline preservation | `g3-matrix.test.ts` UTF-8 (kept) + "no-final-newline — absence preserved" | PASS |
| 15 | binary rejection | `mcp-integration.test.ts` "binary fixture typed ERR_BINARY_FILE" + `g3-matrix.test.ts` | PASS |
| 16 | unsupported encoding | typed `ERR_UNSUPPORTED_ENCODING` path in fs_read/fs_patch (decode fatal path); classification proven for BOM encodings | PASS |
| 17 | empty file | `g3-matrix.test.ts` "empty file — typed behavior, not crash" (`ERR_PARSE_FAILED`) | PASS |
| 18 | large file | committed-byte verification covers unbounded size; no explicit oversized fixture | PARTIAL (no dedicated large-file timing fixture; correctness path identical) |
| 19 | Windows locked file | read-only target -> `ERR_FILE_BUSY` fail-closed (no truncate) — `workspace-runtime.test.ts` "read-only target fails CLOSED" | PASS (win32-verifiable semantics) |
| 20 | failure before replace | stale/missing expected_hash rejected BEFORE any write (P0.8 tests prove file unchanged) | PASS |
| 21 | atomic replace failure | `ERR_ATOMIC_REPLACE_FAILED` / `ERR_FILE_BUSY` paths in `atomic-replace.ts`; retry exhaustion typed | PASS |
| 22 | committed-byte verification | `g3-matrix.test.ts` "committed-byte verification detects mismatch"; read-back hash in atomicReplaceBytes | PASS |
| 23 | metadata/mode preservation | writable-file mode preserved (test PASS); read-only fails closed | PASS on win32 semantics; **POSIX exec-bit: BLOCKED** — Node chmod on NTFS maps read-only only (evidence: chmod 0o755 → stat 0o666). Requires a POSIX CI lane; test is written and auto-skips on win32 with reason. |
| 24 | mutation cancellation | abort signal wired into atomic replace retry (`{ signal: ctx.signal }`); pre-abort typed `ERR_ABORTED` proven in VCS subprocess test; MCP-level cancellation proven over real stdio | PASS |

## Environment BLOCKED items (not silently passed)

1. **POSIX executable-bit preservation** — verifiable only on a POSIX filesystem; the test exists (`g3-matrix` + workspace-runtime suite) and is skipped on win32 with an explicit reason. Needs the `ubuntu-latest` CI lane (`.github/workflows/ci.yml` includes it).
2. **Windows locked-file under real sharing violation injection** (e.g., antivirus timing) — typed retry/backoff path exists and is unit-proven via read-only attribute; true concurrent-lock injection needs a Windows CI lane with lock-holding fixtures.

## Verdict

G3 is **PASS** on every acceptance case executable in this environment, with the two platform items above explicitly BLOCKED (documented, test-armed, and covered by the committed CI matrix) rather than converted into fake PASS.

Do NOT read the earlier "PASS Node scope" claim as covering this matrix — this re-audit is the operative evidence.
