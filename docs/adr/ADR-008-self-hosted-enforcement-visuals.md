# ADR-008: Start self-hosted enforcement with observed tasks and local provenance

- Status: Accepted with conditions for the Track A foundation
- Date: 2026-09-13
- Baseline: `835232d0b6b205027c4d35ac6203b31dd3ba76d3`
- Related plan: `plan/2026-09-13-self-hosted-implementation-plan.md`
- Related Known spec: `specs/2026-09-13/self-hosted-enforcement-and-visual-plane-implementation-decision`

## Context

The self-hosted PRD, SRS, technical plan, and implementation plan ask my-pi to make source mutation provenance observable and eventually enforceable while preserving the frozen default MCP surface. The repository already has a stable-N-1 dogfood pattern, `ChangeReceipt` integrity checks, and code-state fingerprints. It does not yet have an authoritative Known task or a versioned contract for controlled paired observations.

The current baseline is the local `main` commit shown above. The user-owned
`plan/` documents remain requirements and are not modified by implementation.
The working tree may contain candidate changes while this slice is developed;
candidate-bound evidence is not promotion evidence. The Production Next
promotion verifier remains the authority for promotion; its current PN6, PN8,
PN9, and PN12 state is not changed by this ADR. PN11 remains closed.

## Decision

Implement the first bounded slice in this order:

1. PR-00: record this baseline and the claim vocabulary `observe`, `managed`, `strict-capable`, and `strict-certified`.
2. PR-01: add an ObservedTask v2 task/result schema and a fail-closed validator for immutable preregistration, paired-arm identity, independent adjudication, and contamination controls.
3. PR-02: add a deterministic paired-runner foundation that creates isolated arm manifests and runs only commands declared by the task definition.
4. B0/B1: classify code-state transitions as `managed`, `unmanaged`, `stale_lineage`, `unknown`, or `exempt` using a verified receipt plus explicit project/worktree/path lineage.
5. Track A aggregation: convert executed v2 manifests into bounded results and
   produce a candidate-only aggregate that records metric deltas while always
   remaining withheld from promotion.

This slice is report-only. Matching bytes alone cannot create managed lineage, and an unmanaged transition cannot be silently adopted later. The existing 13-tool default catalog, path policy, sensitive-file handling, and host-neutral behavior remain unchanged.

## Product and evidence conditions

- PR-01 and PR-02 are harness instrumentation, not PN6 or PN8 product-value evidence.
- The aggregate is an evidence report, not an admission authority. Existing v1
  records are visible to the report but cannot be upgraded into v2-qualified
  pairs without the new schema, independent adjudication, and measurements.
- Golden tests and seeded bypass tests must pass before any remote admission, host-strict profile, or MCP Apps work begins.
- A direct editor or native filesystem write must remain distinguishable from an applied my-pi receipt.
- A read-only verifier, not this ADR or an agent claim, decides completion.
- Candidate-bound evidence is regenerated only after the final local commit. No remote push or ruleset mutation is authorized by this ADR.

## Alternatives considered

### Build the visual graph first

Rejected for this slice. The graph can expose existing code-state and impact contracts later, but a visualization before the mutation-evidence contract would make interpretation look more complete than the evidence actually is.

### Enforce host and remote policy immediately

Deferred. Host profiles, GitHub admission, signed subjects, and MCP Apps require empirical bypass coverage and independent verification. The current branch-protection endpoint is not readable through the configured GitHub App, so no remote control claim is made here.

### Change `ChangeReceipt` immediately

Deferred. The existing receipt already carries project/worktree identity, input/output resource versions, verification, and a digest. The first reconciler should prove a concrete missing field before widening that contract.

## Consequences

The repository gains a bounded, testable measurement and provenance seam without changing default runtime behavior. The seam supports later local admission and graph projections, while keeping remote enforcement and PN11 explicitly out of scope. The Known decision remains evidence-gated until the implementation task and read-only x-harness verifier accept the result.

## Verification boundary

Required evidence for this decision's implementation:

- current local base SHA and Known task/spec state;
- schema and validator tests, including negative control/treatment cases;
- deterministic paired-runner and contamination tests;
- provenance golden and direct-write bypass tests;
- `npm run test:fast`, build, typecheck, focused tests, and existing compatibility gates;
- final x-harness output with `admission.outcome: success` and `acceptance_status: accepted`.
