# Implementation Plan — my-pi Self-Hosted Track B + Track C + Track A Evidence

**Date:** 2026-09-13  
**Status:** Proposed execution plan  
**Baseline:** `835232d0b6b205027c4d35ac6203b31dd3ba76d3`

---

## 1. Overview

Implement Track B (Enforcement Plane) and Track C (Visual Plane) in parallel after a minimal Track A ObservedTask v2 harness is ready. Use the resulting real engineering tasks as controlled self-hosted workloads for PN6/PN8 evidence. Preserve the default 13-tool MCP surface and keep PN11 closed until the existing promotion verifier passes.

This plan is deliberately PR-oriented and gate-driven. A phase can stop without invalidating completed lower layers.

---

## 2. Implementation rules

1. **Default legacy behavior cannot change.** Every PR runs the existing compatibility suite.
2. **No production claim from fixture-only results.** Qualification and promotion evidence remain distinct.
3. **No direct UI -> SQLite coupling.** UI uses daemon/client APIs.
4. **No candidate self-certification.** Stable N-1 and independent tests remain where required.
5. **No unrestricted exec tool.** Experiment commands are predeclared; product strict mode retains bounded verification paths.
6. **One primary experiment variable per PN6/PN8 pair.**
7. **No branch ruleset hard enforcement until report-mode admission is validated.**
8. **Do not migrate core MCP era in these PRs.**

---

## 3. Workstream map

```text
                         P0 Harness Foundation
                              /       \
                             /         \
                            v           v
                 B0/B1 Enforcement     C0/C1 Graph Core
                        |                    |
                        +---------+----------+
                                  |
                             PN6 task pairs
                                  |
                  +---------------+----------------+
                  |                                |
                  v                                v
             B2/B3/B4                         C2/C3 UI
     admission / host policy          portal / MCP Apps
                  |                                |
                  +---------------+----------------+
                                  |
                             PN8 repair pairs
                                  |
                                  v
                         Evidence aggregation
                                  |
                                  v
                    promotion verifier -> PN11?
```

---

## 4. Phase 0 — Freeze baseline and measurement contract

### PR-00 — Program baseline documentation

**Purpose:** prevent moving targets before experimentation begins.

**Changes**

- Add program ADR referencing current Production Next direction.
- Record baseline commit and current PN6/PN8/PN9/PN12 disposition.
- State explicitly that B/C product work is not itself promotion evidence.
- Record strict claim vocabulary: `observe`, `managed`, `strict-capable`, `strict-certified`.

**Likely files**

- `docs/adr/ADR-002-self-hosted-enforcement-visuals.md`
- `docs/production-next/IMPLEMENTATION_STATUS.md` (minimal linkage only; do not rewrite gate status)

**Tests/gates**

- documentation/ref checks;
- `pnpm check:refs` / existing architecture/public boundary checks.

**Exit:** baseline and terminology are immutable enough to start harness work.

---

## 5. Phase 1 — ObservedTask v2 Harness (prerequisite)

### PR-01 — ObservedTask v2 schema + validator

**Purpose:** define what can count as a controlled observed engineering task.

**Add**

- `dogfood/schema/observed-task-v2.schema.json`
- `dogfood/schema/observed-result-v2.schema.json`
- `scripts/validate-observed-task-v2.mjs`
- tests under `test/release/` or a dedicated dogfood test directory.

**Schema fields**

- immutable task identity and definition commit;
- hypothesis (`PN6`, `PN8`, `none`);
- base SHA;
- task class;
- acceptance criteria;
- control/treatment variables;
- host/model/session metadata;
- required tests;
- ground-truth/adjudication rules;
- metrics;
- contamination controls.

**Validation rules**

- task definition commit precedes run start;
- control/treatment same base;
- one declared primary variable;
- separate run/session IDs;
- independent adjudication required for promotion eligibility;
- candidate results cannot overwrite task definition.

**Exit:** invalid experimental designs are rejected before execution.

### PR-02 — Paired experiment runner

**Purpose:** automate isolation but not the coding agent itself.

**Add/extend**

- `scripts/dogfood-observed-paired-v2.mjs`
- reuse helpers from `dogfood-observed-paired-review.mjs` and stable-bootstrap utilities;
- worktree lifecycle helper;
- command runner restricted to commands committed in the task definition.

**Behavior**

- create/validate paired worktrees;
- record source state digests;
- start/attach stable N-1 authority when required;
- emit per-arm run manifests;
- run predeclared downstream tests;
- never copy opposite-arm outputs;
- preserve partial/failure records.

**Tests**

- mismatched base -> fail;
- same worktree -> fail;
- task modified after start -> fail;
- unregistered test command -> fail;
- cross-arm artifact present -> mark contaminated/fail promotion eligibility;
- deterministic frozen metadata.

**Exit Gate H:** harness is usable before any new B/C task is counted toward PN6/PN8.

---

## 6. Parallel Phase 2B — Track B Observe + Provenance

### PR-B01 — Provenance observation contracts

**Purpose:** classify observed mutations without blocking.

**Changes**

- extend experimental contracts with:
  - `MutationProvenanceStatus`;
  - `MutationObservation`;
  - `ProvenanceReasonCode`;
  - optional explicit adoption/review type, separate from managed publication.
- add store migration for durable provenance observations if current event/projection model cannot represent them cleanly.

**Do not** redefine `ChangeReceipt` unless a concrete missing field is proven.

**Tests**

- schema/type tests;
- backward store migration tests;
- no legacy default-mode behavior change.

### PR-B02 — Receipt-to-code-state reconciler

**Purpose:** determine whether an observed fingerprint transition matches verified my-pi lineage.

**Implementation seam**

- `apps/my-pi-daemon/src/code-state-manager.ts` observes authoritative fingerprints;
- daemon already verifies receipt integrity before recording production change state;
- add a reconciler that maps receipt outputs to subsequent code-state observations.

**Classification algorithm**

1. Resolve canonical worktree/path under policy.
2. Get authoritative observed fingerprint.
3. Find latest verified applicable receipt output.
4. Verify project/worktree/path identity and receipt digest.
5. Classify:
   - exact current output -> `managed`;
   - external transition with no receipt -> `unmanaged`;
   - incompatible ancestor/input -> `stale_lineage`;
   - insufficient info -> `unknown`;
   - configured generated/evidence path -> `exempt`.

**Tests**

- my-pi `fs_write` / `fs_patch` managed;
- native editor write unmanaged;
- same bytes written externally after receipt does not fabricate a new transition;
- partial batch output per path;
- create/delete/replace;
- worktree isolation;
- `.env` remains denied/unexposed;
- watcher reconciliation does not duplicate observations for unchanged fingerprint.

### PR-B03 — Provenance query + local report

**Purpose:** make observations inspectable and create a local admission precursor.

**Add bounded daemon/client read API**

- `provenance_path_status` or equivalent;
- `provenance_change_set` or equivalent.

**Add CLI/script report**

- recompute Git base/head changed paths;
- print JSON and human-readable result;
- no remote enforcement yet.

**Exit Gate B1:** report mode can explain managed/unmanaged changes with no silent adoption.

---

## 7. Parallel Phase 2C — Track C Graph Core

### PR-C01 — `@my-pi/graph-model`

**Add package**

- `packages/graph-model/package.json`
- `src/model.ts`
- `src/index.ts`
- tests.

**Contracts**

- `GraphKind`;
- `GraphNode`;
- `GraphEdge`;
- `GraphSnapshot`;
- `GraphBounds`;
- evidence references;
- truncation/cursor metadata.

**Constraints**

- no MCP imports;
- no browser imports;
- no store imports;
- no absolute path requirement;
- bounded scalar attributes.

### PR-C02 — `@my-pi/graph-projection`

**Add package**

- deterministic code graph projector;
- deterministic impact graph projector;
- deterministic work graph projector;
- deterministic lineage graph projector.

**Important mappings**

- code: existing `CodeEntity`/`CodeEdge`;
- impact: preserve `ImpactReason.entityPath`, confidence, graphVersion, truncation;
- work: existing WorkItem/Intent/AgentSession/WorkDependency;
- lineage: ChangeProposal/Receipt/EvaluationRun/FeedbackPacket/RetryCycle/decision.

**Tests**

- stable ordering/IDs;
- cycles;
- dangling/missing refs;
- exact evidence refs;
- bound enforcement;
- no sensitive paths;
- partial receipts visually distinct from accepted/rejected.

### PR-C03 — Daemon graph read API

**Add bounded IPC operations**

- `graph_snapshot`;
- `graph_expand`;
- optional `graph_trace` if needed by first UI slice.

**Store/query work**

Add projection-specific read methods to `coordination-store` as necessary. Do not let projection code issue ad hoc SQL from UI-facing layers.

**Client**

Extend `coordination-client` with typed graph reads.

**Tests**

- daemon/client integration;
- project/worktree authorization;
- frame/output limits;
- provider degradation;
- cancellation where applicable.

**Exit Gate C1:** authoritative bounded graph snapshots available without a UI.

---

## 8. Phase 3 — First qualified PN6 tasks from B/C work

Do not count PR-01/02 instrumentation work toward the primary PN6 result. Begin qualification on product tasks after the harness is fixed.

### Candidate task pool OT-011…OT-020

Use only tasks that meet size/independence criteria. Proposed pool:

| Candidate | Workload | Track |
|---|---|---|
| OT-011 | receipt/code-state provenance reconciliation | B |
| OT-012 | provenance change-set report | B |
| OT-013 | code graph projection | C |
| OT-014 | impact graph projection | C |
| OT-015 | work graph projection | C |
| OT-016 | lineage graph projection | C |
| OT-017 | local admission subject builder | B |
| OT-018 | host policy bundle generation | B |
| OT-019 | local portal graph endpoint/view integration | C |
| OT-020 | MCP Apps graph integration | C |

A candidate ID is not automatically promotion-eligible. The task must be pre-registered and pass experimental validity checks.

### PN6 arm definition

```text
Control   = same my-pi mutation/provenance environment, impact-aware routing disabled
Treatment = same environment, impact-aware routing enabled
```

### Required adjudication

- downstream tests selected before run;
- reviewer/evaluator independent from implementation session;
- accepted output or explicit failed attempt;
- relevant dependency ground truth derived from accepted implementation/tests/reviewer, not treatment routes.

### Aggregation checkpoint

After several qualified tasks, run a non-promoting interim report. Do not synthesize a passing PN6 envelope until the predeclared sample/task diversity target is reached.

---

## 9. Phase 4B — Track B Admission

### PR-B04 — Canonical admission subject

**Purpose:** create a cross-platform Git/GitHub-verifiable change-set identity.

**Implement**

- canonical path normalization using Git path bytes/normalized representation;
- include change status, resulting blob OID/ABSENT, mode;
- stable sorting;
- explicitly exclude `.my-pi/provenance/**` from subject;
- include base commit and repository identity.

**Golden tests**

- Windows/Linux/macOS fixture vectors produce identical digest;
- create/modify/delete/rename;
- executable bit changes;
- symlink entries;
- Unicode path normalization policy explicitly tested;
- provenance file addition does not alter subject.

### PR-B05 — Local admission verifier

**Purpose:** verify Git subject against local verified provenance.

**Outputs**

```json
{
  "decision": "allowed|rejected|review_required",
  "base": "...",
  "head": "...",
  "subjectDigest": "...",
  "paths": [
    {"path":"...","decision":"...","reasonCodes":["..."]}
  ]
}
```

**Policy**

- fail closed on source `unknown`/`unmanaged`/`stale_lineage` in strict mode;
- generated/evidence exemptions explicit;
- report mode never changes files.

### PR-B06 — Signing authority and attestation

**Purpose:** make local proof portable to CI.

**Implementation**

- generate/import Ed25519 authority identity;
- private key stored in per-user runtime/config directory outside workspace;
- strict filesystem permissions/ACL best effort per OS;
- public key registration/config in repo or project policy;
- sign canonical admission subject plus covered receipt digests;
- write attestation under `.my-pi/provenance/`.

**Security tests**

- private key path rejected by my-pi workspace tools;
- modified attestation invalid;
- modified source blob invalid;
- wrong public key invalid;
- old base/head invalid;
- adding/changing source after seal invalid;
- adding attestation itself does not create circular digest.

### PR-B07 — GitHub report-mode workflow

**Add**

- `.github/workflows/my-pi-admission.yml` or integrate a distinct named job into CI;
- verifier runs with repository read access;
- emits `my-pi/admission` check/job;
- initially not required by repository rules.

**Gate**

Run seeded bypass PRs/branches and prove report-mode results are correct before enforcing.

---

## 10. Phase 4C — Track C Visual Surfaces

### PR-C04 — Shared browser graph view

**Dependencies**

- Cytoscape.js pinned version;
- existing esbuild for bundling;
- avoid React/Vite in first slice.

**Add**

- `apps/my-pi-ui/view/` or a reusable UI source directory;
- browser entry;
- graph renderer adapter;
- graph filters/evidence inspector;
- build script that outputs self-contained local assets.

**UI behaviors**

- pan/zoom;
- select;
- filter node/edge kind;
- expand;
- trace path;
- inspect evidence and reason codes;
- graph-kind tabs;
- truncation/degraded banner;
- no mutation controls.

**Performance benchmark**

Add synthetic and recorded snapshot fixtures at 500/1,000/2,000 nodes and representative edge density.

### PR-C05 — Local portal bridge

**Add app**

- `apps/my-pi-ui` Node launcher/server;
- `coordination-client` bridge;
- loopback-only HTTP API;
- random session token;
- Host/Origin validation;
- CSP and locally bundled assets.

**Security tests**

- bind request for `0.0.0.0` rejected by default;
- invalid host/origin/token rejected;
- arbitrary database/file path parameters rejected;
- static assets do not load third-party network resources.

### PR-C06 — MCP Apps compatibility spike

**Before full integration**

- add `@modelcontextprotocol/ext-apps` in an isolated experimental adapter path;
- use official basic-host/conformance route;
- prove compatibility with pinned `@modelcontextprotocol/server` v2.0.0 and current host-probe era;
- prove default 13-tool catalog unchanged when visuals flag off;
- prove unsupported host degrades without initialization failure.

**Stop condition**

If the extension requires a core SDK/protocol migration that would alter the blocking era, defer MCP Apps and ship local portal first; open a separate protocol migration workstream.

### PR-C07 — MCP Apps graph adapter

After spike passes:

- register `ui://my-pi/graph` resource behind `--visuals`;
- return GraphSnapshot to the view;
- use app-only UI helper tools for bounded expand/trace if supported;
- reuse the exact shared browser artifact from PR-C04;
- add basic-host + supported real-host tests.

---

## 11. Phase 5B — Host policy and hard enforcement maturation

### PR-B08 — Policy bundle model

Extend host profiles without changing legacy `renderProfile()` semantics.

Add an explicit experimental policy-bundle API that can emit:

- MCP config;
- host permissions/rules artifact or CLI flags;
- maturity declaration;
- known unenforced paths;
- required verification exceptions/allowlist.

### PR-B09 — OpenCode strict candidate

Use explicit deny for native edit paths and deny/restrict shell mutation while preserving required verification path.

**Bypass suite**

- native edit;
- shell redirect/write;
- scripted write;
- alternate MCP filesystem server configuration where policy controls it;
- git apply/checkout-style mutation attempt;
- direct source change followed by attempted seal.

Expected: mutation blocked or admission fails.

### PR-B10 — Claude Code strict candidate

Generate documented allowed/disallowed tool policy/CLI bundle. Validate exact tool names empirically for the current supported host version.

Expected: direct source mutation blocked or admission fails; my-pi MCP mutation remains usable; required verification path remains available.

### PR-B11 — Cursor/Copilot managed profiles

Do not label strict unless empirical bypass tests justify it. Render MCP/terminal/enterprise settings supported by each platform and document residual native mutation paths.

### PR-B12 — Activate repository ruleset

Only after report-mode and strict-profile bypass evidence is green:

- require PR before merge;
- require current CI/CodeQL checks as appropriate;
- require `my-pi/admission`;
- select expected check source where feasible;
- disable or explicitly document bypass actors;
- rerun a seeded bypass PR and prove merge is blocked.

**Important:** ruleset activation is an operational repository setting, not merely a code change. Record configuration evidence.

---

## 12. Phase 6 — PN8 repair experiments

Use naturally occurring failing states from B/C implementation rather than manufacturing only synthetic failures.

### Repair-pair procedure

1. Freeze one failing implementation commit/tree and exact EvaluationSpec.
2. Run independent evaluation and record failing criteria/prior passes.
3. Clone two repair worktrees from the same failing state.
4. Control receives ordinary logs/test output only.
5. Treatment receives structured FeedbackPacket only plus equivalent task statement.
6. Use fresh sessions and same host/model configuration where possible.
7. Run identical independent downstream evaluation.
8. Record repair yield, attempts, prior-pass preservation, regressions, false accepts.

### Eligibility rules

- no arm may see the other's repair;
- task must be nontrivial and real;
- evaluator result cannot be caller-declared unverified evidence;
- accepted treatment must preserve prior passes;
- every false accept is a gate failure, not an averageable nuisance.

---

## 13. Phase 7 — Evidence aggregation and Production Next decision

### PR-A03 — Observed evidence aggregator

Add a read-only/derivation script that:

- reads only validated ObservedTask v2 results;
- checks independent run IDs;
- rejects contaminated/incomplete tasks;
- computes PN6 aggregate arms;
- computes PN8 aggregate arms;
- records observation source/task IDs;
- emits candidate `evidence/PN6.json` and `evidence/PN8.json` with exact current candidate state binding only when requested.

### Final qualification procedure

On a clean final candidate:

1. `pnpm verify`
2. regenerate PN6/PN8 from observed replay inputs;
3. rerun stable N-1 PN9 evidence;
4. rerun PN12 local reliability evidence;
5. `pnpm verify:production-next-evidence`
6. `node scripts/verify-production-next-promotion.mjs`

**Decision rule:**

- exit 0 / `promotionEligible: true` -> PN11 entry may be reconsidered;
- otherwise -> keep PN11 withheld and address only the reported evidence/qualification gap.

Do not weaken the verifier to match available results.

---

## 14. File/package impact summary

### New likely paths

```text
packages/
  graph-model/
  graph-projection/

apps/
  my-pi-ui/

dogfood/
  schema/
  observed-tasks/          # v2 files coexist with existing records

scripts/
  validate-observed-task-v2.mjs
  dogfood-observed-paired-v2.mjs
  aggregate-observed-production-next.mjs
  verify-my-pi-admission.mjs
  seal-my-pi-admission.mjs

.my-pi/
  provenance/              # signed public attestations only; never private key
```

### Existing likely modifications

```text
packages/contracts/                 experimental provenance/event contracts
packages/change-runtime/            lineage/admission helper extensions
packages/code-state/                observation integration if reusable
packages/coordination-store/        provenance + graph projection reads/migration
packages/coordination-client/       typed graph/provenance IPC
packages/mcp-adapter/               optional visuals adapter/metadata
packages/host-profiles/             experimental policy bundle generation
apps/my-pi-daemon/                  graph/provenance operations and reconciliation
apps/my-pi-mcp/                     --visuals composition, no default behavior change
scripts/bundle-app.mjs              or sibling UI bundle script using esbuild
.github/workflows/                  report-mode admission job
```

Do not create a new package when a cohesive existing package owns the behavior. `graph-model` and `graph-projection` justify packages because they must remain host/protocol/UI neutral.

---

## 15. Test matrix

| Layer | Required tests |
|---|---|
| Legacy MCP | exact 13 tools/schemas unchanged |
| ObservedTask v2 | schema, pre-registration, isolation, contamination, run identity |
| Provenance | managed/unmanaged/stale/unknown/exempt; partial receipts; worktree policy |
| Admission subject | cross-platform golden vectors; file modes; rename/create/delete; provenance exclusion |
| Signing | valid/wrong key/tamper/stale/extra path/missing path |
| Graph model | type/schema/bounds |
| Graph projections | determinism/evidence/cycles/truncation/sensitive paths |
| Daemon/client | graph/provenance bounded IPC; degradation/cancellation |
| Portal | loopback/token/origin/CSP/no external CDN |
| MCP Apps | extension spike/basic-host/real supported host/progressive fallback |
| Host strict | seeded bypass suite per host/version |
| CI admission | report-mode positive/negative PR fixtures |
| PN6 | same-variable paired experiments + independent adjudication |
| PN8 | same-failure paired repairs + prior-pass preservation |
| Release | existing full verify + PN evidence + promotion verifier |

---

## 16. PR dependency graph

```text
PR-00
  |
  +--> PR-01 --> PR-02 -------------------------------+
  |                                                   |
  +--> PR-B01 --> PR-B02 --> PR-B03                  |
  |                                                   +--> PN6 task set
  +--> PR-C01 --> PR-C02 --> PR-C03                  |
                                                      |
                     +--------------------------------+
                     |
        +------------+----------------+
        |                             |
        v                             v
   PR-B04..B07                   PR-C04..C07
        |                             |
        v                             v
   PR-B08..B12  <------ more observed B/C workloads
        |
        +---------------------+
                              v
                        PN8 repair pairs
                              |
                              v
                           PR-A03
                              |
                              v
                    promotion verifier
                              |
                    +---------+---------+
                    |                   |
                 WITHHELD          ENTRY_READY
                                        |
                                       PN11
```

---

## 17. First implementation slice

The first slice after approving this plan should be deliberately small:

1. PR-00 baseline ADR.
2. PR-01 ObservedTask v2 schema/validator.
3. PR-02 paired harness foundation.
4. Start PR-B01 and PR-C01 in parallel worktrees, both operated through stable my-pi authority.
5. Do **not** count PR-01/02 as PN6 product-value evidence.

This establishes the measurement system before the program starts consuming the very workloads it intends to use as evidence.

---

## 18. Completion checklist

- [ ] Legacy default catalog still exactly 13 tools.
- [ ] ObservedTask v2 validator and paired runner green.
- [ ] B0/B1 provenance classification green.
- [ ] Graph core deterministic and bounded.
- [ ] First PN6-qualified tasks executed with valid controls.
- [ ] Local admission report green on managed changes / red on seeded bypass.
- [ ] Shared portal displays four graph kinds.
- [ ] MCP Apps spike passes without core-era migration or is explicitly deferred.
- [ ] Signed admission attestation validated cross-platform.
- [ ] At least one host reaches strict-certified candidate status via bypass suite.
- [ ] GitHub admission runs in report mode with no unexplained passes.
- [ ] Repository ruleset activated only after admission qualification.
- [ ] PN8 frozen-failure pairs executed.
- [ ] PN6/PN8 observed evidence generated from eligible records.
- [ ] PN9 rerun with distinct stable N-1 authority for final candidate.
- [ ] PN12 rerun; untested faults remain explicit.
- [ ] Promotion verifier run unchanged.
- [ ] PN11 started only if promotion is admitted.
