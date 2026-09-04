# Pre-PN11 Production Next Closeout Report

Status: `REMEDIATION_INCOMPLETE`

Capture date: 2026-09-05

This report closes the local Production Next hardening batch. It does not start
PN11, and it does not convert controlled fixture results into product-value or
stable-bootstrap claims.

## 1. Candidate identity

| Field | Observed value |
|---|---|
| Candidate HEAD | Captured by the final verifier and commit record; the exact SHA is intentionally not duplicated here |
| `origin/main` | Compared with the candidate by `git ls-remote origin refs/heads/main` after push |
| Approved baseline | `273ed28947a94a2495b10721f725447ea769994d` |
| Baseline relation | `git merge-base --is-ancestor` passes; baseline is an ancestor, not an exact-HEAD requirement |
| Worktree | Tracked closeout changes are committed; generated `evidence/PN6.json`, `PN8.json`, `PN9.json`, and `PN12.json` remain intentionally untracked |
| Package version | `0.1.0-alpha.1` |
| Store migration | 5 |

The hardening batch is committed as one user-authorized change set. The final
remote synchronization is established separately by the post-push `git
ls-remote` check, rather than by copying a volatile SHA into this report.

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
| 15 | Final multi-platform qualification | `DEFERRED_WITH_REASON` | The prior `303f8c3` run passed CodeQL, Ubuntu Node 22, and macOS Node 24, but Windows Node 24 hit the libuv `src\\win\\fs-event.c:72` assertion in both watcher-bearing test files; Ubuntu Node 24 gitleaks failed because shallow checkout omitted predecessor `f6c058d...` from its requested range. The current successor fix removes all Windows native watcher calls and gives CI full history; remote qualification is determined only by the blocking workflow run attached to that successor. A read-only audit of available GitHub PRs found only Dependabot changes, not independent engineering outcomes for PN6/PN8/PN9. |

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

The final local `pnpm verify` run passed:

- 202 unit/integration/compatibility tests: 201 passed, 1 platform-specific skip;
- release test suite: 41/41 passed;
- project references, architecture boundary, public boundary, gate evidence,
  build, installed-package smoke, and 13-tool artifact checks: passed;
- local PN6 controlled replay: 5 cases, full routing recall `1.0` versus the
  task-board-only `0.5` baseline, 1.4 fewer average repair iterations, and 7
  fewer modeled stale-contract mistakes;
- local PN8 controlled replay: 8 cases, structured repair yield `1.0` versus
  ordinary-log `0.4`, five prior passes preserved, zero seeded false accepts;
- PN9 self-host replay: passed with a rejected first evaluation, accepted bounded
  retry, receipt-verified target state, impact routing, and no autonomous spawn;
- PN12 local reliability: all six local scenarios passed, including crash
  recovery, idempotency, stale evidence rejection, evaluator failure handling,
  retry exhaustion, and oversized IPC rejection; repeated Windows/Node 26 runs
  measured crash recovery in the approximately `1.45–1.67 s` range.

The local `pnpm audit --prod` check reported no known vulnerabilities. The
prior pushed-commit GitHub Actions run [33857668261](https://github.com/BoxBoxmari/my-pi/actions/runs/33857668261)
completed with CodeQL and macOS Node 24 success, but Windows Node 24 unit tests
failed; its public annotations exposed only process exit codes and job logs
returned HTTP 403. The successor candidate's current workflow run is the only
authoritative source for post-fix remote qualification, so the prior failure is
not attributed to code or infrastructure beyond the separately reproduced
recursive-watcher risk.

The next successor run [33897503533](https://github.com/BoxBoxmari/my-pi/actions/runs/33897503533)
confirmed the Windows failure with `Assertion failed: !_wcsnicmp(filename, dir,
dirlen), file src\\win\\fs-event.c, line 72` in
`apps/my-pi-daemon/test/code-state-lifecycle.test.ts` and
`packages/code-state/test/code-state.test.ts`. Its Ubuntu Node 24 gitleaks step
failed before scanning because the shallow checkout did not contain the
`f6c058d...^..303f8c3...` range requested by the action. The current working-tree
fix addresses both concrete causes; its successor run is still required.

## 9. Remaining limitations

PN6 and PN8 evidence remains controlled replay, not independent engineering
outcomes. PN9 still uses the current candidate build as its bootstrap and has not
verified a distinct stable N-1 runtime. PN12 intentionally leaves disk-full,
permission-loss, artifact-store disk-full, LSP crash-loop, Git-cancellation,
enterprise-network-partition, and PostgreSQL-failover faults untested.

Native acceleration remains deferred. The current code-state lifecycle is
bounded and local, not a complete cross-host distributed state service. The
 prior remote CI results are bound to `d28b799` and `303f8c3`; neither is
 evidence for the next watcher fix. Candidate qualification must use the exact
 SHA and blocking workflow conclusions reported after that change is pushed.

The public GitHub PR and issue history currently exposes only dependency update
work. It does not provide traceable engineering run IDs, reviewer decisions,
downstream correctness, repair yield, or a stable N-1 bootstrap that can be
used as PN6/PN8/PN9 promotion evidence.

## 10. Gate status

| Gate | Status | Decision |
|---|---|---|
| Gate A: platform and CI correctness | Local pass; current remote matrix passed on `fe671ae` | Windows native watcher assertion is removed by reconciliation-only mode; every later candidate still requires its own blocking matrix. |
| Gate B: trust and authority | Local pass | Raw mutation and evaluator provenance boundaries are enforced. |
| Gate C: live code state | Local pass | Daemon-managed, worktree-aware, policy-authorized lifecycle is exercised. |
| Gate D: coordination scalability | Local pass | Materialized impact, projection-only heartbeat, and indexed evaluation paths are exercised. |
| Gate E: semantic integrity | Local pass | Composite receipts and explicit PARTIAL semantics are exercised. |
| Gate F: release qualification | Incomplete | Baseline ancestry is fixed, but remote candidate qualification and clean candidate admission are not complete. |

## 11. Production Next status

| Area | Status |
|---|---|
| Implementation architecture | Implemented locally; additive and opt-in |
| Local candidate qualification | Passed on Windows/Node 26 |
| PN6 observed evidence | Withheld; controlled replay only |
| PN8 observed evidence | Withheld; controlled replay only |
| PN9 stable N-1 | Determined by the stable-bootstrap verifier; harness now available |
| PN11 entry | Withheld; PN6/PN8/PN9 prerequisites are not satisfied |
| PN13 promotion | Withheld by the read-only promotion verifier |

Candidate-mode envelopes remain diagnostic and cannot grant product or enterprise
admission. The evidence verifier can confirm schema, candidate commit, and
candidate-state binding; the stable-bootstrap profile additionally requires
runtime-generated predecessor and authority proof.

## 12. Recommended next action

Do not start PN11. Run the stable-bootstrap profile on a clean candidate
checkout, collect traceable PR/CI or real work-item outcomes for PN6 and PN8,
then rerun the read-only evidence and promotion verifiers. Keep any remaining
external or platform failures explicitly classified until their logs or
independent reproductions are available.

## Final decision

`PRODUCTION_NEXT_CLOSEOUT: FAIL`

`PN11_ENTRY: WITHHELD`

Recommended PR/commit decomposition: separate watcher and daemon lifecycle;
trust/evaluation authority; code-state and impact materialization; change/store
semantics; and final documentation/evidence qualification. This closeout batch
is intentionally shipped as one user-authorized commit; the admission decision
remains withheld pending the evidence boundaries recorded above.
