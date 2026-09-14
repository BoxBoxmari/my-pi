# my-pi Self-Hosted Development Program — Technical Research & Technical Plan

**Status:** Proposed technical baseline  
**Date:** 2026-09-13  
**Repository baseline inspected:** `BoxBoxmari/my-pi` at `835232d0b6b205027c4d35ac6203b31dd3ba76d3`  
**Program:** Track B (Enforcement) + Track C (Visual Plane) executed as real workloads for Track A (Production Next evidence)

---

## 1. Executive decision

Proceed with one self-hosted development program that builds Track B and Track C with my-pi while using the resulting engineering work as observed workloads for Track A. Do **not** equate dogfooding with promotion evidence. Every task counted toward PN6 or PN8 must be pre-registered, isolated, independently adjudicated, and designed with a valid control/treatment comparison.

The proposed architecture is:

```text
Coding Agent / Host
        |
        v
     my-pi MCP -----------------------------+
        |                                    |
        v                                    v
Stable capability layer             Production Next opt-in
(fs/search/AST/LSP/VCS)        coordination / code-state / impact
                                            |
                         +------------------+------------------+
                         |                                     |
                         v                                     v
               Track B: Enforcement                  Track C: Visual Plane
               mutation provenance                  graph projection
               admission evidence                   MCP Apps + local portal
                         |                                     |
                         +------------------+------------------+
                                            |
                                            v
                                 ObservedTask v2 harness
                                            |
                            control / treatment / adjudication
                                            |
                                            v
                              PN6 / PN8 / PN9 / PN12 evidence
```

Three constraints are non-negotiable:

1. **The frozen 13-tool legacy surface remains unchanged in default mode.** Track B/C additions are opt-in and must not break the existing compatibility test.
2. **Candidate my-pi cannot be the sole authority that certifies candidate my-pi.** Stable N-1 authority and independent downstream tests remain part of the trust model.
3. **Track B claims mutation authority, not universal tool monopoly.** my-pi currently has no general-purpose execution capability. Build/test may use predeclared evaluator/harness operations or narrowly allowed host commands; source mutation must be attributable to my-pi for strict-mode admission.

---

## 2. Strongest case against the proposed program

The self-hosting thesis can fail for four independent reasons.

### 2.1 Circular evidence

If the candidate generates its own task context, performs the change, evaluates the change, and emits the evidence used to promote itself, the evidence is structurally circular. A green result would show internal consistency, not independent product value.

**Required countermeasure:** preserve the existing stable-N-1 pattern. The candidate is the subject; a distinct stable predecessor acts as coordination/evaluation authority where promotion evidence requires it; independent test commands and GitHub checks adjudicate outcomes.

### 2.2 Confounded experiments

If a treatment arm enables impact routing, strict host permissions, structured feedback, and a different UI simultaneously, an outcome difference cannot be attributed to PN6 or PN8.

**Required countermeasure:** one manipulated variable per primary experiment. Example: for PN6 both arms use the same host policy and my-pi mutation path; only impact-aware routing differs.

### 2.3 Remote admission has no proof of local transition

The current `ChangeReceipt` captures input/output fingerprints and composite publication results, but CI on GitHub does not have the developer's local SQLite state. A CI script that checks only the final Git tree cannot prove that the transition happened through my-pi.

**Required countermeasure:** introduce a portable, signed admission attestation that covers the exact changed-path/blob set and references verified receipt lineage. GitHub recomputes the subject digest and verifies the attestation. Until that exists, admission is observational/local and must not be marketed as hard remote enforcement.

### 2.4 Strict host policy can make the agent unusable

The stable 13-tool surface deliberately exposes no unrestricted shell. If Track B simply denies Bash/terminal/edit tools, an agent may lose the ability to build or run tests.

**Required countermeasure:** define strict mode as **authoritative mutation + provenance**, not “all operations must use my-pi.” Reads can remain host-native where appropriate. Build/test must use either predeclared experiment commands, registered evaluator providers, or narrowly scoped host terminal permissions. General source mutation outside my-pi remains disallowed in strict-capable profiles.

---

## 3. Codebase findings

### 3.1 Stable compatibility boundary

The repository locks the default MCP catalog to exactly 13 tools in `test/compat/legacy-tool-catalog.test.mjs`. The test instantiates `MyPiServer`, calls `listTools()`, and compares both names and schemas. Therefore Track C must not silently add graph tools to default mode.

### 3.2 Production Next is already substantially implemented

Existing packages include `coordination-runtime`, `coordination-store`, `code-state`, `impact-engine`, `context-router`, `change-runtime`, and `evaluation-runtime`. The daemon is the local per-project authority and coordination/evaluation remain opt-in.

The remaining PN11 blocker is not missing architecture. The repository status explicitly withholds promotion because PN6/PN8 lack sufficient observed outcome evidence.

### 3.3 Code-state is already a graph source

`CodeEntity` already supports repository/module/file/symbol/test nodes. `CodeEdge` already supports `contains`, `imports`, `references`, `calls`, and `tests`, with confidence and provider provenance. Track C should project these contracts rather than invent a second code graph model.

### 3.4 Impact is already projection-friendly

`ImpactResult` contains affected work items, agents, entities, reason codes, graph version, confidence, and truncation. This is already suitable for an evidence-backed impact graph.

### 3.5 Change lineage is strong enough to extend, not replace

`ChangeProposal` and `ChangeReceipt` already include project/worktree/session/work-item/intent references, complete resources, preconditions, plan digest, input/output versions, per-resource outcomes, verification, and receipt digest. `ChangeRuntime.applyMany()` canonicalizes and sorts a batch and emits first-class `PARTIAL` results.

The missing part for Track B is not another mutation engine. It is:

- classification of managed vs unmanaged observed mutations;
- portable provenance/admission representation;
- a verifier that binds Git changes to receipt lineage;
- host policy generation;
- repository governance that requires the admission check.

### 3.6 An admission domain concept already exists but is not yet a policy engine

`packages/contracts/src/change.ts` already defines `AdmissionDecision` with `allowed | rejected | review_required`. However current `change-runtime/src/admission.ts` only checks content preconditions. This is a natural extension seam, but Git/PR admission should not be collapsed into CAS precondition checking.

### 3.7 Observed-task infrastructure should be evolved, not replaced

The repository already has `OT-001` through `OT-010` and `scripts/dogfood-observed-paired-review.mjs`. OT-008/009/010 record stable authority, implementation/reviewer/observer sessions, a baseline route arm, an intent-aware arm, deterministic replay, and downstream tests.

The missing promotion evidence is downstream repair/rework measurement and a controlled ordinary-log versus structured-feedback repair comparison. Therefore build `ObservedTask v2` as a backward-compatible research harness around this existing practice.

### 3.8 Host profiles are an existing product seam

`@my-pi/host-profiles` already supports Claude Code, OpenCode, Cursor, Antigravity, and GitHub Copilot dialects, with coordination variants. Track B should add explicit experimental policy bundles rather than hard-code platform behavior into capability logic.

### 3.9 Current GitHub governance does not yet enforce the desired authority

At the inspected baseline, `main` is not protected and no required status checks are enforced at the branch protection level. Current CI is green across Windows Node 24, Ubuntu Node 22/24, macOS Node 24, and CodeQL, but CI success is not equivalent to branch enforcement.

---

## 4. External technical research

### 4.1 MCP Apps is now a stable extension

MCP Apps specification `2026-01-26` is stable. It lets a tool declare a `ui://` HTML resource, lets compatible hosts render the UI in a sandboxed iframe, and supports bidirectional tool/UI interaction. It is explicitly designed as progressive enhancement: baseline tool behavior can continue for hosts without UI support.

This directly supports Track C without requiring host-specific visualization implementations.

**Decision:** use MCP Apps for in-host visualization, but do not make it the only UI because client support varies. The current official matrix lists Claude, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT, and Cursor support status separately; OpenCode is not a safe universal assumption.

### 4.2 Do not bundle a core MCP-era migration into Track C

The repository currently pins `@modelcontextprotocol/core` and `@modelcontextprotocol/server` 2.0.0 and records an empirically observed older MCP era. The 2026-07-28 core spec introduced substantial lifecycle changes. Changing the core protocol era while introducing visual extensions would create a compatibility confound.

**Decision:** add MCP Apps behind a capability/feature gate using the current server line where supported. Treat any core MCP-era upgrade as a separate compatibility project with its own host probes.

### 4.3 Host enforcement capabilities are asymmetric

- **OpenCode:** explicit permission rules support `allow`, `ask`, and `deny`; explicit deny remains enforced in auto mode. This is suitable for a strict mutation profile.
- **Claude Code:** `--allowedTools` and `--disallowedTools` plus settings/permission tooling can constrain tool use. This can support a strict mutation profile, subject to empirical host certification.
- **Cursor:** `permissions.json` provides MCP and terminal allowlists, but it should not be assumed to disable every native agent filesystem/edit path. Treat Cursor as managed/monitored until empirical enforcement tests prove otherwise.
- **GitHub Copilot:** enterprise managed settings can allow/deny MCP servers and enforce sandbox controls, but MCP allowlisting alone does not prove all native source mutation traverses my-pi.

**Decision:** maintain a capability matrix: `strict-capable`, `managed`, `monitoring`. Do not claim cross-platform mandatory enforcement until each host passes bypass tests.

### 4.4 GitHub can enforce required checks, but source identity matters

GitHub rulesets can require pull requests, required status checks, and expected status sources from a specific GitHub App. This is the correct merge boundary for Track B after portable provenance exists.

**Decision:** `my-pi/admission` becomes a required check only after it can independently validate an admission attestation bound to the current PR subject digest. Before then it operates in report-only mode.

### 4.5 Graph rendering library choice

Options considered:

| Option | Strength | Weakness | Decision |
|---|---|---|---|
| Cytoscape.js | Mature graph semantics, directed/compound graphs, multiple layouts, good interaction API | Canvas-based; very large graphs require care | **V1 choice** |
| Sigma.js + Graphology | WebGL, excellent for thousands+ of nodes | Less opinionated semantic/compound layout UX; v4 line still moving | Reserve for scale fallback |
| React Flow | Excellent node-editor UX | Optimized for editable node-flow applications rather than analytical code graphs | Reject for V1 |
| D3 custom | Maximum control | Highest engineering/maintenance cost | Reject for V1 |

Cytoscape.js aligns with V1's bounded local graph model. The renderer must remain behind an adapter so Sigma.js can replace it if benchmarks show the need.

### 4.6 Front-end build tooling

The repository already locks esbuild and uses it for the distributable CLI. Adding Vite solely for Track C would increase supply-chain surface.

**Decision:** initially build a framework-light TypeScript browser bundle with existing esbuild and Cytoscape.js. Generate one UI artifact that can be served by the local portal and exposed as an MCP Apps resource. Reconsider a framework only if UI complexity demonstrates a concrete need.

---

## 5. Options considered

### Option A — Build B/C first, collect evidence later

**Rejected.** This repeats the failure mode that current PN6/PN8 status is trying to prevent: implementation existence is mistaken for product-value evidence.

### Option B — Full experiment platform before any product work

**Rejected.** It risks overbuilding research infrastructure before there are enough new workloads. The current dogfood scripts already provide most primitives.

### Option C — Minimal ObservedTask v2 harness, then build B/C through it

**Selected.** Add only the controls needed to generate promotion-quality evidence: pre-registration, isolation, arm definition, environment identity, downstream adjudication, metrics, and aggregation.

---

## 6. Target architecture

```text
                                  +------------------------+
                                  | Coding Agent / Host    |
                                  +-----------+------------+
                                              |
                                  MCP / host policy bundle
                                              |
                                              v
+--------------------------------------------------------------------------------+
|                                 my-pi MCP                                      |
|                                                                                |
| Stable default mode                          Opt-in Production Next / visuals    |
| 13 tools                                     coordination/evaluation/visuals     |
+----------------------------+--------------------------------+------------------+
                             |                                |
                             v                                v
                     Workspace Runtime                 Coordination Client
                             |                                |
        +--------------------+------------------+             |
        |                    |                  |             v
        v                    v                  v      Local my-pi-daemon
  FS / Search            AST / LSP             VCS            |
                                                              |
                                      +-----------------------+------------------+
                                      |                       |                  |
                                      v                       v                  v
                                  Code State              Work State         Change/Eval
                                      |                       |                  |
                                      +-----------+-----------+------------------+
                                                  |
                                                  v
                                         Graph Projection
                                                  |
                              +-------------------+-------------------+
                              |                                       |
                              v                                       v
                       MCP Apps adapter                         Local UI portal
                       ui:// resources                         loopback-only bridge

Track B side-channel:
ChangeReceipt -> Provenance classification -> Admission attestation -> CI verifier
                                                            |
                                                            v
                                                   GitHub required check
```

---

## 7. Track A — ObservedTask v2 experimental harness

### 7.1 Design principle

Experiment infrastructure is development-only and must not become a public runtime dependency. Keep schemas and runners under `dogfood/` and `scripts/` unless reuse pressure proves a package is necessary.

### 7.2 Task pre-registration

Each qualifying task definition is committed before either arm runs and contains:

- task ID and task class;
- base commit SHA;
- immutable acceptance specification;
- allowed target scope and known exclusions;
- primary hypothesis (`PN6`, `PN8`, or neither);
- control/treatment profiles;
- required independent tests;
- metric definitions;
- contamination controls;
- adjudication procedure.

A task cannot be retroactively upgraded to promotion evidence by editing the task definition after results are known.

### 7.3 Run isolation

Each primary arm must use:

- a fresh worktree from the same base SHA;
- a fresh agent session;
- the same host family/model configuration where observable;
- no shared conversation context;
- no access to the other arm's artifacts;
- stable N-1 authority when the gate requires it.

### 7.4 PN6 experiment

Primary comparison:

```text
Control:   my-pi mutation/provenance policy + impact routing OFF
Treatment: my-pi mutation/provenance policy + impact routing ON
```

Measure:

- adjudicated relevant dependency set;
- routing recall;
- routing precision;
- missed dependencies;
- false positives;
- repair iterations to accepted result;
- downstream rework;
- regressions introduced;
- route volume/context bytes (secondary efficiency metric).

Do not vary strictness, UI, model, or evaluation format in the same primary PN6 comparison.

### 7.5 PN8 experiment

Create one frozen failing implementation state, then fork two repair worktrees:

```text
Control repair:   ordinary test/log handoff
Treatment repair: structured FeedbackPacket
```

Measure:

- repair yield;
- number of repair attempts;
- accepted repair count;
- prior passing criteria preserved;
- new regressions;
- false accepts;
- unresolved/inconclusive outcomes.

### 7.6 Ground truth

Ground truth comes from independent acceptance tests and adjudication, not from agent self-report. A test/reviewer result must be recorded as a separate run identity.

### 7.7 Evidence generation

Add an aggregator that converts eligible ObservedTask v2 results into candidate `PN6.json` and `PN8.json` envelopes. Keep `verify-production-next-promotion.mjs` read-only and independent. The aggregator may produce evidence; it must not relax or rewrite the verifier.

---

## 8. Track B — Enforcement Plane

### 8.1 Scope correction

The target claim is:

> **In a certified strict profile, source mutations admitted for merge are attributable to verified my-pi mutation lineage.**

The target claim is **not**:

> Every read, search, build, test, shell action, or IDE operation is executed by my-pi.

### 8.2 Enforcement maturity levels

| Level | Name | Behavior |
|---|---|---|
| B0 | Observe | Detect and classify mutations; never block |
| B1 | Provenance | Persist verified managed lineage and unmanaged observations |
| B2 | Local admission | Local/pre-push report checks changed files against lineage |
| B3 | Host strict profiles | Remove common alternate mutation paths where host supports enforceable deny rules |
| B4 | Signed remote admission | Produce portable signed attestation; GitHub verifies exact PR subject |
| B5 | Repository enforcement | Ruleset requires `my-pi/admission`; bypass tests become release-blocking |

### 8.3 Mutation classification

A code-state change is classified as:

- `managed`: current fingerprint matches a verified my-pi receipt output bound to the worktree;
- `unmanaged`: observed change has no matching verified receipt lineage;
- `stale_lineage`: matching lineage exists but parent/input state does not match expected ancestry;
- `unknown`: insufficient state to classify safely;
- `exempt`: explicitly non-source/generated path allowed by policy.

Fail closed for strict admission on `unmanaged`, `stale_lineage`, or `unknown` source changes.

### 8.4 Portable admission subject

Avoid signing the Git commit that contains its own attestation. Define a canonical **Admission Subject Digest** over the PR change set excluding the provenance artifact directory:

```text
SHA256(
  schemaVersion ||
  repositoryIdentity ||
  baseCommit ||
  sorted[
    path || status || fileMode || resultingGitBlobOid-or-ABSENT
  ]
)
```

The attestation can then be committed under `.my-pi/provenance/` without a circular hash dependency because that directory is excluded from the subject digest by specification.

### 8.5 Admission attestation

Candidate structure:

```ts
interface AdmissionAttestation {
  schemaVersion: "1";
  repositoryIdentity: string;
  baseCommit: string;
  headCommit: string;
  subjectDigest: string;
  receipts: Array<{
    receiptId: string;
    receiptDigest: string;
    paths: string[];
  }>;
  authority: {
    keyId: string;
    algorithm: "ed25519";
  };
  issuedAt: string;
  signature: string;
}
```

The signer key must be outside the workspace and unavailable through my-pi filesystem capabilities. Hard-enforcement claims additionally require host/sandbox controls that prevent the agent from reading or replacing the signer key.

### 8.6 CI admission verifier

CI recomputes the admission subject from Git objects, verifies the signature using an approved public key, checks receipt/path coverage, rejects extra source changes, and emits one result:

- `PASS` — every required source mutation is covered;
- `FAIL` — unmanaged/stale/unknown or invalid attestation;
- `REVIEW_REQUIRED` — explicitly configured manual-review class.

### 8.7 Host profiles

Do not break current profile IDs. Add experimental policy bundles:

- `claude-code-local-strict` — candidate strict mutation profile;
- `opencode-local-strict` — candidate strict mutation profile;
- `cursor-local-managed` — managed profile until native edit bypass is empirically closed;
- `copilot-*-managed` — managed/enterprise profiles based on available policy surface.

Each bundle must describe what it can actually enforce. A profile cannot be labeled strict until an automated bypass suite proves that direct source mutation paths fail or are caught by admission.

### 8.8 Build/test operations

For self-hosted experiments, predeclare build/test commands in the ObservedTask definition and execute them from the harness, not from arbitrary model-provided shell text. For normal interactive use, host-native terminal commands may remain narrowly allowed until a safe registered evaluator execution path exists.

---

## 9. Track C — Visual Plane

### 9.1 Core principle

The UI is a view over authoritative state. It does not infer architecture with an LLM and does not read SQLite directly.

### 9.2 Graph model

Create `packages/graph-model` with protocol-neutral, bounded contracts:

```ts
type GraphKind = "code" | "impact" | "work" | "lineage" | "experiment";

type GraphScalar = string | number | boolean | null;

interface GraphNode {
  id: string;
  kind: string;
  label: string;
  state?: string;
  group?: string;
  attributes?: Record<string, GraphScalar>;
  evidenceRefs: string[];
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  directed: boolean;
  confidence?: number;
  attributes?: Record<string, GraphScalar>;
  evidenceRefs: string[];
}

interface GraphSnapshot {
  schemaVersion: "1";
  graphKind: GraphKind;
  projectId: string;
  worktreeId?: string;
  revision: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  limits: { maxNodes: number; maxEdges: number; maxBytes: number };
  cursor?: string;
}
```

### 9.3 Projection layer

Create `packages/graph-projection` with deterministic projectors:

- `projectCodeGraph(CodeEntity[], CodeEdge[])`;
- `projectImpactGraph(Intent, ImpactResult, CodeEntity[])`;
- `projectWorkGraph(WorkItem[], Intent[], AgentSession[], WorkDependency[])`;
- `projectLineageGraph(ChangeProposal/Receipt, EvaluationRun, FeedbackPacket, RetryCycle)`;
- later: `projectExperimentGraph(ObservedTaskV2)`.

Every node/edge must carry evidence references back to authoritative records.

### 9.4 Daemon API

Expose bounded read-only IPC operations:

- `graph_snapshot`;
- `graph_expand`;
- `graph_trace`;
- `graph_compare` (defer if not needed by first UI slice).

The daemon composes persisted projections and projection functions. UI clients never query raw SQLite tables.

### 9.5 Shared browser view

Use a single browser bundle built with existing esbuild and Cytoscape.js. No React dependency in the first slice.

Required interactions:

- pan/zoom;
- filter by node/edge kind;
- select node/edge;
- evidence inspector;
- expand bounded neighborhood;
- trace dependency/lineage path;
- switch graph kind;
- show truncation/degraded-state banner;
- copy stable identifiers.

V1 is read-only.

### 9.6 MCP Apps adapter

Behind `--visuals`, register UI resource(s) using MCP Apps. Prefer app-only helper tools for UI expansion/filter actions where supported, so model context does not need to expose every UI interaction.

Default legacy mode remains exactly 13 tools. Add compatibility tests for both:

- default mode: exactly current catalog;
- visuals mode: extra experimental UI metadata/resources do not modify stable tool schemas.

### 9.7 Local portal fallback

Add `apps/my-pi-ui` as a separate local process:

```text
browser -> loopback HTTP -> my-pi-ui bridge -> CoordinationClient IPC -> daemon
```

Security requirements:

- bind only to `127.0.0.1` / `::1`;
- random per-launch session token;
- strict Host and Origin validation;
- restrictive CSP;
- no public TCP binding;
- no direct database path accepted from browser;
- read-only V1 API;
- no outbound network dependency for graph rendering.

The portal serves the same built browser artifact used by the MCP App view.

---

## 10. Performance and bounds

Initial candidate targets, to be benchmarked rather than assumed:

| Area | Candidate target |
|---|---|
| Graph snapshot | p95 <= 250 ms for 2,000 nodes / 5,000 edges on local benchmark profile |
| Snapshot payload | default <= 2 MiB; truncate with cursor/limits rather than unbounded output |
| Neighborhood expansion | p95 <= 100 ms from persisted state for bounded expansion |
| UI first useful render | <= 1 s after snapshot receipt for 2,000/5,000 profile |
| Admission verification | <= 2 s for <= 500 changed paths on local CI benchmark profile |
| ObservedTask harness | deterministic metadata/schema output for identical frozen inputs |

If UI benchmarks exceed the bounded profile, first reduce graph scope and use progressive expansion. Move to Sigma.js only if a representative workload demonstrates Cytoscape.js is the bottleneck.

---

## 11. Security and trust model

### Trust boundaries

1. **Agent input is untrusted.** Agent-supplied labels remain attribution, not authentication.
2. **Candidate runtime is not independent evidence authority.** Stable N-1 remains required where current promotion contract requires it.
3. **UI input is untrusted.** Graph filters/IDs are validated and bounded server-side.
4. **Final Git state is not proof of mutation provenance.** Signed admission evidence is required for hard remote enforcement.
5. **Signer key must not be workspace-readable.** Strict certification includes key-exfiltration bypass tests.
6. **Generated graph state cannot bypass sensitive-path policy.** Graph projection only uses code-state already authorized by workspace policy.

### Explicit non-goals

- no unrestricted shell tool added to the 13-tool surface;
- no hosted coordination control plane;
- no autonomous agent spawning;
- no chat product;
- no write actions from Visual Plane V1;
- no Twilio messaging/voice integration;
- no core MCP protocol-era migration in the same change set.

---

## 12. Qualification gates

### Gate H — Experimental harness ready

- ObservedTask v2 schema versioned and validated;
- immutable task pre-registration enforced;
- paired worktrees isolated;
- environment/run identity captured;
- independent adjudication recorded;
- contamination checks implemented.

### Gate B0/B1 — Provenance observational readiness

- managed/unmanaged classification tested;
- no retroactive receipt can silently convert an unmanaged mutation into managed lineage;
- receipt/output fingerprints reconcile with code-state observation;
- report-only mode never blocks normal legacy use.

### Gate C0/C1 — Graph core readiness

- deterministic snapshots;
- every graph element evidence-backed;
- sensitive paths remain absent;
- bounded/truncated output deterministic;
- no direct SQLite dependency in UI.

### Gate PN6 — Observed routing evidence

- promotion-eligible task set is heterogeneous and pre-registered;
- treatment recall >= control baseline;
- treatment average repair iterations < control baseline;
- false-positive/missed-dependency accounting preserved;
- evidence generated only from independent run IDs.

### Gate B4/B5 — Hard admission readiness

- signed attestation subject digest stable across platforms;
- CI rejects invalid/missing/stale signatures;
- CI rejects uncovered source blobs;
- signer key is outside workspace and bypass-tested;
- GitHub ruleset requires `my-pi/admission` from the expected check source;
- certified strict host cannot directly mutate source without admission failure.

### Gate PN8 — Structured feedback evidence

- structured feedback repair yield > ordinary-log handoff;
- every accepted structured repair preserves prior passes;
- seeded false accepts = 0;
- same frozen failing states are used per pair.

### Gate PN11

Run existing read-only promotion verifier. PN11 remains closed until `promotionEligible: true`.

---

## 13. Recommended execution sequence

1. Freeze baseline and introduce no product behavior change.
2. Build ObservedTask v2 harness and validator.
3. In parallel:
   - Track B: B0 mutation observation + B1 provenance contracts;
   - Track C: graph-model + graph-projection.
4. Add graph daemon reads and a shared read-only browser view.
5. Run first PN6-qualified paired tasks from real B/C work.
6. Add local admission report and host policy bundles.
7. Add MCP Apps adapter and local portal using the same graph artifact.
8. Introduce signed admission attestation, remote verifier, and bypass suite.
9. Enable GitHub required admission only after report-mode evidence is clean.
10. Run PN8 repair pairs on naturally occurring frozen failures from B/C work.
11. Aggregate observed evidence and rerun the existing promotion verifier.
12. Start PN11 only after the verifier admits entry.

---

## 14. Research questions that remain open until spikes

1. Does `@modelcontextprotocol/ext-apps` integrate cleanly with the repo's pinned v2 server packages without changing the empirically blocking protocol era?
2. Can one self-contained esbuild-generated HTML artifact satisfy both MCP Apps CSP/resource behavior and standalone portal needs without host-specific forks?
3. What is the smallest cross-platform canonical Git change-set representation that is stable enough for admission signatures (path normalization, modes, symlinks, renames)?
4. Which Claude Code/OpenCode policy combinations demonstrably prevent direct source mutation while keeping acceptable build/test feedback?
5. What evidence transport/check-source mechanism is sufficient for GitHub required-check trust without adding a hosted control plane?

Each question is a spike with a falsifiable exit criterion; none is assumed solved by documentation alone.

---

## 15. Sources

### Repository evidence

- `docs/ARCHITECTURE.md`
- `docs/CONTRACTS.md`
- `docs/HOST_COMPATIBILITY.md`
- `docs/production-next/IMPLEMENTATION_STATUS.md`
- `docs/production-next/OBSERVED_EVIDENCE.md`
- `PRE_PN11_CLOSEOUT_REPORT.md`
- `packages/contracts/src/code-entity.ts`
- `packages/contracts/src/change.ts`
- `packages/contracts/src/evaluation.ts`
- `packages/contracts/src/feedback.ts`
- `packages/change-runtime/src/runtime.ts`
- `packages/impact-engine/src/model.ts`
- `packages/host-profiles/src/profile.ts`
- `packages/host-profiles/src/render.ts`
- `test/compat/legacy-tool-catalog.test.mjs`
- `scripts/verify-production-next-promotion.mjs`
- `scripts/dogfood-observed-paired-review.mjs`
- `dogfood/observed-tasks/OT-008.result.json`

### External official / primary documentation

- MCP Apps overview and stable specification: https://modelcontextprotocol.io/extensions/apps/overview
- MCP Apps API/docs: https://apps.extensions.modelcontextprotocol.io/api/
- MCP Apps extension matrix: https://modelcontextprotocol.io/extensions/client-matrix
- MCP 2026-07-28 release notes: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- OpenCode permissions: https://opencode.ai/docs/permissions/
- Claude Code CLI permissions: https://docs.anthropic.com/en/docs/claude-code/cli-usage
- Cursor permissions: https://prod.cursor.com/docs/reference/permissions
- Cursor MCP controls: https://prod.cursor.com/docs/mcp
- GitHub ruleset rules: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- GitHub Copilot MCP management: https://docs.github.com/en/copilot/concepts/enterprise/mcp-management
- Cytoscape.js: https://js.cytoscape.org/
- Sigma.js: https://www.sigmajs.org/docs/
- React Flow: https://reactflow.dev/
