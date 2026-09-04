# Production Next Implementation Status

Status: `REMEDIATION_INCOMPLETE`; closeout hardening is committed in this change
set, while release and promotion admission remain withheld.

Capture date: 2026-09-04

Candidate HEAD: captured from the final commit and verifier output; see the
commit/push record for the exact SHA.

Candidate state: tracked source is clean after the authorized commit; generated
candidate evidence remains intentionally untracked and is regenerated for each
final SHA. The approved baseline remains
`273ed28947a94a2495b10721f725447ea769994d`; the baseline is an ancestor of the
candidate HEAD, rather than a required exact match.

## Local hardening disposition

| Gate | Current state | Evidence and boundary |
|---|---|---|
| Gate A | Implemented locally | Windows skips the unsafe recursive `fs.watch` path and uses a non-recursive root hint plus bounded reconciliation; overflow, nested fallback, and stop/restart are regression-tested. |
| Gate B | Implemented locally | Raw event/idempotency/code-state mutation is test-mode only; caller-declared evaluator identity is stored as `external_unverified`; production evaluation targets are receipt-verified. |
| Gate C | Implemented locally | The daemon registers canonical worktree roots, starts bounded live indexing, routes reads through path policy, and keeps provider degradation non-fatal. |
| Gate D | Implemented locally | Impact is materialized at intent/code-state update time; `coord_sync` reads bounded events, does not reload the graph, and does not append heartbeat events. Evaluation queries use run-scoped indexes. |
| Gate E | Implemented locally | Composite proposals include every normalized resource and payload digest; receipts preserve resource outcomes and `PARTIAL` has its own event type. |
| Gate F | Partial | Baseline ancestry logic and local qualification are covered; candidate-bound release evidence remains incomplete, while cross-platform qualification is tracked by the successor candidate's GitHub Actions run. |

## Implemented local layers

PN0/PN1 compatibility remains the 13-tool MCP surface. PN2–PN5 now include
the SQLite coordination store, local daemon IPC, coordination runtime,
daemon-managed code-state, canonical worktree registration, protected-path
indexing, bounded watcher reconciliation, and provider-health reporting.

PN6 materializes bounded impact results with directional graph traversal and
selective routing. PN7 uses content preconditions, per-file atomic publication,
composite plan digests, read-back verification, and explicit `PARTIAL` results.
PN8 separates external declarations from server-registered evaluator output and
binds production runs to verified change receipts. PN9 has an isolated
self-host replay with a rejected first attempt, a bounded accepted retry,
impact routing, and no autonomous spawning. PN10 remains a local policy and
audit seam; it is not enterprise authentication.

## Qualification evidence

The following are local qualification records, not promotion evidence:

- `pnpm verify` covers build, architecture, public-boundary, unit/integration,
  release, gate-evidence, and installed-artifact smoke checks.
- Latest local run: 202 tests, 201 passed, 1 platform-specific skip, and 41/41
  release tests passed.
- `node scripts/dogfood-self-host.mjs --evidence-out evidence/PN9.json`
  exercises the candidate daemon, isolated worktrees, change receipts, and
  server-side evaluator execution.
- `node benchmarks/impact-routing-arms.mjs --evidence-out evidence/PN6.json`
  compares the controlled impact-routing arms.
- `node benchmarks/evaluation-feedback-arms.mjs --evidence-out evidence/PN8.json`
  compares controlled ordinary and structured feedback arms.
- `node benchmarks/local-reliability.mjs --evidence-out evidence/PN12.json`
  checks local crash recovery, idempotency, stale evidence, evaluator failure,
  retry exhaustion, and IPC frame bounds.

Repeated local reliability runs measured crash recovery at approximately
`1.45–1.67 s` on Windows/Node 26 and passed all six declared local scenarios.

The four PN evidence files are deliberately generated outside the tracked
release commit. `pnpm verify:production-next-evidence` checks their schema,
candidate state digest, and exact candidate commit. Controlled fixtures cannot
be upgraded into product-value or stable-bootstrap claims.

Reconciliation is fingerprint-aware: unchanged files do not generate repeated
`CodeGraphUpdated` events during fallback polling.

## Withheld gates

PN6 remains withheld until the impact-routing improvement is observed on
independent engineering work with traceable downstream correctness and rework
outcomes. PN8 remains withheld until structured-feedback repair yield and
regression protection are observed on independent engineering work. PN9 remains
withheld until a distinct, verified stable N-1 runtime controls the candidate
rebuild/retest flow.

PN12 may remain local, but its untested fault classes remain explicit: disk-full,
permission loss, artifact-store disk-full, LSP crash loops, Git cancellation,
enterprise network partition, and PostgreSQL failover.

PN11 is not started. PN13 is not admitted. A passing local test suite does not
override these external evidence requirements or the read-only promotion gate.

The current public GitHub history contains dependency-update PRs only; no
independent engineering run, reviewer decision, downstream correctness result,
repair-yield observation, or stable N-1 bootstrap is available there for PN6,
PN8, or PN9 admission.

## Recommended next action

Run the committed candidate through the real engineering evidence workflow:
use a verified stable N-1 runtime, collect independent PR/CI or work-item run
identifiers for PN6 and PN8, bind the evidence to the exact candidate state,
and rerun the read-only promotion verifier. Only then reconsider PN11 entry.
