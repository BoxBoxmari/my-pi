# Production Next Implementation Status

Status: candidate implementation; release and promotion admission withheld.

Capture date: 2026-09-04

Baseline: `273ed28947a94a2495b10721f725447ea769994d`

The repository changes in this worktree are uncommitted. The status below records implementation evidence, not an admission claim.

## Implemented local layers

| Gate | Current state | Evidence |
|---|---|---|
| PN0/PN1 | Candidate implementation | Baseline record, legacy catalog golden test, protocol-neutral contracts, ADRs, boundary tests |
| PN2 | Candidate implementation | SQLite WAL, migrations 0001–0004, event/projection/idempotency/audit tests, store benchmarks |
| PN3 | Candidate implementation | Windows named-pipe and Unix-socket abstraction, lock/discovery/reconnect tests |
| PN4 | Candidate implementation | Coordination runtime, six opt-in MCP tools, claim/intent/sync/publish/complete tests |
| PN5 | Candidate implementation | Incremental code-state index, AST reuse, watcher, persistence and provider-degradation tests |
| PN6 | Implementation candidate only | Five labelled controlled-replay workload classes and A–E arm comparison; product kill gate is not admitted |
| PN7 | Candidate implementation | Shared ChangeRuntime, immutable snapshot metadata, CAS revalidation, receipts and PARTIAL tests |
| PN8 | Implementation candidate only | Exact-state acceptance, eight seeded defect classes, and a controlled ordinary-log versus structured-feedback replay; external repair-value gate is not admitted |
| PN9 | Implementation candidate only | Self-host replay on isolated copies of this repository: ChangeRuntime updates `packages/contracts/src/ids.ts`, code-state indexes the import chain, ImpactDetected reaches the reviewer, the first attempt is rejected, an authorized retry is accepted, and dependency work unblocks; stable N-1 promotion remains withheld |
| PN10 | Local security seam | Principal/policy/approval/classification/audit primitives; enterprise auth is not qualified |
| PN12 | Local qualification candidate | Hard-crash/restart persistence, idempotency, stale-evidence, evaluator-failure, retry-budget, and IPC-bound checks; enterprise fault classes remain untested |

## Measured local evidence

- `pnpm verify`: 189 passing tests, 1 platform-specific skip, 36/36 release tests, clean-install smoke pass.
- Coordination latency: 1,000 events, p50 0.31 ms, p95 0.70 ms on Windows/Node 26.
- Coordination contention: four independent processes, 400 observed events.
- PN6 controlled replay: five workload classes; full routing recall 1.0 versus task-board-only 0.5, modeled repair iterations 1.0 versus 2.4, and seven fewer modeled stale-contract mistakes.
- Code-state index: 20 files, 40 entities, 20 edges, approximately 0.9–1.0 seconds.
- Code-state incremental update: p50 approximately 38 ms, p95 approximately 57 ms.
- Evaluation throughput: 100 runs, approximately 217 runs/second.
- Feedback corpus: 8 cases, zero false accepts, two inconclusive outcomes, five bounded retry recommendations.
- PN8 controlled replay: structured feedback repair yield 1.0 versus ordinary-log 0.4 across five retryable cases; all five structured retries preserved the regression guard.
- Dogfood smoke: dependency block, selective sync, unblock and exact-state acceptance all observed; candidate identity remains `uncommitted`.
- Self-host replay: `node scripts/dogfood-self-host.mjs --evidence-out evidence/PN9.json` passed; PN9 evidence validation records two APPLIED receipts, one rejected attempt, one accepted retry, 46 events, and zero unrelated observer items.
- PN12 local reliability: `node benchmarks/local-reliability.mjs --evidence-out evidence/PN12.json` passed on Windows/Node 26; crash recovery measured at approximately 1.3–1.4 seconds across local runs and all six local scenarios were true.

These measurements are local qualification evidence only. They do not establish cross-platform, enterprise, or product-market claims.

## Withheld gates and reasons

PN6 has a candidate-bound controlled replay, but remains withheld until representative shared-contract workloads provide observed downstream correctness and rework outcomes rather than fixture-derived repair labels.

PN8 has a candidate-bound controlled replay and zero seeded false accepts, but remains withheld until the repair-yield comparison is observed on real or independently replayable engineering work rather than the fixture repair model.

PN9 has candidate-bound self-host evidence; the evidence explicitly records `stableNMinusOneVerified: false`, so promotion remains withheld until a distinct stable N-1 runtime controls candidate N and the candidate can rebuild/retest itself from a clean checkout.

PN11 is not started because its entry condition depends on PN6, PN8 and PN9.

PN13 is not admitted. `node scripts/verify-release.mjs --strict` currently withholds admission because the committed legacy evidence and benchmarks are bound to `fc89a0d2cf1f260f7617a09454f93d5fb75efa31`, while the current candidate identity resolves to `273ed28947a94a2495b10721f725447ea769994d`.

## Next authorized handoff

Review and commit the candidate worktree, regenerate candidate-bound evidence/SBOM, rerun strict release verification, then replace the controlled PN6/PN8/PN9 signals with independently observed acceptance evidence before considering any enterprise control-plane implementation.
