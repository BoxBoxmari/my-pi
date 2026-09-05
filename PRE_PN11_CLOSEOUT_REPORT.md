# Pre-PN11 Production Next Closeout Report

Status: `PROMOTION_WITHHELD`

Capture date: 2026-09-05

This report closes the local Production Next hardening batch. It does not start
PN11, and it does not convert controlled fixture results into product-value or
stable-bootstrap claims.

## 1. Candidate identity

| Field | Observed value |
|---|---|
| Candidate HEAD | Current `main` HEAD; verify with `git rev-parse HEAD` and the candidate-bound verifier |
| `origin/main` | Must match the current HEAD; verified with `git ls-remote origin refs/heads/main` after push |
| Approved baseline | `273ed28947a94a2495b10721f725447ea769994d` |
| Baseline relation | `git merge-base --is-ancestor` passes; baseline is an ancestor, not an exact-HEAD requirement |
| Worktree | Candidate-state policy reports clean source state; generated evidence, gate evidence, and SBOM files remain local and uncommitted |
| Package version | `0.1.0-alpha.1` |
| Store migration | 5 |

The hardening and evidence records are committed as user-authorized commits.
The final remote synchronization is established by the post-push `git
ls-remote` check and the candidate-bound GitHub Actions runs below.

## 2. Findings disposition

| # | Original finding | Disposition | Current evidence |
|---:|---|---|---|
| 1 | Windows CodeStateWatcher crash | `CONFIRMED` | Windows now skips native Node `fs.watch` backends entirely and relies on bounded fingerprint reconciliation; watcher seam tests cover Windows backend exclusion, fallback, overflow, failure, and restart. |
| 2 | Raw daemon mutation authority | `CONFIRMED` | `append_event`, `idempotency_record`, and ad-hoc `code_state_index` require explicit daemon test mode; ordinary raw-event injection is regression-tested as denied. |
| 3 | Trusted evaluator provenance | `CONFIRMED` | Caller declarations are `external_unverified`; `eval_evaluate` uses server-registered providers; forged provider identity cannot satisfy a trusted criterion. |
| 4 | Caller-controlled repository state reference | `CONFIRMED` | Production evaluation requires a receipt whose integrity, project, worktree, and output fingerprints are rechecked by the daemon. |
| 5 | Code state not live in daemon lifecycle | `CONFIRMED` | `CodeStateManager` registers worktrees, performs bounded initial indexing, watches changes, reconciles overflow, and reports degradation without stopping coordination. |
| 6 | Code state not worktree-aware | `CONFIRMED` | `coord_join` canonicalizes worktree roots and verifies Git common identity against the daemon project; stored roots drive indexing. |
| 7 | Code-state reads bypass path policy | `CONFIRMED` | `IndexContext.resolveReadPath` is required; filesystem and AST providers use the workspace path/sensitive-path policy. `.env` and worktree isolation are tested. |
| 8 | Full impact recomputation in `coord_sync` | `CONFIRMED` | Impact is persisted at intent/code-state update time; sync routes bounded persisted events and no longer receives or recomputes the full graph. |
| 9 | Durable heartbeat on every poll | `CONFIRMED` | Heartbeats update the session projection only; repeated sync polling produces no durable `AgentHeartbeat` growth. |
| 10 | Project-wide evaluation projection scans | `CONFIRMED` | Run-scoped evaluation tables, indexes, and query methods are present in migration 5 and covered by store tests. |
| 11 | Composite `ChangeProposal` represented only first file | `CONFIRMED` | Composite proposals now include normalized resources, operation type, preconditions, payload digests, policy context, and one deterministic plan digest. |
| 12 | `PARTIAL` collapsed into rejection | `CONFIRMED` | Receipts carry resource-level outcomes and `ChangePartiallyApplied` is preserved as a distinct event/projection path. |
| 13 | Strict verifier required baseline equal to HEAD | `CONFIRMED` | Readiness now checks baseline ancestry; tests cover equality, descendant, unrelated, dirty, and wrong-evidence cases. |
| 14 | Stale implementation/provenance documentation | `CONFIRMED` | Production Next status, observed-evidence guidance, security, contracts, architecture, release wording, and this report were refreshed. |
| 15 | Final multi-platform qualification | `PASS` | The OT-006 implementation at `5d9c696` passed the blocking CI matrix in [run 33950972082](https://github.com/BoxBoxmari/my-pi/actions/runs/33950972082) and CodeQL in [run 33950972093](https://github.com/BoxBoxmari/my-pi/actions/runs/33950972093): Windows Node 24, Ubuntu Node 22/24, macOS Node 24, release checks, supply-chain checks, runtime boundary evidence, and Production Next candidate qualification all completed successfully. Later result/document commits are evidence-only successors and require their own candidate-bound CI. |

## 3. Implementation summary

The hardening preserves the 13-tool legacy MCP surface and keeps coordination and
evaluation opt-in. The main changes are a daemon-managed code-state lifecycle,
canonical worktree registration, explicit test-only raw IPC seams, server-side
evaluation provenance, receipt-verified evaluation targets, event-time impact
materialization, projection-only heartbeats, indexed evaluation queries, and
composite publication receipts.

The implementation uses an additive `CodeStateManager`, a bounded watcher
reconciliation path, and a fifth SQLite migration rather than replacing the
existing store or protocol adapter. `eval_evaluate` was added to the experimental
evaluation family because accepting caller-submitted pass results would violate
the trust boundary. No agent framework, model router, hosted control plane,
arbitrary shell evaluator, A2A layer, or Twilio messaging/voice integration was
added. The Twilio skills were reviewed and are not applicable to this local
coding-runtime product.

## 4. Security and trust changes

The daemon now distinguishes domain operations from raw test operations. A
normal IPC client cannot append an arbitrary event or write an idempotency record.
The `change_record` path is not a raw event API: the daemon verifies the receipt
digest and re-reads every output version through the registered worktree policy.

Evaluation has two explicit paths. `eval_record` stores caller declarations as
`external_unverified`; the declared provider name is attribution, not authority.
`eval_evaluate` runs a provider registered by the server and stores
`verified_provider` provenance. Acceptance ignores unverified declarations, and
provider errors remain inconclusive.

Production evaluation state references are derived from a verified change receipt
and its current output fingerprints. A stale or substituted target is rejected.
Sensitive-path policy is shared by normal filesystem operations and code-state
indexing, including missing-path invalidation, containment, and symlink-aware
canonicalization.

## 5. Code-state and worktree changes

`coord_join` derives the canonical root and Git identity from the server-side
project discovery path. A worktree ID is persisted only after its root is
canonicalized and checked. Each registered worktree owns an indexer, watcher,
known-path set, and serialized update queue.

Initial indexing is bounded to 200 files by default. Reconciliation is bounded to
2,000 files and is triggered by watcher overflow, recursive-watch unavailability,
or periodic fallback. Filesystem notifications remain invalidation hints; stored
fingerprints are authoritative. Provider failures mark the lifecycle degraded
without taking down the daemon.

## 6. Performance and scalability changes

`coord_sync` now depends on a bounded event page, current assignments, and
dependency projections. It no longer loads a code graph or invokes
`ImpactEngine` for every active intent on every poll. Impact results are
materialized when intents or relevant code-state updates are observed.

Heartbeat freshness is projection-only. Evaluation results, decisions, feedback,
and retry cycles have run-scoped indexed queries. Impact traversal is directional:
dependency edges propagate to dependents, while `contains` edges expand from a
container without automatically reversing into unrelated parents.

Periodic code-state reconciliation compares authoritative file fingerprints and
does not emit a `CodeGraphUpdated` event for an unchanged file, preventing a
quiet worktree from producing synthetic event-log growth.

The latest local measurements were: coordination latency p50 `0.241 ms`, p95
`0.499 ms` for 1,000 events; four-process contention observed 400 events in
`551 ms`; 20-file code-state indexing produced 40 entities and 20 edges in
`968.626 ms`; incremental code-state updates measured p50 `45.366 ms` and p95
`50.072 ms`; and evaluation throughput measured `247.89 runs/s` across 100 runs.

## 7. Change and evaluation semantic changes

`applyMany` canonicalizes and sorts the complete batch before creating one
composite proposal. Its plan digest includes all paths, operation kinds,
preconditions, payload digests, and policy mode. The receipt includes all input
versions, published output versions, and resource-level `APPLIED`/`REJECTED`
results. Its digest uses stable key ordering.

`PARTIAL` remains a first-class status with `verification.verified: false` and a
distinct `ChangePartiallyApplied` event. It is not represented as a clean success
or a clean rejection.

## 8. Tests and benchmark results

The targeted local qualification for the current implementation passed with
`pnpm build` and the watcher/daemon tests at `10/10` after OT-005. OT-006 then
passed its daemon suite `8/8` and code-state suite `9/9`. The full local `pnpm verify`
run reached 206 tests with `203` passed, `2` daemon IPC timeouts, and `1`
platform-specific skip; the two failures were recorded as local resource
saturation in `dogfood/observed-tasks/OT-004.result.json`, not silently ignored.

The OT-006 remote workflow [33950972082](https://github.com/BoxBoxmari/my-pi/actions/runs/33950972082)
and CodeQL workflow [33950972093](https://github.com/BoxBoxmari/my-pi/actions/runs/33950972093)
both completed successfully. The remote job also passed release verification,
SBOM generation, benchmark smoke, runtime boundary evidence, and the stable
Production Next qualification step.

The stable self-build command
`node scripts/dogfood-stable-bootstrap.mjs --evidence-out evidence/PN9.json`
completed with exit code `0` against the candidate before OT-005. OT-005 itself
was then implemented and evaluated through the same distinct predecessor
authority in a clean candidate worktree. The stable run built the distinct
predecessor `fe671aec2b31c8d71e7a95e7e15a37073e0c4d39`, built a clean candidate
checkout, used the predecessor daemon/MCP/ChangeRuntime/evaluation runtime, and
kept `candidateDaemonStarted=false`. The read-only evidence verifier accepted
this PN9 record.

## 9. Remaining limitations

PN6 and PN8 generated envelopes remain controlled replay, not promotion evidence.
Seven real task records now exist in `dogfood/observed-tasks/`: OT-001 through
OT-007. They provide traceable commits, CI, impact observations, three real
stable evaluation reject/retry cycles, but miss/false-positive
accounting is not repeated across the task set and the observed envelopes have
not been accepted by the promotion contract. OT-007 additionally records a
downstream reviewer route without an explicit dependency, but its task-board
comparison remains counterfactual rather than a paired experiment. PN9 now has a distinct stable N-1
proof using `fe671ae`; PN12 intentionally leaves disk-full, permission-loss,
artifact-store disk-full, LSP crash-loop, Git-cancellation,
enterprise-network-partition, and PostgreSQL-failover faults untested.

Native acceleration remains deferred. The current code-state lifecycle is
bounded and local, not a complete cross-host distributed state service. The
Local strict release verification still depends on generated legacy artifacts
being rebound to the exact candidate SHA. Remote candidate qualification is
green and is the authoritative cross-platform result for the latest code commit
`5d9c696` (result-only successors require their own check runs).

The public GitHub PR and issue history exposes no independent product-work PRs,
but the local observed-task records preserve stable WorkItem, Intent,
ChangeReceipt, EvaluationRun, FeedbackPacket, commit, and CI identifiers. Those
records are useful observed inputs; they do not by themselves satisfy the
promotion verifier's PN6/PN8 envelope requirements.

## 10. Gate status

| Gate | Status | Decision |
|---|---|---|
| Gate A: platform and CI correctness | Pass on `5d9c696` remote matrix | Windows native watcher assertion is removed by reconciliation-only mode; the final blocking matrix and CodeQL runs are green. |
| Gate B: trust and authority | Local pass | Raw mutation and evaluator provenance boundaries are enforced. |
| Gate C: live code state | Local pass | Daemon-managed, worktree-aware, policy-authorized lifecycle is exercised. |
| Gate D: coordination scalability | Local pass | Materialized impact, projection-only heartbeat, and indexed evaluation paths are exercised. |
| Gate E: semantic integrity | Local pass | Composite receipts and explicit PARTIAL semantics are exercised. |
| Gate F: release qualification | Remote pass; local strict admission withheld | Remote bind/release checks pass. Local generated legacy gate evidence remains a separate freshness boundary and is not used to claim release admission. |

## 11. Production Next status

| Area | Status |
|---|---|
| Implementation architecture | Implemented locally; additive and opt-in |
| Local candidate qualification | Targeted `9/9`; full suite inconclusive from two IPC timeouts |
| PN6 observed evidence | Withheld; OT-001…OT-007 include one downstream exact-scope route, but still lack repeated executed baseline comparisons and miss/false-positive accounting |
| PN8 observed evidence | Withheld; OT-004 through OT-006 have real reject/retry cycles, but the evidence lacks an ordinary-feedback comparison across the task set |
| PN9 stable N-1 | Accepted by stable-bootstrap verifier using distinct `fe671ae` |
| PN11 entry | Withheld; PN6/PN8/PN9 prerequisites are not satisfied |
| PN13 promotion | Withheld by the read-only promotion verifier |

Candidate-mode envelopes remain diagnostic and cannot grant product or enterprise
admission. The evidence verifier can confirm schema, candidate commit, and
candidate-state binding; the stable-bootstrap profile additionally requires
runtime-generated predecessor and authority proof.

## 12. Recommended next action

Do not start PN11. Consolidate the seven real task records into an approved
observed-replay envelope only where the stored outcomes support the required
metrics, or collect another heterogeneous evaluation-gated task with explicit
miss/false-positive accounting. Then rerun the read-only evidence and promotion
verifiers. Keep local IPC saturation and any other platform failures explicitly
classified.

## Final decision

`PRODUCTION_NEXT_CLOSEOUT: WITHHELD`

`PN11_ENTRY: WITHHELD`

Recommended PR/commit decomposition: separate watcher and daemon lifecycle;
trust/evaluation authority; code-state and impact materialization; change/store
semantics; and final documentation/evidence qualification. The current
implementation, evidence record, and documentation commits are synchronized on
`origin/main`; the admission decision remains withheld pending the evidence
boundaries recorded above.
