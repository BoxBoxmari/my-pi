# Product Requirements Document — my-pi Self-Hosted Enforcement & Visual Plane

**Product:** my-pi  
**Program:** Track B + Track C as self-hosted workloads for Track A  
**Status:** Draft for implementation  
**Date:** 2026-09-13

---

## 1. Product thesis

my-pi should evolve from a local coding capability runtime into a **local coding authority with evidence-backed state that both agents and humans can inspect**.

The program delivers two user-facing outcomes:

1. **Enforcement Plane:** my-pi can identify whether source mutations have verified my-pi lineage and, in certified strict environments, prevent unprovenanced changes from being admitted for merge.
2. **Visual Plane:** my-pi can render code, impact, work, and change/evaluation graphs from authoritative local state without relying on LLM-generated diagrams.

The same engineering work is used as real observed workloads to determine whether Production Next's impact routing and structured feedback actually improve outcomes.

---

## 2. Product problem

### 2.1 Current user problem

my-pi provides useful code-aware capabilities and experimental Production Next state, but the value is difficult to observe and the runtime cannot yet make a strong cross-host claim that admitted source mutations went through my-pi.

Users face four gaps:

- **Visibility gap:** graph-like state exists in code-state, impact, coordination, and evaluation, but it is not presented as an interactive visual model.
- **Authority gap:** configuring an MCP server does not force an agent to use it when the host exposes alternate edit/shell paths.
- **Admission gap:** local `ChangeReceipt` state is not automatically portable to remote CI, so GitHub cannot independently prove the transition used my-pi.
- **Evidence gap:** Production Next has implementation and candidate benchmarks, but PN6/PN8 promotion remains withheld for lack of sufficiently controlled observed outcomes.

### 2.2 Why not just add more MCP tools?

More tools do not solve the core problems. Tool count does not create enforceable authority, independent provenance, or human understanding. The legacy 13-tool surface is intentionally stable and should remain so in default mode.

---

## 3. Strongest argument against the product direction

A combined Enforcement + Visual program can become an overbuilt platform that increases maintenance without proving better coding outcomes. The UI could become a second product, strict policies could degrade agent productivity, and self-hosted evidence could be biased because my-pi is testing itself.

The product proceeds only under these controls:

- V1 Visual Plane is read-only and uses one shared graph contract.
- Enforcement is staged from observation to admission; no premature “mandatory” claim.
- Stable N-1 and independent tests remain evidence authorities.
- PN6/PN8 experiments manipulate one feature at a time.
- PN11 remains closed until the existing promotion verifier passes.
- Stop/narrow the program if observed routing and feedback fail their current empirical gates.

---

## 4. Users and jobs-to-be-done

### 4.1 Primary user — developer using coding agents

**JTBD:** “When an agent modifies my code, I want to know what changed, what it may affect, and whether the accepted change followed the controlled mutation path, without surrendering my whole machine to the agent.”

### 4.2 Maintainer/reviewer

**JTBD:** “When reviewing agent work, I want an evidence-backed dependency and change lineage view so I can inspect why my-pi routed context or accepted/rejected a change.”

### 4.3 Repository owner

**JTBD:** “When code reaches a protected branch, I want a machine-verifiable admission signal that distinguishes provenanced changes from bypassed mutation.”

### 4.4 my-pi product maintainer

**JTBD:** “When deciding whether Production Next deserves promotion, I want controlled self-hosted evidence from real engineering work rather than synthetic benchmarks alone.”

---

## 5. Product principles

1. **Evidence over assertion.** Every important visual or admission decision must trace to authoritative records.
2. **Local-first.** No hosted control plane is required for core operation.
3. **Stable core, additive experiments.** Default legacy mode remains unchanged.
4. **Fail closed only where the product can justify it.** Observe first; enforce only after bypass tests.
5. **No self-certification.** Candidate product outcomes require independent authority/adjudication.
6. **Progressive enhancement.** MCP Apps enrich compatible hosts; standalone portal preserves human access elsewhere.
7. **No arbitrary shell expansion.** The project does not add unrestricted exec merely to make strict mode convenient.

---

## 6. Goals

### G1 — Self-hosted evidence program

Create a repeatable way to build my-pi with my-pi while producing promotion-eligible observed evidence for PN6/PN8 when the task qualifies.

### G2 — Mutation provenance

Classify observed source changes as managed, unmanaged, stale, unknown, or exempt and preserve evidence connecting managed output to a verified my-pi receipt.

### G3 — Admission

Provide a path from local provenance to a portable admission attestation that GitHub can validate against the exact PR change set.

### G4 — Host policy

Generate platform-specific policy bundles that reduce alternate mutation paths and accurately state each host's enforcement maturity.

### G5 — Visual graph model

Provide deterministic, bounded, evidence-backed graphs for code, impact, work, and change/evaluation lineage.

### G6 — Multi-surface visualization

Render the same graph data through MCP Apps in compatible hosts and a standalone local portal fallback.

### G7 — Preserve current product identity

Do not replace my-pi with a generic agent orchestrator, chat product, hosted control plane, or GUI-centric architecture.

---

## 7. Non-goals

- forcing every read/search command through my-pi;
- adding unrestricted shell/exec to the stable tool catalog;
- editing code from the Visual Plane V1;
- autonomous model/agent spawning;
- migrating the core MCP protocol era as part of this program;
- enterprise SSO/authentication in this phase;
- a hosted SaaS dashboard;
- messaging/voice workflows or Twilio integration;
- claiming general product value from self-hosting alone;
- starting PN11 before promotion admission.

---

## 8. Scope

### 8.1 Track A — Experimental Harness

#### P-A1 ObservedTask v2

The system shall support pre-registered experiment definitions with immutable acceptance criteria, base SHA, arm definitions, test/adjudication requirements, and metric definitions.

#### P-A2 Isolation

Control and treatment primary runs shall use isolated worktrees and fresh sessions and shall record enough environment identity to detect invalid comparisons.

#### P-A3 PN6 comparison

The harness shall support a paired impact-routing comparison in which the only primary treatment variable is impact-aware routing.

#### P-A4 PN8 comparison

The harness shall support a paired repair comparison from the same frozen failing state: ordinary logs versus structured FeedbackPacket.

#### P-A5 Aggregation

Eligible task results shall be aggregatable into PN6/PN8 evidence candidates without changing the independent promotion verifier.

### 8.2 Track B — Enforcement Plane

#### P-B1 Observe mode

Users shall be able to run my-pi without blocking while the daemon records mutation provenance classifications.

#### P-B2 Provenance inspector

Users/reviewers shall be able to inspect why a path is classified as managed/unmanaged/stale/unknown/exempt.

#### P-B3 Local admission report

Users shall be able to compare a Git change set with local verified lineage and receive path-level admission findings before push/merge.

#### P-B4 Host policy bundles

my-pi shall generate experimental host policy bundles for supported hosts. Bundles shall state whether the host is strict-capable, managed, or monitoring.

#### P-B5 Signed admission

A certified authority shall be able to produce a portable attestation covering the exact changed-path/blob subject. CI shall verify it without access to local SQLite state.

#### P-B6 GitHub admission check

A GitHub workflow shall emit `my-pi/admission` for the exact PR head. After qualification, repository rules shall require the check.

#### P-B7 No silent bypass normalization

An unmanaged source mutation shall not become managed merely because the agent later asks my-pi to observe the current final bytes. Adoption/review, if supported, must be explicit and distinguishable from managed publication.

### 8.3 Track C — Visual Plane

#### P-C1 Code Graph

Visualize repository/module/file/symbol/test entities and contains/imports/references/calls/tests edges.

#### P-C2 Impact Graph

Visualize an Intent/ImpactResult with affected entities, work items, agents, reason paths, confidence, graph version, and truncation state.

#### P-C3 Work Graph

Visualize work items, intents, dependencies, assignments, and participating agent sessions.

#### P-C4 Lineage Graph

Visualize Intent -> ChangeProposal -> ChangeReceipt -> EvaluationRun -> FeedbackPacket -> RetryCycle -> Acceptance state.

#### P-C5 Evidence inspection

Selecting a node/edge shall expose stable identifiers and evidence references sufficient to trace back to authoritative records.

#### P-C6 Bounded expansion

The UI shall request bounded graph neighborhoods instead of requiring complete project graphs.

#### P-C7 MCP Apps

When a host supports MCP Apps and visuals are explicitly enabled, my-pi shall be able to return an interactive graph view.

#### P-C8 Local portal

Users shall be able to open a loopback-only read-only portal using the same graph view implementation.

---

## 9. User journeys

### Journey J1 — Agent builds a Track C feature under observation

1. Maintainer pre-registers OT task and acceptance criteria.
2. Stable my-pi authority creates/records the work boundary.
3. Agent implements through my-pi mutations.
4. Code-state observes matching receipt fingerprints as managed.
5. Independent tests run through the harness.
6. Reviewer inspects impact/lineage graph.
7. Result is recorded; if paired and valid, it contributes to PN6 or PN8 evidence.

### Journey J2 — Direct editor bypass occurs

1. A host/native editor changes a tracked source file outside my-pi.
2. Code-state detects the new fingerprint.
3. No verified receipt output matches the transition.
4. Path is classified `unmanaged`.
5. Observe mode displays it without blocking.
6. Strict local/CI admission rejects it unless an explicit human-reviewed exception policy applies.

### Journey J3 — Reviewer explores impact

1. User asks to inspect an Intent.
2. Daemon returns a bounded `GraphSnapshot(kind=impact)`.
3. Compatible host renders MCP App; otherwise user opens local portal.
4. User expands a node neighborhood and inspects evidence references.
5. UI never mutates source state.

### Journey J4 — PR admission

1. Developer creates code changes through verified my-pi mutation lineage.
2. Local authority seals a portable admission attestation for the canonical PR subject digest.
3. Attestation is committed/staged according to the defined provenance flow.
4. GitHub Action recomputes the subject, validates signature and path coverage.
5. `my-pi/admission` succeeds only if source changes are covered.
6. Once ruleset enforcement is enabled, merge requires this status.

---

## 10. Success metrics

### Product metrics

| Metric | Success condition |
|---|---|
| Stable compatibility | Default MCP catalog remains exactly 13 tools/schemas |
| Provenance coverage | 100% of strict-admitted changed source paths covered by verified lineage or explicit review exception |
| Admission bypass | 0 successful seeded bypass cases in certified strict profile test suite |
| Visual evidence | 100% of rendered nodes/edges have authoritative source/evidence lineage or an explicit “derived” provenance record |
| Sensitive path leakage | 0 sensitive-path entities exposed by graph APIs in policy tests |
| Portal network exposure | loopback only; seeded non-loopback/invalid-origin access rejected |

### PN6 promotion metrics

- treatment routing recall >= control baseline;
- treatment average repair iterations < control baseline;
- missed dependency and false-positive counts explicitly retained;
- repeated independent run IDs across heterogeneous engineering tasks.

### PN8 promotion metrics

- structured-feedback repair yield > ordinary-log handoff;
- prior passes preserved for every accepted structured repair;
- seeded false accepts = 0.

### Secondary efficiency metrics

- context bytes routed;
- time to accepted result;
- number of files unnecessarily touched;
- graph payload size/render latency;
- user review actions to locate relevant evidence.

Secondary metrics cannot override correctness gates.

---

## 11. Release / maturity states

### Experimental

- ObservedTask v2 harness;
- graph contracts/projections;
- observe-mode provenance;
- MCP Apps and local portal;
- generated host policy bundles.

### Candidate

A feature can move to candidate after targeted tests, cross-platform CI where applicable, and self-hosted dogfood evidence.

### Strict-certified host profile

A profile receives this label only after seeded bypass tests demonstrate that alternate source mutation paths are blocked or reliably rejected at admission while required development verification remains usable.

### Production Next promotion

Not controlled by this PRD. The existing read-only promotion verifier remains authoritative. PN11 begins only when it reports `promotionEligible: true`.

---

## 12. Risks and product responses

| Risk | Product response |
|---|---|
| UI becomes a second product | read-only V1, one shared graph model and one shared browser bundle |
| Strict mode makes coding impractical | enforce mutation authority, not all tool use; predeclared test/evaluator path |
| Agent forges provenance | signed attestation + signer key outside workspace + bypass tests |
| CI cannot access local state | portable signed admission subject/attestation |
| Self-host evidence is biased | stable N-1, paired arms, independent tests, fresh worktrees/sessions |
| Visual graph overclaims causality | preserve provider/confidence/reason/evidence metadata; do not let UI/LLM invent edges |
| MCP Apps client fragmentation | standalone local portal fallback |
| Protocol migration destabilizes program | keep core MCP-era migration out of scope |
| Too many new packages/dependencies | use existing esbuild; only add graph library and MCP Apps dependency where justified |

---

## 13. Stop / reversal criteria

Narrow or stop Production Next investment if any of the following persists after the planned observed workload set:

- impact routing fails to reduce repair iterations or creates materially worse false-positive burden;
- structured feedback does not outperform ordinary logs on repair yield;
- admission enforcement requires unacceptable host breakage or a hosted control plane contrary to product identity;
- graph visualization does not materially improve review/diagnosis and becomes primarily cosmetic maintenance;
- enforcement complexity creates more bypass/security risk than it removes.

---

## 14. Definition of done for this program increment

This increment is done when:

1. ObservedTask v2 harness can run valid isolated paired tasks.
2. Track B observe/provenance/local admission is operational and auditable.
3. At least one strict-capable host profile passes seeded mutation-bypass tests in candidate mode.
4. Track C renders code, impact, work, and lineage graphs from authoritative daemon data through a local portal; MCP Apps view passes a supported-host/basic-host compatibility spike.
5. Signed remote admission flow and GitHub check are implemented in report mode and have no unexplained false passes in dogfood.
6. B/C development has generated the planned qualified PN6/PN8 observed tasks.
7. Evidence candidates can be generated and the existing promotion verifier can be run without modifying its gate semantics.
8. PN11 remains untouched unless promotion is actually admitted.
