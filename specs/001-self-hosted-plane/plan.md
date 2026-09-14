# Implementation Plan: Self-Hosted Enforcement, Visual Plane, and Measured Evidence

**Branch**: `001-self-hosted-plane` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-self-hosted-plane/spec.md`, aligned with
`plan/2026-09-13-self-hosted-prd.md`, `plan/2026-09-13-self-hosted-srs.md`,
`plan/2026-09-13-self-hosted-technical-plan.md`, and
`plan/2026-09-13-self-hosted-implementation-plan.md`.

## Summary

The increment adds a measured Track A foundation, observe-mode Track B provenance and admission
controls, and Track C bounded graph/visual surfaces while preserving the default my-pi MCP catalog.
The implementation uses protocol-neutral graph packages, bounded daemon/client reads, a read-only
loopback portal, an opt-in MCP Apps seam, portable Ed25519 admission evidence, and report-mode CI.
The existing promotion verifier remains authoritative; current local evidence is a candidate and
must remain withheld until real independent PN6/PN8 workloads qualify.

## Technical Context

**Language/Version**: TypeScript/JavaScript on Node.js `v26.7.0`; Go `go1.26.5` for the native
x-harness CLI; PowerShell on the current Windows host.

**Primary Dependencies**: pnpm `11.2.2`, TypeScript project references, Vitest, Node built-ins,
existing MCP SDK/server v2-era compatibility, esbuild, SQLite/coordination runtime, Ed25519 from
Node crypto, CodeGraph, AGT, and x-harness. No unrestricted execution dependency is introduced.

**Storage**: Existing file-first repository artifacts, existing coordination/SQLite state for
daemon projections, immutable JSON task/result records, and public attestations under the declared
provenance boundary. Private signing keys are stored outside the workspace.

**Testing**: `pnpm test:fast`, targeted package tests, `pnpm build`, `pnpm typecheck`, release tests,
`pnpm verify`, my-pi MCP runtime probes, AGT integrity/policy checks, CodeGraph sync/status, and
read-only x-harness verification at the applicable tier.

**Target Platform**: Windows is the current measured platform; POSIX behavior requires separate
evidence. The product remains local-first and supports the repository's existing Node/Go targets.

**Project Type**: Multi-package TypeScript/Node CLI and MCP server with a Go-native verification
CLI, a local coordination daemon, and a small read-only browser/portal application.

**Performance Goals**: Every graph and provenance read is bounded by nodes, edges, depth, result
count, bytes, frame size, retry attempts, or timeout. Portal requests are local and must not load
third-party assets. Default MCP startup preserves the exact 13-tool catalog.

**Constraints**: No direct UI-to-SQLite access; no generic `exec`; no default MCP behavior change;
no silent provenance adoption; no self-certification; no PN11 or repository ruleset activation
before the existing promotion/admission gates authorize it; preserve pre-existing dirty work.

**Scale/Scope**: Four graph kinds, bounded local neighborhoods, path-level provenance, paired PN6
and PN8 task records, report-mode PR admission, and candidate evidence bound to the measured state.
This increment does not promise a hosted control plane or production strict enforcement for every
host.

## Constitution Check

*Gate before research: PASS.*

- Self-host authority: all runtime inspection and evidence readback uses the my-pi MCP surface;
  x-harness remains the completion authority.
- Stable core: default catalog compatibility is tested as exactly 13 tools; visuals are opt-in.
- Bounded local-first operation: graph, provenance, IPC, portal, and evidence paths have explicit
  bounds and no generic execution path.
- Fail-closed admission: canonical subject, path coverage, receipt lineage, and Ed25519 checks
  reject missing or tampered proof; observe mode remains non-blocking.
- Experimental validity: v2 schema, isolation, contamination, adjudication, and sample-target
  gates withhold invalid or insufficient evidence.
- Testable reviewable state: focused tests, full verify, AGT, CodeGraph, and read-only x-harness
  are required before any acceptance claim.

*Post-design recheck: PASS with a declared qualification gap.* Current local implementation tests
pass, but PN6/PN8 promotion remains withheld because no qualified independent workload pair has been
measured. That is a measured state, not a design defect to hide.

## Research Summary

See [research.md](research.md). Decisions are based on the repository's current contracts and
runtime probes rather than speculative host behavior. The key decision is to keep Track A evidence
strictly separate from implementation fixtures while shipping B/C seams incrementally.

## Project Structure

### Documentation (this feature)

```text
specs/001-self-hosted-plane/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code

```text
apps/
├── my-pi-mcp/                 # stable MCP catalog and opt-in visuals resource
├── my-pi-daemon/              # bounded graph/provenance IPC and reconciliation
└── my-pi-ui/                  # read-only loopback portal and shared browser view

packages/
├── change-runtime/            # canonical admission subject, signing, local report
├── code-state/                # provenance reconciliation and observe-mode records
├── coordination-client/       # bounded typed daemon reads and cancellation
├── graph-model/               # protocol/browser-neutral bounded graph contract
├── graph-projection/          # deterministic code/impact/work/lineage projections
├── host-profiles/             # experimental host policy bundles and maturity
└── mcp-adapter/               # stable tools plus opt-in MCP Apps compatibility seam

dogfood/schema/                # ObservedTask/ObservedResult v2 schemas
scripts/                       # validators, runners, aggregators, and admission tools
test/release/                  # release and evidence contract tests
.github/workflows/             # report-mode admission job
```

**Structure Decision**: Keep graph model/projection neutral packages separate because both daemon
and UI consume them, and keep admission/provenance in their existing owning packages. The portal
communicates through coordination-client; it does not reach into SQLite. Track A scripts remain
file-first and independently validate pre-registration, isolation, contamination, and aggregation.

## Delivery Gates

1. Baseline and Spec Kit artifacts exist and contain no unexplained placeholders.
2. Track A schema, validator, runner, and aggregator fail closed on invalid/contaminated input.
3. Track B observe/provenance/local admission and Track C graph core pass focused tests.
4. Default my-pi runtime reports exactly 13 tools and valid LSP/FS/search/VCS behavior.
5. Portal, MCP Apps fallback, host policy, and report-mode admission tests pass.
6. Full repository verification, AGT, CodeGraph, and x-harness read-only results are recorded.
7. Real independent PN6/PN8 workloads are pre-registered and rerun on a clean candidate before
   any promotion decision. Until then, aggregate status is WITHHELD.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Separate `graph-model` and `graph-projection` packages | The same bounded contract must serve daemon, portal, and MCP Apps without browser/MCP coupling. | Keeping projections in the UI would make the authoritative daemon path untestable and permit divergent graph semantics. |
| Ed25519 attestation plus canonical subject | CI cannot access local SQLite and must validate an exact PR change set offline. | A local receipt ID or mutable workspace file would not prove path coverage or survive remote verification. |
| Paired observed-task harness | Self-hosted implementation work is otherwise contaminated and cannot support PN6/PN8 inference. | Fixture-only tests measure code correctness, not the declared product variable or independent outcome. |
