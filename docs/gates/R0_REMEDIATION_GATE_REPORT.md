# R0 — Production Foundation Readiness (Remediation Gate)

Date: 2026-09-01 · Verdict: **PASS** — with explicitly documented environment BLOCKED items

## P0 closure table

| Item | Finding | Fix + Evidence | Status |
|---|---|---|---|
| P0.1 | VCS used cwd fallback; failures became fake `clean:false/[]` | `@ccr/vcs` requires resolved absolute path (rejects `"."`/undefined); typed outcomes: non-git → `ERR_UNSUPPORTED_CAPABILITY`, git-missing → `ERR_NATIVE_UNAVAILABLE`, permission → `ERR_PERMISSION_DENIED`, abort → `ERR_ABORTED`, generic → `ERR_NATIVE_FAILURE`. Tests: `vcs.test.ts` 6/6 (cwd isolation, sibling repo isolation, non-git typed, `"."` rejected, diff isolation, cancellation) | CLOSED |
| P0.2 | Search read sensitive files, then filtered output | `SearchRequest.allowed` gate enforced during traversal + `onFileRead` spy. Tests prove visible sensitive files (`credentials_prod.txt`, `secrets.json`, `keydir/`) are NEVER opened; allow-listed path CAN be read; dir descent blocked | CLOSED |
| P0.3 | Search used `ResolvedPath.root` instead of the resolved scope | Uses `resolved.absolute`; file scope → typed invalid-scope; subdir scoping proven not to leak sibling matches; `"."` root rejected by backend | CLOSED |
| P0.4 | MCP handler created its own never-aborted signal | Uses `ctx.mcpReq.signal` (SDK v2 ServerContext) end-to-end: capability → Node search (`throwIfAborted`) → git subprocess kill → atomic-replace retry delays. Real-stdio test cancels mid-search and connection stays healthy | CLOSED |
| P0.5 | Legacy `@modelcontextprotocol/sdk@1.x` runtime dep | Migrated to official v2 packages: `@modelcontextprotocol/server@2.0.0`, `@modelcontextprotocol/core@2.0.0`, client `@2.0.0` (dev). `zod@4.5.4` (Standard Schema with `jsonSchema`). Legacy dep removed. Core packages import zero MCP types | CLOSED |
| P0.6 | Era placeholder "2026-07-28" could be reported as fact | Observed evidence: SDK v2.0.0 `SUPPORTED_PROTOCOL_VERSIONS = [2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07]`. Real stdio negotiation observed: **2025-11-25** (`client.getNegotiatedProtocolVersion()`). `era.ts` now separates desired/sdk-supported/observed; telemetry reports `negotiated_mcp_era_observed` only from real observation | CLOSED |
| P0.7 | NUL-heavy UTF-16 classified binary before BOM check | `isLikelyBinary` recognizes BOM first; UTF-16 LE/BE end-to-end fs_read + patch tests pass; true binary still typed `ERR_BINARY_FILE` | CLOSED |
| P0.8 | `expected_hash` optional on overwrite → silent lost updates | Overwrite without `expected_hash` → `ERR_STALE_RESOURCE` (rejected in-memory AND over real stdio, file proven unchanged); create verifies non-existence before commit; correct/stale CAS paths tested | CLOSED |
| P0.9 | Atomic replace reset mode bits | Mode captured before temp write; writable-file mode preserved (test); read-only target fails CLOSED `ERR_FILE_BUSY` (no truncate). POSIX exec-bit: test exists, auto-skip on win32 — **BLOCKED: needs POSIX CI lane** (in `.github/workflows/ci.yml`) | CLOSED (1 platform item BLOCKED, documented) |

## P1 closure table

| Item | Status |
|---|---|
| P1.1 capability boundaries | CLOSED — fs business logic moved to `@ccr/fs`; `scripts/architecture-check.mjs` fails CI on `node:fs`/`node:child_process` in mcp-adapter; check PASS |
| P1.2 catalog vs availability | CLOSED — 13-tool catalog kept; `_meta: {"ccr/availability": implemented\|planned}` on each tool; typed unsupported errors preserved |
| P1.3 truthful health | CLOSED — `backendHealth.native=false` (no addon exists), `nodeFallback=true`; ast/lsp operational=false while catalog=true |
| P1.4 gitignore/hidden semantics | narrowed + documented: hidden-dotfiles skipped always; `.gitignore` subset (no negation) documented in code; sensitive policy independent (proven by visible-file tests) | CLOSED (reduced contract documented) |
| P1.5 truncation/totalCount | CLOSED — Contract A: exact counts past limit (test proves 2 matches with limit 1 → totalCount=2, truncated=true) |
| P1.6 timing/metrics | CLOSED — `totalMs` from monotonic `performance.now()` via `timed()` wrapper; no placeholders (asserted in tests reading `timing.totalMs > 0` on slow paths) |
| P1.7 benchmarks | NOT DONE — **BLOCKED/deferred**: no benchmark harness yet; no performance claims made anywhere in docs (truth-model enforced) |
| P1.8 CI | CLOSED — `.github/workflows/ci.yml`: pnpm frozen install, tsc build, unit+integration, stdio subprocess, architecture check, VCS tests, win+ubuntu matrix, Node 24 |
| P1.9 docs truth | CLOSED — README + reports rewritten (16 packages, Integration Foundation/Alpha, connected≠certified) |
| P1.10 G3 re-audit | CLOSED — G3 downgraded then re-earned; matrix 24 items: PASS with 2 documented platform BLOCKED (POSIX exec-bit, true lock injection) |

## Evidence summary

- Build/typecheck: `npx tsc --build` → exit 0.
- Tests: `node --experimental-strip-types --test "packages/*/test/*.test.ts"` → **76 tests, 75 pass, 0 fail, 1 skip** (skip = POSIX-mode test on win32, reason recorded).
- Architecture: `node scripts/architecture-check.mjs` → PASS.
- MCP era: observed `2025-11-25` over real stdio (SDK v2.0.0; supported list verified at runtime).
- Hosts: OpenCode + Claude Code `mcp list` → `ccr connected` (transport/handshake evidence only — NOT certification).

## Final self-check (10 questions)

1. VCS reads only the authorized workspace? **Yes** — resolved absolute path required; sibling-repo isolation proven. 
2. Can a denied sensitive file be opened by search? **No** — read-spy proves zero opens for visible sensitive files. 
3. Can cancellation leave a search/git child running? **No** — signal kills subprocess; listener removed; connection survives cancel (proven). 
4. Can era 2026-07-28 be reported while speaking 2025? **No** — observed-only reporting; supported list from the installed SDK; observed = 2025-11-25. 
5. Can fs_write overwrite without proving observed version? **No** — overwrite requires `expected_hash`; create verifies non-existence at commit. 
6. Can a valid UTF-16 BOM file be rejected as binary? **No** — BOM detection precedes NUL heuristic; LE/BE end-to-end tests pass. 
7. Can patching an executable remove its exec bit? **No on POSIX-preserving path** (mode captured + restored); win32 read-only fails closed. POSIX proof: **BLOCKED to CI lane** (test armed). 
8. Does mcp-adapter still own fs/vcs business logic? **No** — moved to `@ccr/fs`; CI check enforces. 
9. Is every PASS backed by acceptance cases? **Yes** — G3 matrix itemized; gate reports list per-case evidence. 
10. Any performance claims without benchmarks? **No** — P1.7 explicitly not-claimed; docs contain no perf numbers.

## Verdict

**R0 PASSES**: all P0 items closed with executable evidence; remaining environment limitations are documented BLOCKED items backed by armed tests and the CI matrix, not silent passes. The repository may be described as a **Production Foundation** (8/13 tools functional; AST/LSP remain planned; host certification remains G6 work).

Post-remediation (AST search qualification, LSP spike, persistent LSP, G6 same-task certification) may now resume.
