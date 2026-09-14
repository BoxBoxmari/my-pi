# Software Requirements Specification — my-pi Self-Hosted Enforcement, Visual Plane, and Experiment Harness

**Version:** 0.1  
**Date:** 2026-09-13  
**Status:** Proposed  
**Baseline repository:** `BoxBoxmari/my-pi@835232d0b6b205027c4d35ac6203b31dd3ba76d3`

---

## 1. Purpose

This SRS specifies software requirements for:

- Track A: ObservedTask v2 experimental harness;
- Track B: mutation provenance and admission enforcement;
- Track C: evidence-backed graph projection and visualization.

It is additive to the current stable 13-tool MCP capability surface and current experimental Production Next layers.

---

## 2. System context

```text
+----------------------+      MCP       +---------------------+
| Coding host / agent  | <------------> | my-pi-mcp           |
+----------------------+                +----------+----------+
                                                   |
                                           CoordinationClient
                                                   |
                                                   v
                                        +----------+----------+
                                        | my-pi-daemon        |
                                        +---+---------+-------+
                                            |         |
                                  SQLite projections  | code-state
                                            |         |
                                            +----+----+
                                                 |
                             +-------------------+--------------------+
                             |                                        |
                             v                                        v
                     provenance/admission                        graph projection
                             |                                        |
                             v                                        v
                    signed attestation                     MCP Apps / local portal
                             |
                             v
                    GitHub admission check

Dogfood harness orchestrates isolated worktrees/sessions around the same runtime.
```

---

## 3. Compatibility constraints

### CR-001 Stable tool catalog

In default mode, `tools/list` SHALL remain identical to the current 13-tool name/schema catalog.

### CR-002 Feature gating

Coordination, evaluation, visuals, and strict policy features SHALL remain opt-in until separately promoted.

### CR-003 Core MCP era

This program SHALL NOT require migration to a newer core MCP protocol era. MCP Apps integration SHALL be compatibility-spiked against the currently pinned SDK line before implementation is admitted.

### CR-004 Host neutrality

Core domain packages SHALL NOT depend on Claude Code, OpenCode, Cursor, GitHub Copilot, or any host SDK/config dialect.

---

## 4. Functional requirements — Track A experimental harness

### FR-A001 ObservedTask v2 schema

The system SHALL define a versioned schema for pre-registered engineering experiments.

Required fields SHALL include:

- `schemaVersion`;
- `taskId`;
- `taskClass`;
- `hypothesis` (`PN6`, `PN8`, `none`);
- `baseSha`;
- `taskDefinitionCommit`;
- `acceptanceSpec`;
- `controlProfile`;
- `treatmentProfile`;
- `requiredTests`;
- `metrics`;
- `adjudication`;
- contamination-control metadata.

### FR-A002 Task immutability

A result SHALL record the exact committed task-definition SHA. A promotion-eligible result SHALL be rejected if the task definition was created/modified after the primary run began.

### FR-A003 Isolated worktrees

The paired runner SHALL create or verify distinct control and treatment worktrees from the same base SHA.

### FR-A004 Fresh sessions

Each primary arm SHALL use a distinct agent session identifier. The runner SHALL record host, model identifier when available, run ID, worktree ID, start/end timestamps, and candidate commit.

### FR-A005 No cross-arm artifact leakage

The harness SHALL NOT place the opposite arm's generated files, result files, conversation transcripts, or repair artifacts in a worktree before that arm completes.

### FR-A006 Stable authority

Where a Production Next gate requires stable-N-1 proof, the runner SHALL record a distinct bootstrap SHA and SHALL verify that candidate daemon authority was not substituted for the stable predecessor.

### FR-A007 PN6 arm control

The PN6 primary pair SHALL keep mutation policy, host family, task, base SHA, acceptance criteria, and evaluation procedure equal. Impact-aware routing SHALL be the primary differing variable.

### FR-A008 PN6 metrics

The result SHALL support:

- relevant dependency ground truth;
- routed dependency set;
- true positives;
- false positives;
- false negatives;
- precision;
- recall;
- repair iteration count;
- downstream rework count;
- regression count.

### FR-A009 PN8 frozen failing state

A PN8 pair SHALL begin both repair arms from the same content-equivalent failing state and acceptance/evaluation spec.

### FR-A010 PN8 metrics

The result SHALL support:

- repair attempted;
- repair accepted;
- repair yield;
- attempts to acceptance;
- prior passes before repair;
- prior passes preserved;
- new regressions;
- false accepts;
- inconclusive outcomes.

### FR-A011 Independent adjudication

Metrics that determine acceptance SHALL derive from independent tests/evaluator/reviewer records, not agent self-report.

### FR-A012 Evidence aggregator

A separate aggregation tool SHALL read eligible ObservedTask v2 results and emit candidate PN6/PN8 evidence envelopes.

### FR-A013 Verifier independence

The aggregator SHALL NOT modify the promotion verifier or suppress failing criteria. `verify-production-next-promotion.mjs` remains read-only and authoritative.

---

## 5. Functional requirements — Track B enforcement

### FR-B001 Mutation observation

The daemon SHALL be able to observe code-state fingerprint transitions and classify them against verified my-pi change receipts.

### FR-B002 Classification values

Classification SHALL be one of:

- `managed`;
- `unmanaged`;
- `stale_lineage`;
- `unknown`;
- `exempt`.

### FR-B003 Managed classification

A source path SHALL be `managed` only if its authoritative observed fingerprint matches a verified receipt output and the receipt is bound to the correct project/worktree lineage.

### FR-B004 No silent retroactive adoption

Observing current bytes after an external mutation SHALL NOT create managed lineage. Any explicit adoption/review feature SHALL emit a different provenance class/event and SHALL be policy-visible.

### FR-B005 Provenance query

The daemon SHALL expose a bounded read operation returning classification, relevant receipt/proposal IDs, input/output fingerprints, timestamps, and reason codes for a path/change set.

### FR-B006 Local admission subject

A local admission verifier SHALL compute a canonical change-set subject from Git base/head state and compare every in-scope changed path with provenance state.

### FR-B007 Admission outcomes

Path-level and overall outcomes SHALL support `allowed`, `rejected`, and `review_required`.

### FR-B008 Exemption policy

Generated/evidence paths MAY be exempt only through explicit configuration. Source paths SHALL NOT be exempt by broad wildcard default.

### FR-B009 Portable subject digest

The remote admission subject SHALL be deterministic across supported platforms. The canonical representation SHALL specify:

- repository identity;
- base commit;
- normalized path;
- Git status;
- file mode;
- resulting blob OID or absent marker;
- deterministic ordering;
- excluded provenance directory.

### FR-B010 Admission attestation

A local authority SHALL be able to produce an attestation containing subject digest, covered receipt digests/path mappings, authority key ID, issue time, and signature.

### FR-B011 Signing algorithm

V1 signed admission SHALL use Ed25519 unless a security spike demonstrates a better standard already available in the runtime without expanding trust assumptions.

### FR-B012 Key placement

Private signing material SHALL be stored outside authorized workspace roots. my-pi filesystem tools SHALL NOT expose it.

### FR-B013 CI verification

CI SHALL recompute the change-set subject from Git objects and SHALL reject missing, invalid, stale, mismatched, or incomplete attestations.

### FR-B014 Source coverage

Strict admission SHALL fail if any in-scope source change is not covered by verified lineage or an explicit review-required exception.

### FR-B015 GitHub status

The workflow SHALL publish a deterministic `my-pi/admission` job/check outcome for the current PR head.

### FR-B016 Ruleset activation

Repository-level required-check enforcement SHALL remain disabled until report-mode validation and seeded bypass tests pass. After activation, the ruleset SHALL require PRs and the admission status for the default branch.

### FR-B017 Host policy bundles

Host policy generation SHALL be additive to existing MCP config generation and SHALL NOT break existing profile IDs.

### FR-B018 Enforcement maturity

Each policy profile SHALL declare one maturity:

- `strict-capable`;
- `managed`;
- `monitoring`.

### FR-B019 Strict certification

A host profile SHALL NOT be labeled strict-certified until automated seeded bypass tests demonstrate that direct source mutation cannot produce a merge-admissible change.

### FR-B020 Build/test usability

Strict mutation policy SHALL preserve a non-arbitrary way to run required verification, either via harness/evaluator execution or narrowly allowed host commands. The program SHALL NOT introduce unrestricted shell to the stable MCP surface.

---

## 6. Functional requirements — Track C Visual Plane

### FR-C001 Graph kinds

The graph system SHALL support `code`, `impact`, `work`, and `lineage` graph kinds in V1. `experiment` graph is optional after the core four are stable.

### FR-C002 Graph evidence

Every node and edge SHALL expose at least one source/evidence reference or an explicit deterministic derivation reference.

### FR-C003 No LLM graph inference

Graph edges SHALL NOT be created solely from model-generated natural-language assertions.

### FR-C004 Code graph mapping

Code graph SHALL map existing `CodeEntity` and `CodeEdge` contracts without redefining their semantics.

### FR-C005 Impact graph mapping

Impact graph SHALL preserve `ImpactResult.graphVersion`, truncation, affected entities/work items/agents, reason codes, confidence, and reason paths where available.

### FR-C006 Work graph mapping

Work graph SHALL represent work items, intents, work dependencies, assignments, and agent sessions.

### FR-C007 Lineage graph mapping

Lineage graph SHALL represent available Intent, ChangeProposal, ChangeReceipt, EvaluationRun, FeedbackPacket, RetryCycle, and AcceptanceDecision relationships.

### FR-C008 Determinism

For identical authoritative inputs and bounds, graph projection SHALL produce canonical node/edge identifiers and equivalent semantic output independent of iteration order.

### FR-C009 Bounds

Every graph request SHALL enforce maximum node, edge, byte, and traversal-depth limits.

### FR-C010 Truncation

A truncated result SHALL set `truncated=true` and SHALL expose enough cursor/reason data for safe bounded continuation.

### FR-C011 Sensitive path policy

Graph generation SHALL NOT bypass workspace containment or sensitive-path policy. A path denied before model allocation SHALL not become visible through graph metadata.

### FR-C012 Daemon read API

The daemon SHALL provide bounded read-only operations for graph snapshot and bounded expansion. Direct browser access to SQLite SHALL NOT exist.

### FR-C013 Shared view artifact

MCP Apps and local portal SHALL use the same browser view implementation and graph contracts.

### FR-C014 MCP Apps feature gate

MCP Apps resources/tools SHALL only register when visual mode is explicitly enabled and extension compatibility is satisfied.

### FR-C015 Progressive degradation

When the host does not support MCP Apps, my-pi SHALL preserve usable non-UI tool behavior and SHALL NOT fail baseline initialization.

### FR-C016 App-only UI operations

Where MCP Apps supports app-only tool visibility, UI-specific expansion/filter operations SHOULD be hidden from model tool selection.

### FR-C017 Local portal binding

The local portal SHALL bind only to loopback interfaces.

### FR-C018 Local portal session authorization

The portal SHALL use a random per-launch token or equivalent local session secret and SHALL reject invalid Host/Origin/session combinations.

### FR-C019 CSP

The portal/MCP App HTML SHALL use a restrictive Content Security Policy compatible with the selected renderer and SHALL not require external CDN scripts.

### FR-C020 V1 read-only

The Visual Plane SHALL NOT perform source mutation in V1.

### FR-C021 Required interactions

The view SHALL support pan, zoom, type filtering, selection, evidence inspection, bounded expansion, path trace, graph-kind switch, degraded/truncation indication, and stable ID copy.

---

## 7. Data model requirements

### DR-001 Graph scalar safety

Graph attributes SHALL be limited to bounded scalar values or explicitly typed small structures. Arbitrary recursive domain objects SHALL NOT be dumped into UI payloads.

### DR-002 Graph IDs

Graph node/edge IDs SHALL be stable within their authoritative identity domain and SHALL not contain absolute host paths where stable branded IDs exist.

### DR-003 Provenance retention

Mutation provenance records SHALL retain enough information to explain an admission result after the working file has changed again.

### DR-004 Secret minimization

Admission attestations SHALL contain hashes/IDs/path metadata required for verification, not source contents.

### DR-005 Evidence versioning

ObservedTask, admission attestation, graph snapshot, and evidence envelope schemas SHALL each have explicit schema versions.

---

## 8. Interface requirements

### IR-001 Existing CLI

Existing `my-pi-mcp` CLI behavior SHALL remain backward compatible.

### IR-002 Visual flag

An explicit flag such as `--visuals` MAY enable MCP Apps/graph resources. Exact CLI naming is implementation-level but must remain opt-in.

### IR-003 Portal CLI

A separate `my-pi-ui` executable or subcommand SHALL start the read-only local portal without requiring public network exposure.

### IR-004 Host config

Existing `host-config` output remains supported. Experimental strict/managed policy bundle generation SHALL use new profile IDs or a new explicit policy-bundle command, not silently change legacy output.

### IR-005 Daemon IPC

New graph/provenance reads SHALL use the existing local IPC authority boundary and bounded request/response framing.

### IR-006 GitHub workflow

Admission verification SHALL run with read-only repository content permissions unless publishing a status/check requires a narrowly scoped additional permission.

---

## 9. Security requirements

### SR-001 No raw mutation IPC expansion

Track B SHALL not re-enable raw arbitrary event or code-state mutation paths in normal daemon mode.

### SR-002 Receipt verification

Admission SHALL only trust receipts/provenance that pass existing project/worktree/fingerprint integrity checks.

### SR-003 Key isolation

Private admission keys SHALL never be stored under the project worktree or returned in logs/graph/API responses.

### SR-004 Fail closed

Strict admission SHALL fail closed on unknown source provenance, malformed attestation, signature failure, subject mismatch, or evidence truncation that prevents complete coverage determination.

### SR-005 UI injection safety

Graph labels/metadata SHALL be rendered as text, not unsanitized HTML. No source-derived string may be interpolated into executable script.

### SR-006 Browser boundary

Local portal requests SHALL be protected against cross-origin drive-by access and DNS-rebinding-style Host confusion through loopback binding, Host/Origin validation, and session secret checks.

### SR-007 No external CDN

The Visual Plane SHALL bundle runtime assets locally.

### SR-008 Sensitive path inheritance

Graph projection SHALL inherit the same sensitive-path restrictions as code-state/indexing and SHALL include regression tests for `.env`, `.ssh`, keys, and out-of-worktree links.

---

## 10. Performance requirements

The following are candidate engineering SLOs subject to benchmark confirmation.

### PR-001 Graph snapshot

For a 2,000-node/5,000-edge bounded profile, local graph snapshot generation SHOULD achieve p95 <= 250 ms.

### PR-002 Graph payload

Default snapshot payload SHALL be limited to 2 MiB unless explicitly configured otherwise within a safe upper bound.

### PR-003 Expansion

Bounded one/two-hop expansion SHOULD achieve p95 <= 100 ms on persisted local state for the benchmark profile.

### PR-004 UI render

The browser view SHOULD display a useful first graph within 1 second after receiving a 2,000/5,000 snapshot on the benchmark machine profile.

### PR-005 Admission

Local/CI admission verification SHOULD complete within 2 seconds for <=500 changed paths excluding dependency installation time.

---

## 11. Reliability requirements

### RR-001 Degraded code providers

Graph APIs SHALL preserve existing non-fatal degradation semantics when AST/LSP providers are unavailable.

### RR-002 Deterministic replay

ObservedTask result aggregation and graph projection SHALL be deterministic for frozen input records.

### RR-003 Cancellation

Long-running graph traversal/admission operations SHALL support cancellation where integrated into existing request contexts.

### RR-004 Partial data

UI SHALL distinguish `complete`, `truncated`, and `degraded` states. It SHALL not display partial graph data as complete.

---

## 12. Observability requirements

### OR-001 Metrics

Record bounded timing and counts for:

- graph snapshot/expand calls;
- graph nodes/edges/bytes;
- provenance classifications;
- admission paths/outcomes;
- experiment arm durations and repair iterations.

### OR-002 No secret logs

Logs SHALL record IDs/digests/reason codes rather than source contents or private keys.

### OR-003 Admission explainability

Every rejection SHALL provide stable reason codes and affected paths sufficient for remediation.

---

## 13. Test requirements

### TR-001 Legacy compatibility

Existing 13-tool catalog/schema test SHALL continue to pass unchanged in default mode.

### TR-002 Graph unit tests

Projection tests SHALL cover canonical ordering, duplicate handling, cycles, missing references, truncation, bounds, confidence/reason preservation, and sensitive-path exclusion.

### TR-003 Graph integration

Daemon -> client -> UI graph snapshot integration SHALL be tested without direct store access.

### TR-004 MCP Apps compatibility

Use the official MCP Apps basic-host or equivalent conformance path plus at least one supported real host before claiming support.

### TR-005 Portal security

Tests SHALL reject non-loopback bind configuration, invalid Host, invalid Origin, missing/invalid session token, and attempts to request arbitrary filesystem/database paths.

### TR-006 Provenance tests

Cover managed my-pi write, unmanaged editor write, stale receipt, partial composite receipt, deletion, creation, rename representation, mode change, symlink/path-policy cases, and generated-path exemption.

### TR-007 Admission signature tests

Cover valid signature, wrong key, modified path, modified blob, changed base, missing receipt coverage, extra changed path, stale attestation, malformed schema, and excluded provenance artifact handling.

### TR-008 Host bypass tests

For each strict candidate profile, seed attempts through native edit, shell redirection, scripted writes, alternate MCP filesystem server (where configurable), and direct Git patch/application paths. Result must be blocked or fail admission.

### TR-009 Experimental integrity tests

Validate same-base worktrees, session isolation, task-definition timing, arm-variable parity, no cross-arm result leakage, and independent adjudication presence.

### TR-010 Promotion regression

Existing PN6/PN8/PN9/PN12 and promotion verifier tests SHALL remain unchanged unless a separately justified contract migration is approved.

---

## 14. Traceability matrix

| Product goal | Primary SRS requirements |
|---|---|
| Self-hosted evidence | FR-A001–A013, TR-009 |
| Mutation provenance | FR-B001–B008, DR-003, TR-006 |
| Remote admission | FR-B009–B016, SR-003/004, TR-007 |
| Host enforcement | FR-B017–B020, TR-008 |
| Code/impact/work/lineage visualization | FR-C001–C012, TR-002/003 |
| MCP Apps + portal | FR-C013–C021, SR-005–008, TR-004/005 |
| Stable legacy behavior | CR-001–004, TR-001 |
| Production Next admission evidence | FR-A007–A013, TR-010 |

---

## 15. Acceptance boundary

Implementation is not considered complete merely because all new tests pass. The following claims have separate acceptance boundaries:

- **Feature implemented:** code/tests/CI pass.
- **Host strict-certified:** seeded bypass suite passes for that exact host/profile.
- **Remote admission enforceable:** signed attestation is independently verified and GitHub ruleset is active.
- **PN6 accepted:** existing promotion verifier accepts observed routing evidence.
- **PN8 accepted:** existing promotion verifier accepts observed feedback evidence.
- **PN11 entry:** only when the existing promotion verifier returns promotion eligibility.
