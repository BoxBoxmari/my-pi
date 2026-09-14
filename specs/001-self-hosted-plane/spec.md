# Feature Specification: Self-Hosted Enforcement, Visual Plane, and Measured Evidence

**Feature Branch**: `001-self-hosted-plane`

**Created**: 2026-09-13

**Status**: Draft for implementation and qualification

**Input**: User-provided PRD, SRS, technical plan, and implementation plan for the my-pi
self-hosted Track A/B/C program.

## User Scenarios & Testing

### User Story 1 - Measure real paired engineering work (Priority: P1)

A maintainer pre-registers an engineering task with a base SHA, two arms, one primary variable,
acceptance criteria, downstream tests, contamination controls, and an independent adjudication
rule. The harness runs isolated fresh sessions and records valid or failed outcomes without
silently converting an invalid run into evidence.

**Why this priority**: Without a valid measurement boundary, self-hosted implementation work
cannot support a Production Next decision.

**Independent Test**: Submit one valid and one deliberately contaminated ObservedTask v2 pair;
the valid pair is recorded, while the contaminated pair is withheld with explicit reason codes.

**Acceptance Scenarios**:

1. **Given** a pre-registered task and clean isolated worktrees, **when** both arms finish their
   declared tests and an independent adjudicator records the result, **then** the pair is eligible
   for aggregation only if identity, schema, and contamination checks pass.
2. **Given** different bases, reused session IDs, a changed task definition, or a cross-arm
   artifact, **when** the runner validates the pair, **then** it fails closed or marks the result
   ineligible without changing the task definition.
3. **Given** fewer than the declared sample target, **when** aggregation runs, **then** the report
   remains a candidate and states that promotion is withheld.

### User Story 2 - Inspect mutation provenance and local admission (Priority: P1)

A developer uses my-pi mutations in observe mode and can inspect whether each changed path is
managed, unmanaged, stale, unknown, or exempt. A local report compares the exact Git base/head
change set with verified lineage and rejects an unprovenanced source change in strict mode.

**Why this priority**: A self-hosted authority must distinguish a verified mutation from a later
observation of bytes that were written elsewhere.

**Independent Test**: Create one file through my-pi, change a second file through a native editor,
and run the local report in report and strict modes. The first path has receipt-backed evidence;
the second path is not silently adopted and is rejected or requires review.

**Acceptance Scenarios**:

1. **Given** a verified receipt whose output fingerprint matches the current path, **when** the
   daemon reconciles code state, **then** the path is classified managed with receipt evidence.
2. **Given** external bytes with no matching receipt, **when** reconciliation runs, **then** the
   path is classified unmanaged and observe mode remains non-blocking.
3. **Given** an exact Git change set, **when** strict admission recomputes its canonical subject,
   **then** status, mode, blob identity, rename/create/delete state, and path coverage are checked;
   the provenance metadata directory is excluded only by explicit policy.
4. **Given** a missing, stale, tampered, or wrong-key attestation, **when** a verifier checks it,
   **then** admission fails closed and does not modify the workspace.

### User Story 3 - Explore bounded evidence-backed graphs (Priority: P2)

A reviewer opens a read-only graph view for code, impact, work, or lineage. The daemon returns a
bounded deterministic snapshot; the reviewer can expand a node neighborhood, inspect stable IDs and
evidence references, and see truncation or degraded-provider state without direct database access.

**Why this priority**: Reviewers need to understand routing, work, and mutation lineage from the
same authoritative state used by enforcement.

**Independent Test**: Request all four graph kinds with node, edge, depth, and attribute bounds;
repeat the request and compare normalized output. Open the loopback portal and a visuals-enabled
MCP client, then verify that unsupported hosts still initialize successfully.

**Acceptance Scenarios**:

1. **Given** the same authoritative records and bounds, **when** a graph is projected twice,
   **then** node/edge identifiers and ordering are deterministic and every rendered item has an
   evidence reference or an explicit derived provenance marker.
2. **Given** a large or cyclic graph, **when** a snapshot or expansion reaches a bound, **then**
   the response is truncated with bounded output and a continuation/degradation indication.
3. **Given** a loopback portal request with an invalid host, origin, token, or arbitrary path,
   **when** the server validates it, **then** the request is rejected and no external network
   asset is loaded.
4. **Given** a host without MCP Apps support, **when** visuals are requested, **then** the stable
   13-tool catalog remains unchanged and the client receives a safe degraded result or uses the
   portal fallback.

### User Story 4 - Verify remote admission and host maturity (Priority: P3)

A repository owner runs a report-mode GitHub admission workflow against the exact pull-request
head. The workflow validates a portable Ed25519 attestation and reports `my-pi/admission` without
changing repository rules. Host policy bundles state known enforcement gaps and are not labelled
strict-capable until seeded bypass tests justify that maturity.

**Why this priority**: Remote verification is useful only after local subject and signing semantics
are stable and their limitations are visible.

**Independent Test**: Run positive, tampered, stale-head, and uncovered-path fixtures through the
report-mode verifier and inspect the emitted result. Run direct editor, shell, script, and Git
mutation bypass tests for at least one candidate host profile.

**Acceptance Scenarios**:

1. **Given** a valid attestation for the exact PR subject and covered receipts, **when** the
   report-mode job runs, **then** it reports success without requiring local SQLite state.
2. **Given** an extra source path or changed blob after sealing, **when** the job runs, **then** it
   reports failure and does not mutate the repository.
3. **Given** a host profile with untested native mutation paths, **when** its policy bundle is
   generated, **then** the bundle declares monitoring or managed maturity and lists the gaps.

## Edge Cases

- A task definition changes after one arm starts; the run must be invalidated rather than compared
  against a moving specification.
- An arm produces no accepted result or the independent evaluator is unavailable; the record stays
  partial/failed and cannot qualify.
- A file is renamed, deleted, made executable, represented as a symlink, or has a Unicode path;
  canonical admission must preserve the intended Git identity across supported platforms.
- The same external bytes are written after a managed receipt; matching bytes alone must not create
  a new managed transition.
- A receipt is partial, stale, belongs to another worktree, or covers only some files in a batch;
  classification and admission must be path-specific.
- A graph contains cycles, dangling references, sensitive paths, oversized attributes, or a missing
  provider; the response must be bounded and explicit rather than inventing edges.
- The portal is asked to bind to a non-loopback address or load a third-party asset; the request or
  configuration must be rejected.
- A default MCP client starts with visuals disabled; its tool names and schemas must remain exactly
  the stable 13-tool surface.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST validate ObservedTask v2 definitions before a run, including immutable
  identity, base SHA, arm definitions, one primary variable, tests, metrics, and adjudication rules.
- **FR-002**: The paired harness MUST use isolated worktrees and fresh run/session identities and
  MUST detect cross-arm contamination, task drift, and unregistered commands.
- **FR-003**: The aggregator MUST read only validated v2 results, retain invalidity reasons, enforce
  the predeclared sample target, and keep candidate evidence separate from promotion authority.
- **FR-004**: Observe mode MUST record mutation provenance without blocking and MUST distinguish
  managed, unmanaged, stale_lineage, unknown, and exempt classifications.
- **FR-005**: Provenance reconciliation MUST verify project, worktree, path, receipt integrity,
  and output fingerprint; it MUST NOT silently adopt externally written bytes.
- **FR-006**: Local admission MUST recompute a canonical Git subject over exact changed paths,
  statuses, modes, blob identities, repository identity, and base/head commits.
- **FR-007**: Strict admission MUST fail closed for unprovenanced source paths, stale evidence,
  missing coverage, invalid attestations, and subject changes; report mode MUST remain read-only.
- **FR-008**: The signing authority MUST use Ed25519, keep private keys outside the workspace, and
  let an offline verifier validate the subject and covered receipt digests.
- **FR-009**: The GitHub workflow MUST run in report mode with repository read access, validate the
  exact PR head, and expose a named `my-pi/admission` result without activating branch rules.
- **FR-010**: The graph model MUST represent code, impact, work, and lineage with stable IDs,
  evidence references, reason/confidence metadata, truncation, and explicit bounds.
- **FR-011**: Graph projections MUST be deterministic, sensitive-path safe, cycle-tolerant, and
  independent of MCP and browser implementation details.
- **FR-012**: The daemon and coordination client MUST expose bounded graph/provenance reads with
  authorization, output/frame limits, bounded retries, and cancellation where applicable.
- **FR-013**: The local portal MUST be read-only, loopback-only by default, token-protected, origin
  checked, CSP-constrained, and backed by the daemon/client rather than direct database access.
- **FR-014**: A visuals-enabled MCP path MAY expose MCP Apps resources, but unsupported hosts MUST
  degrade without changing default initialization or the stable 13-tool catalog.
- **FR-015**: Host policy bundles MUST declare maturity, allowed controls, known unenforced paths,
  and explicit exceptions; strict-capable labels require empirical bypass evidence.
- **FR-016**: The implementation MUST preserve the existing MCP compatibility tests and MUST NOT
  add an unrestricted generic execution tool.
- **FR-017**: Evidence and completion artifacts MUST bind to the measured candidate state; stale
  hashes, attestations, or reports MUST be rejected or marked withheld.
- **FR-018**: PN11 MUST remain untouched unless the existing promotion verifier reports
  `promotionEligible: true`.

### Key Entities

- **ObservedTask v2**: Immutable pre-registration containing hypothesis, base, arms, controls,
  tests, metrics, adjudication, and contamination policy.
- **ObservedResult v2**: One arm's bounded execution record with run identity, environment,
  outcome, evidence references, and eligibility status.
- **MutationObservation**: A path-level fingerprint transition and its managed/unmanaged/stale/
  unknown/exempt classification.
- **AdmissionSubject**: Canonical digest of repository identity, base/head, and exact Git change
  entries excluding only declared provenance metadata.
- **AdmissionAttestation**: Signed portable subject and covered receipt digest set.
- **GraphSnapshot**: Bounded deterministic nodes/edges for one graph kind, with evidence and
  truncation/degradation metadata.
- **PolicyBundle**: Host-specific experimental rules, maturity, controls, gaps, and exceptions.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Default my-pi MCP startup exposes exactly 13 tools and preserves their schemas when
  visuals are disabled.
- **SC-002**: The v2 validator and paired runner reject the seeded invalid designs and contamination
  fixtures without producing promotion-eligible records.
- **SC-003**: Provenance and admission tests cover managed, unmanaged, stale, unknown, exempt,
  create/modify/delete/rename, mode, symlink, tamper, and wrong-key cases.
- **SC-004**: Repeated graph projections from the same input are byte-stable after normalization,
  respect configured node/edge/attribute bounds, and contain no sensitive paths.
- **SC-005**: Portal security tests reject non-loopback binding, invalid origin/host/token, and
  arbitrary path/database parameters; static assets contain no third-party network dependency.
- **SC-006**: At least one report-mode GitHub admission fixture set distinguishes valid, stale,
  tampered, and uncovered-path subjects without modifying repository state.
- **SC-007**: The evidence aggregate reports `promotionEligible: false` until every predeclared
  PN6/PN8 sample and adjudication gate is actually satisfied.
- **SC-008**: Final acceptance is reported only after x-harness emits `admission.outcome: success`
  and `acceptance_status: accepted`; otherwise the work is withheld or blocked with next action.

## Assumptions

- The baseline repository is my-pi at commit `835232d0b6b205027c4d35ac6203b31dd3ba76d3`.
- The stable 13-tool MCP surface remains the compatibility contract for default hosts.
- The user supplies or authorizes real engineering tasks and independent adjudicators for PN6/PN8;
  fixture-only implementation tests cannot satisfy those evidence gates.
- Local Node/TypeScript tooling, the my-pi MCP server, CodeGraph, AGT, and x-harness are available
  in the working environment.
- GitHub report-mode activation and repository ruleset changes require explicit operational
  authorization and are out of scope for local implementation unless requested.
- The current Windows run can verify Windows semantics; POSIX-specific claims remain unverified
  until a supported POSIX environment supplies evidence.

## Out of Scope

- Hosted SaaS control planes, SSO, messaging, voice, autonomous agent spawning, and unrestricted
  shell execution.
- Editing source code from the visual plane.
- Changing the core MCP protocol era as part of this increment.
- Activating repository rules that require `my-pi/admission` before report-mode and bypass evidence
  are independently qualified.
