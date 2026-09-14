# Tasks: Self-Hosted Enforcement, Visual Plane, and Measured Evidence

**Input**: Design documents from `specs/001-self-hosted-plane/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, and
`quickstart.md`.

**Status convention**: `[X]` means the current worktree contains the implementation and focused
evidence for that task. `[ ]` means work or external evidence remains. A checked implementation
task does not imply x-harness admission or Production Next promotion.

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Initialize Spec Kit project structure and Codex integration in `.specify/` and `.agents/skills/`.
- [X] T002 Record project governance in `.specify/memory/constitution.md`.
- [X] T003 [P] Create feature specification and design artifacts in `specs/001-self-hosted-plane/`.
- [X] T004 [P] Add baseline ADR and plan references in `docs/adr/ADR-008-self-hosted-enforcement-visuals.md`.

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T005 [P] Add ObservedTask v2 schemas in `dogfood/schema/observed-task-v2.schema.json` and `dogfood/schema/observed-result-v2.schema.json`.
- [X] T006 [P] Add v2 validator and fail-closed paired runner in `scripts/validate-observed-task-v2.mjs` and `scripts/dogfood-observed-paired-v2.mjs`.
- [X] T007 [P] Add aggregate and verification scripts in `scripts/aggregate-observed-evidence-v2.mjs` and `scripts/verify-observed-evidence-v2.mjs`.
- [X] T008 [P] Add release contract tests for v2 schema, contamination, aggregation, and verification in `test/release/`.
- [X] T009 Verify the default MCP compatibility surface through `apps/my-pi-mcp/test/main.test.ts` and the official my-pi MCP client probe.

**Checkpoint**: The foundation rejects legacy v1 evidence and post-hoc task rebinding; candidate 0c4e11f includes 22 visible pair files, with three live PN6 source-repair pairs and three live PN8 repair pairs qualifying. The aggregate remains WITHHELD because legacy pairs still fail identity validation and the candidate aggregate is not an admission authority.

## Phase 3: User Story 1 - Measure Real Paired Work (Priority: P1)

**Goal**: Produce promotion-eligible PN6/PN8 observations only from pre-registered, isolated,
independently adjudicated real engineering work.

**Independent Test**: Run seeded valid and contaminated v2 fixtures, then run real task pairs on a
clean candidate and confirm only valid pairs enter the aggregate.

- [X] T010 [US1] Validate paired arm identity, base, task immutability, command allowlist, and contamination in `scripts/validate-observed-task-v2.mjs`.
- [X] T011 [US1] Enforce fresh worktree/session manifests and preserve partial failures in `scripts/dogfood-observed-paired-v2.mjs`.
- [X] T012 [US1] Keep insufficient sample and failed adjudication visible as withheld in `scripts/aggregate-observed-evidence-v2.mjs`.
- [X] T013 [US1] Pre-register three independent PN6 tasks before their runs with committed immutable receipts: OT-034, OT-035, and OT-036. Each receipt verifies against registration commit e7b7a83 and each task uses the shared-source-change measured-repair evaluator.
- [X] T014 [US1] Execute the registered PN6 pairs OT-034, OT-035, and OT-036 through stable my-pi isolated control/treatment worktrees. All three were accepted; control required one official my-pi source repair iteration, treatment required zero, and downstream checks passed in both arms. Legacy OT-011, OT-012, and OT-013 remain non-qualified because their identity receipts are not valid.
- [X] T015 [US1] Freeze preregistered failing states and execute PN8 ordinary-log versus structured-feedback live_repair pairs with independent adjudication; OT-031, OT-032, and OT-033 each passed live measurement with accepted=true, priorPassesPreserved=true, regressions=0, and falseAccepts=0. OT-021, OT-022, and OT-023 remain controlled-replay diagnostics and are not qualified product-value evidence.
- [X] T016 [US1] Rerun the v2 aggregate and verifier against candidate 0c4e11f; aggregate sha256:df975083ea6407ec3262d689a51218dd0ae1383d49b9dbf1195a981d08bb2656 is structurally valid, 22 pairs are visible, 6 qualify, PN6 is 3/3 and heterogeneous, PN8 is 3/3 and heterogeneous, and admission remains WITHHELD with promotionEligible false after Git timestamp binding, measured PN8 failure/repair fields, and exact catalog compatibility hardening.
- [X] T046 [US1] Require divergent preregistered arm setup commands for PN6/PN8, execute them before common downstream tests, record command phase, and reject result argv drift in `dogfood/schema/`, `scripts/validate-observed-task-v2.mjs`, and `scripts/dogfood-observed-paired-v2.mjs`; focused release evidence is 10/10 Observed-v2 tests and `pnpm test:fast` 33/33.

## Phase 4: User Story 2 - Inspect Provenance and Local Admission (Priority: P1)

**Goal**: Classify source mutation lineage and report or reject unprovenanced changes without
silently adopting them.

**Independent Test**: Compare my-pi-created, native-editor, stale-receipt, and explicitly exempt
paths in observe and strict/report modes.

- [X] T017 [P] [US2] Implement path-level reconciliation and classifications in `packages/code-state/src/provenance.ts`.
- [X] T018 [P] [US2] Integrate observe-mode provenance audit events in `apps/my-pi-daemon/src/code-state-manager.ts` and `apps/my-pi-daemon/src/main.ts`.
- [X] T019 [P] [US2] Add bounded provenance reads and cancellation-aware client calls in `packages/coordination-client/src/client.ts`.
- [X] T020 [US2] Implement canonical Git admission subjects in `packages/change-runtime/src/admission-subject.ts` and `scripts/admission-git.mjs`.
- [X] T021 [US2] Implement Ed25519 attestation and local report decisions in `packages/change-runtime/src/attestation.ts`, `packages/change-runtime/src/local-admission.ts`, and `scripts/verify-my-pi-admission.mjs`.
- [X] T022 [US2] Add security and tamper tests in `packages/change-runtime/test/admission-subject.test.ts` and `packages/code-state/test/provenance.test.ts`.
- [X] T023 [US2] Seal a clean authorized candidate with `scripts/seal-my-pi-admission.mjs`, keep private keys outside the workspace, and verify a positive report-mode admission. The final official my-pi Track B measurement records a valid managed candidate as `allowed`, with a valid Ed25519 attestation and no seal coverage rejection.
- [X] T024 [US2] Run seeded direct-editor, shell, script, Git, stale-head, extra-path, wrong-key, and tampered-attestation bypass evidence on at least one host. Evidence: `evidence/track-b-host-bypass-2026-09-13.json`, written and read back through official my-pi; all 11 vectors produced the expected report decisions, while strict host certification remains withheld.

## Phase 5: User Story 3 - Explore Bounded Evidence Graphs (Priority: P2)

**Goal**: Expose deterministic, bounded code/impact/work/lineage snapshots and trace paths through
the daemon, portal, and optional MCP Apps view.

**Independent Test**: Request snapshots, bounded expansion, and bounded trace for the same graph
fixture twice and compare normalized output; reject invalid portal requests.

- [X] T025 [P] [US3] Define bounded graph contracts and deterministic normalization in `packages/graph-model/src/model.ts` and `packages/graph-model/test/model.test.ts`.
- [X] T026 [P] [US3] Project code, impact, work, and lineage records in `packages/graph-projection/src/projections.ts` and `packages/graph-projection/test/projections.test.ts`.
- [X] T027 [US3] Expose bounded `graph_snapshot` and `graph_expand` IPC through `apps/my-pi-daemon/src/main.ts` and `packages/coordination-client/src/client.ts`.
- [X] T028 [US3] Add deterministic bounded `graph_trace` through `packages/graph-model/src/model.ts`, `apps/my-pi-daemon/src/main.ts`, and `packages/coordination-client/src/client.ts`.
- [X] T029 [US3] Add loopback/token/origin/CSP portal and trace route in `apps/my-pi-ui/src/server.ts` and `apps/my-pi-ui/test/portal.test.ts`.
- [X] T030 [US3] Implement shared read-only graph view with bounded expansion and trace selection in `apps/my-pi-ui/src/view.ts`.
- [X] T031 [US3] Add MCP Apps opt-in/degraded compatibility seam in `packages/mcp-adapter/src/stdio.ts`, `apps/my-pi-mcp/src/main.ts`, and `apps/my-pi-mcp/test/main.test.ts`.
- [ ] T032 [US3] Run the official MCP Apps basic-host/conformance route and one supported real-host probe; record compatibility evidence without changing the core protocol era. Current evidence: `@modelcontextprotocol/ext-apps` 2.0.0 registers opt-in `ui://my-pi/graph` with official MIME `text/html;profile=mcp-app`; the in-memory MCP Client/Transport contract passes and the unsupported stdio path preserves 13 tools while advertising 0 resources. The package documents `examples/basic-host` as a reference example, not a supported host implementation, and no live supported real-host plus coordination-daemon probe is available locally; qualification remains withheld in `evidence/track-c-mcp-apps-2026-09-13.json` (sha256:e166a95a407acbb13cd830438101aa0373d161ee4360dfffedf030a3ba407cad).
- [X] T033 [US3] Add 500/1,000/2,000-node graph fixtures and record render/response bounds in `apps/my-pi-ui/test/` and `docs/`. The current Windows run measured a largest render-ready HTML payload of 1,321,606 bytes, a largest portal response of 1,310,847 bytes, and all three responses returned HTTP 200 with `truncated: false`; see `docs/graph-scale-benchmark.md`.
- [X] T047 [US3] Define `TheaterFrame`, `SceneCue`, `QualityState`, allowlisted pure projector `eventToMotionCue`, and frame validator in `packages/graph-model/src/model.ts`.
- [X] T048 [US3] Add `graph_events` IPC query and client methods in `apps/my-pi-daemon/src/main.ts`, `packages/coordination-client/src/client.ts`, and `packages/coordination-store/src/sqlite-store.ts`.
- [X] T049 [US3] Implement isometric Three.js 3D renderer, 2D SVG fallback, replay timeline, 4 fixed status badges, and 6-section inspector in `apps/my-pi-ui/src/theater-client.ts`.
- [X] T050 [US3] Expose opt-in `view=theater3d`, `/api/graph/events`, and `/api/graph/replay` in `apps/my-pi-ui/src/server.ts` and `apps/my-pi-ui/src/view.ts`.
- [X] T051 [US3] Register opt-in `ui://my-pi/theater` resource in `packages/mcp-adapter/src/stdio.ts` while maintaining the exact 13-tool catalog invariant.
- [X] T052 [US3] Add comprehensive unit and integration tests across `packages/graph-model`, `apps/my-pi-ui`, and `packages/mcp-adapter`, with verified build bundling via `scripts/bundle-app.mjs`.

## Phase 6: User Story 4 - Verify Remote Admission and Host Maturity (Priority: P3)

**Goal**: Report exact PR admission state and avoid overstating host enforcement maturity.

**Independent Test**: Exercise positive, stale, tampered, wrong-key, and uncovered-path report-mode
fixtures and inspect the named workflow result.

- [X] T034 [P] [US4] Add report-mode workflow in `.github/workflows/my-pi-admission.yml`.
- [X] T035 [P] [US4] Add host policy bundle generation and maturity declarations in `packages/host-profiles/src/policy-bundle.ts` and `packages/host-profiles/test/policy-bundle.test.ts`.
- [X] T036 [US4] Keep the workflow and policy implementation report-only/managed unless empirical bypass evidence justifies strict maturity.
- [ ] T037 [US4] Execute report-mode positive and negative PR/branch fixtures against the exact candidate head and preserve the outputs.
- [ ] T038 [US4] Complete one host strict-candidate bypass suite and record residual native mutation paths before using a strict-capable label.
- [ ] T039 [US4] Activate repository admission rules only after report-mode, strict-profile, and merge-block evidence is independently approved.

## Phase 7: Polish, Evidence, and Admission

- [X] T040 [P] Run the current Track A/B/C tests, pnpm build, pnpm typecheck, release tests, and a reliable full verification profile. The current full suite reports 257 tests, 256 pass, 1 Windows platform skip, and 0 failures; Theater/graph/MCP Apps checks pass, while strict-host and supported-real-host qualification remain withheld.
- [ ] T041 [P] Run CodeGraph sync/status, AGT integrity/policy checks, Spec Kit prerequisite checks, and official my-pi runtime probes. Current evidence: CodeGraph, Spec Kit, `agt --json verify`, xh doctor, and my-pi probes pass; the current `agt lint-policy` rejects the legacy `.agt/policy.json` shape and the integrity command has no workspace-root option.
- [X] T042 Record the current candidate aggregate and x-harness state as WITHHELD/BLOCKED in `.x-harness/self-hosted-track-a-completion-card.yaml`.
- [ ] T043 Regenerate candidate-bound evidence, attestation, SBOM/release artifacts, and the completion card after the final authorized code commit.
- [ ] T044 Run read-only `xh verify` at deep tier on the final candidate and accept only `admission.outcome: success` plus `acceptance_status: accepted`.
- [ ] T045 Run the unchanged Production Next promotion verifier; keep PN11 closed unless it reports `promotionEligible: true`.

## Dependencies and Execution Order

- Setup and Foundational (T001-T009) precede all user stories.
- T013-T016 require immutable Git registration, independent adjudication, and a clean authorized candidate; current records cannot be retroactively rebound; they cannot be
  replaced by unit fixtures or by the current dirty worktree.
- T023-T024 require canonical candidate identity and a signer outside the workspace.
- T032-T039 require runtime/host access beyond the current local Windows probe and do not change
  the default MCP surface.
- T043-T045 must run last because candidate-bound hashes and attestations become stale after edits.

## Parallel Opportunities

- T005-T008 can run in parallel because they touch separate schemas/scripts/tests.
- T017-T022 and T025-T031 can run in parallel after the foundational gate, subject to shared
  package build ordering.
- T034-T036 can run in parallel with local graph work, but remote/host claims remain unverified.

## Implementation Strategy

1. Keep the measurement foundation fail-closed and preserve the 13-tool compatibility contract.
2. Complete local B/C behavior and focused tests before attempting external qualification.
3. Use real pre-registered tasks for PN6/PN8; do not convert current fixture/implementation work
   into product-value evidence.
4. Rebind all evidence to the final candidate and let the read-only verifier decide admission.
