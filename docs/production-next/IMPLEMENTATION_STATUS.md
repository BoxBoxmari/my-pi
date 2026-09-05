# Production Next Implementation Status

Status: `PROMOTION_WITHHELD`; closeout hardening and the stable self-build are
committed/verified, while PN6, PN8, and overall promotion admission remain
withheld.

Capture date: 2026-09-05

Candidate HEAD: current `main` HEAD; verify with `git rev-parse HEAD` and the
candidate-bound verifier. `origin/main` must match after each push.

Candidate state: candidate-state policy reports clean source state; generated
candidate evidence remains intentionally untracked and is regenerated for each
final SHA. The approved baseline remains
`273ed28947a94a2495b10721f725447ea769994d`; the baseline is an ancestor of the
candidate HEAD, rather than a required exact match.

## Local hardening disposition

| Gate | Current state | Evidence and boundary |
|---|---|---|
| Gate A | Implemented locally and remotely qualified for the current predecessor | Windows skips native `fs.watch` backends entirely and uses bounded fingerprint reconciliation; the blocking matrix is re-established for every successor SHA. |
| Gate B | Implemented locally | Raw event/idempotency/code-state mutation is test-mode only; caller-declared evaluator identity is stored as `external_unverified`; production evaluation targets are receipt-verified. |
| Gate C | Implemented locally | The daemon registers canonical worktree roots, starts bounded live indexing, routes reads through path policy, and keeps provider degradation non-fatal. |
| Gate D | Implemented locally | Impact is materialized at intent/code-state update time; `coord_sync` reads bounded events, does not reload the graph, and does not append heartbeat events. Evaluation queries use run-scoped indexes. |
| Gate E | Implemented locally | Composite proposals include every normalized resource and payload digest; receipts preserve resource outcomes and `PARTIAL` has its own event type. |
| Gate F | Remote pass; local strict admission withheld | Baseline ancestry and remote candidate qualification are covered; local generated legacy release artifacts remain a separate freshness boundary. |

## Implemented local layers

PN0/PN1 compatibility remains the 13-tool MCP surface. PN2–PN5 now include
the SQLite coordination store, local daemon IPC, coordination runtime,
daemon-managed code-state, canonical worktree registration, protected-path
indexing, bounded watcher reconciliation, and provider-health reporting.

PN6 materializes bounded impact results with directional graph traversal and
selective routing. PN7 uses content preconditions, per-file atomic publication,
composite plan digests, read-back verification, and explicit `PARTIAL` results.
PN8 separates external declarations from server-registered evaluator output and
binds production runs to verified change receipts. PN9 has both a candidate
diagnostic replay and an accepted stable N-1 bootstrap with a rejected first
attempt, a bounded accepted retry, impact routing, and no autonomous spawning.
PN10 remains a local policy and audit seam; it is not enterprise authentication.

## Qualification evidence

The following are local qualification records, not all of which are promotion
evidence:

- `pnpm verify` covers build, architecture, public-boundary, unit/integration,
  release, gate-evidence, and installed-artifact smoke checks.
- Latest targeted local run: `pnpm build` plus watcher/daemon tests, `10/10`
  passed after OT-005. OT-006 then passed its daemon suite `8/8` and code-state
  suite `9/9`. The full `pnpm verify` reached 206 tests with `203` passed, two
  daemon IPC timeouts, and one platform-specific skip; the boundary is recorded
  in `OT-004.result.json`; OT-005 and OT-006 have their own scoped result records.
- `node scripts/dogfood-stable-bootstrap.mjs --evidence-out evidence/PN9.json`
  builds a clean candidate using distinct stable predecessor `fe671ae`, opens
  it through the stable MCP runtime, and proves stable ChangeRuntime/evaluation
  authority without starting the candidate daemon. The latest run exited `0`
  and PN9 evidence is accepted by the read-only verifier. The same stable my-pi
  authority also drove the paired observed-review runner for OT-008, OT-009,
  and OT-010.
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
candidate state digest, and exact candidate commit. PN6/PN8/PN12 remain
controlled/local qualification records; the stable PN9 profile is accepted only
because its predecessor runtime proof is independently checked. Controlled
fixtures cannot be upgraded into product-value claims.

Reconciliation is fingerprint-aware: unchanged files do not generate repeated
`CodeGraphUpdated` events during fallback polling.

## Withheld gates

PN6 remains withheld until the ten real task records can support downstream
repair/rework, precision/recall, and repeated missed-dependency/false-positive
accounting beyond the paired observer control. PN8 remains withheld until
structured-feedback repair yield and regression protection are compared with an
ordinary-log handoff across independent evaluation-gated engineering work;
OT-004 through OT-006 supply three real reject/retry cycles, while OT-008 through
OT-010 supply three executed paired route baselines without a repair claim. PN9 is
accepted by the stable-bootstrap verifier for the last evidence-bound candidate
and predecessor `fe671ae`; rerun it for the current final SHA after any commit.

PN12 may remain local, but its untested fault classes remain explicit: disk-full,
permission loss, artifact-store disk-full, LSP crash loops, Git cancellation,
enterprise network partition, and PostgreSQL failover.

PN11 is not started. PN13 is not admitted. A passing local test suite does not
override these external evidence requirements or the read-only promotion gate.

The current public GitHub history contains dependency-update PRs only. Local
observed-task records now preserve independent engineering run identifiers,
executed route baselines, downstream test results, and stable N-1 evidence, but
the promotion verifier still withholds PN6/PN8 until their required observed
envelopes are assembled from those records.

## Recommended next action

Use OT-001…OT-010 to assemble only evidence supported by stored outcomes. Add
one evaluation-gated task with an executed downstream repair comparison and an
ordinary-log feedback arm if those missing metrics cannot be recovered from the
records, then rerun the read-only promotion verifier. Only then reconsider PN11
entry.
