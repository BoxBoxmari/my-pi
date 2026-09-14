# Research: Self-Hosted Enforcement, Visual Plane, and Measured Evidence

**Date**: 2026-09-13

**Scope**: Phase 0 research for the Spec Kit feature. Findings are from the current repository,
the user-provided four plan documents, the current my-pi MCP runtime, CodeGraph, AGT, and
x-harness. They are not claims about untested remote hosts.

## Decision 1: Keep the default MCP surface immutable

- **Decision**: Preserve the default catalog as exactly 13 tools and expose visuals only through an
  explicit opt-in path.
- **Evidence**: The official MCP client launched `apps/my-pi-mcp/dist/main.js` in trusted mode and
  observed the names `ast_search`, `fs_patch`, `fs_read`, `fs_stat`, `fs_write`,
  `lsp_diagnostics`, `lsp_navigate`, `lsp_status`, `lsp_symbols`, `search`, `vcs_diff`,
  `vcs_status`, and `workspace_info`. The visuals probe reported the same catalog.
- **Rationale**: Tool-count or schema drift would invalidate the compatibility contract and make
  host behavior harder to interpret.
- **Alternative rejected**: Adding graph tools to the stable catalog would make optional visuals a
  breaking default change.

## Decision 2: Use ObservedTask v2 as the evidence boundary

- **Decision**: A result is promotion-eligible only when its task definition, schema, arm identity,
  base, run/session identities, contamination state, tests, and adjudication all validate.
- **Evidence**: The current v2 validator rejects the existing legacy v1 record with explicit
  schema-version, record-type, identity, timestamp, arm, and adjudication errors. The current
  aggregate has `totalPairs: 10`, `qualifiedPairs: 0`, `promotionEligible: false`, and a required
  minimum of three qualified pairs per hypothesis.
- **Rationale**: Implementation fixtures and self-observation are useful regression evidence but
  cannot answer a paired product hypothesis.
- **Alternative rejected**: Upgrading old records in place would erase the distinction between the
  old experiment contract and the v2 validity rules.

## Decision 3: Observe first, then fail closed at admission

- **Decision**: Code-state reconciliation records provenance without blocking; strict local or CI
  admission rejects unknown/unmanaged/stale source changes and invalid attestations.
- **Evidence**: Focused provenance, canonical subject, attestation, and local admission tests pass.
  A report-only run on the current same base/head returns `review_required` with
  `missing_attestation`, not an allowed decision.
- **Rationale**: Observe mode makes bypasses measurable, while admission is the correct boundary for
  a claim that a change is provenanced.
- **Alternative rejected**: Treating a later external write of matching bytes as managed would
  silently adopt a bypass and make the evidence non-falsifiable.

## Decision 4: Make the admission subject portable and signed

- **Decision**: Canonicalize repository identity, base/head, path, status, resulting blob identity,
  and mode; exclude only the declared provenance metadata; sign the subject and covered receipt
  digests with Ed25519.
- **Evidence**: `packages/change-runtime` contains subject, attestation, and local admission seams;
  tests cover create/modify/delete/rename, modes, symlink entries, provenance exclusion, tamper,
  wrong key, stale head, and extra path cases.
- **Rationale**: GitHub cannot depend on local SQLite state, and a receipt identifier alone does
  not bind the exact pull-request change set.
- **Alternative rejected**: Hashing the entire workspace would include mutable evidence metadata and
  create a circular or non-portable subject.

## Decision 5: Share one bounded graph contract across daemon and UI

- **Decision**: Keep `graph-model` and `graph-projection` independent of MCP, browser, and storage;
  expose bounded `graph_snapshot` and `graph_expand` reads through the daemon/client; render the
  same data in the portal and optional MCP Apps path.
- **Evidence**: CodeGraph exploration of `buildGraphSnapshot`, `expandGraphSnapshot`, and
  `CoordinationClient.graphSnapshot/graphExpand` shows bounded BFS, deterministic normalization,
  evidence metadata, frame/output limits, and abort handling. Focused graph model/projection,
  cancellation, portal, and MCP compatibility tests pass.
- **Rationale**: A single authoritative contract prevents UI-specific graph semantics and keeps
  the visual plane read-only.
- **Alternative rejected**: Direct UI-to-SQLite queries would bypass daemon authorization and make
  evidence provenance difficult to audit.

## Decision 6: Use progressive visual enhancement

- **Decision**: The loopback portal is the fallback; MCP Apps resources are opt-in and unsupported
  hosts degrade without failing initialization.
- **Evidence**: Portal tests cover token/origin/loopback/CSP behavior. The official visuals probe
  preserved all 13 tools and returned an empty resource catalog when coordination metadata was
  unavailable, which is a safe degraded path.
- **Rationale**: Host support is fragmented and must not force a core protocol-era migration.
- **Alternative rejected**: Making MCP Apps mandatory would make the product unusable in the
  legacy/default host path.

## Decision 7: Treat host policy as maturity-labelled evidence

- **Decision**: Policy bundles declare monitoring/managed/strict-capable intent and known gaps;
  strict certification requires seeded bypass tests and is not inferred from configuration alone.
- **Evidence**: `packages/host-profiles/src/policy-bundle.ts` and its tests emit maturity and
  unenforced-path metadata. No remote host bypass suite has been claimed as passed in the current
  candidate.
- **Rationale**: A host configuration file cannot prove that a native editor, shell redirect,
  scripted write, or alternate MCP server is actually blocked.

## Decision 8: Preserve explicit withholding for the current candidate

- **Decision**: Keep Track A aggregate and x-harness completion card withheld/blocked until the
  candidate has a clean commit-bound state and independent qualified workloads.
- **Evidence**: `pnpm verify` passes the repository gates and release tests, but the observed
  aggregate is WITHHELD with zero qualified pairs. The read-only x-harness run reports
  `admission_outcome: blocked` and `acceptance_status: withheld`; the report-only local admission
  is `review_required` because no attestation is present.
- **Rationale**: Passing unit/build tests proves implementation health, not experimental validity
  or final admission.
- **Alternative rejected**: Marking the card accepted would contradict the x-harness contract and
  allow stale or unbound evidence to be presented as a completion claim.

## Unresolved qualification work

The remaining question is empirical, not a design placeholder: can real independent PN6 and PN8
workloads meet their predeclared sample and adjudication gates on a clean candidate? The answer is
currently **not established**. The next safe action is to commit the intended candidate scope only
when authorized, pre-register real tasks before running them, execute both arms through stable
my-pi, and rerun the aggregation and unchanged promotion verifier. No fixture result may fill this
gap.
