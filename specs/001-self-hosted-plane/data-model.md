# Data Model: Self-Hosted Enforcement, Visual Plane, and Measured Evidence

## ObservedTask v2

An immutable pre-registration record. The definition is bound to a definition commit and cannot be
replaced by a result.

| Field | Meaning | Validation |
|---|---|---|
| `taskId` | Stable task identity | Unique and immutable |
| `hypothesis` | `PN6`, `PN8`, or `none` | Promotion hypotheses require independent adjudication |
| `baseSha` | Frozen source base | Same for both arms |
| `taskClass` | Real engineering workload category | Must not be instrumentation-only for promotion |
| `acceptanceCriteria` | Predeclared success/failure rules | Non-empty and testable |
| `arms` | Control and treatment definitions | Exactly two; one declared primary variable |
| `arms.*.setupCommands` | Predeclared arm-specific setup that applies the primary variable | PN6/PN8 require divergent bounded setup commands; downstream tests remain common |
| `requiredTests` | Downstream tests selected before execution | Commands are predeclared and bounded |
| `adjudication` | Independent evaluator and ground-truth rule | Required for PN6/PN8 eligibility |
| `metrics` | Outcome and secondary measures | Must identify units and source |
| `contaminationControls` | Isolation and cross-arm controls | Must identify forbidden paths/artifacts |
| `definitionCommit` | Commit containing the pre-registration | Must precede run start |

## ObservedResult v2

One arm execution record. It references, but never overwrites, its task definition.

- `taskId`, `runId`, `arm`, and `sessionId` identify the execution.
- `registrationCommit`, `registrationTimestamp`, `taskDefinitionBlob`, and `registrationReceiptBlob` prove which committed registration was observed before the run; a result without these fields is ineligible.
- `baseSha`, `candidateSha`, and environment identity bind the source and runtime.
- `startedAt` and `finishedAt` order the run and support timeout checks.
- `status` records accepted, failed, partial, contaminated, or invalid outcomes.
- `testResults`, `metrics`, and `evidenceRefs` carry bounded observations.
- `adjudication` records an independent decision and reason.
- `eligibility` records valid/ineligible plus machine-readable reason codes.

Run IDs and session IDs must be unique across a paired task. A copied result, reused worktree, or
cross-arm artifact is ineligible even if the final bytes happen to match.

## MutationObservation

Path-level observation produced by code-state reconciliation.

| Field | Meaning |
|---|---|
| `projectId` / `worktreeId` | Scope of the observed state |
| `path` | Canonical workspace-relative path |
| `beforeFingerprint` / `afterFingerprint` | Observed transition |
| `status` | `managed`, `unmanaged`, `stale_lineage`, `unknown`, or `exempt` |
| `reasonCodes` | Why the classification was chosen |
| `receiptId` | Verified receipt when status is managed |
| `observedAt` | Observation timestamp |
| `source` | watcher, mutation API, reconciliation, or report |

An external write is never managed solely because its final fingerprint equals a previous receipt;
the applicable transition, path, worktree, and receipt identity must match.

## AdmissionSubject

Canonical, portable identity for a Git base/head change set.

- repository identity and base/head commit IDs;
- sorted path entries;
- change status, normalized path representation, resulting blob OID or `ABSENT`, and file mode;
- explicit rename/symlink representation;
- exclusion rule for `.my-pi/provenance/**` only;
- digest of the canonical serialization.

Normalization is deterministic across supported platforms. Subject serialization must not contain
absolute workspace paths, timestamps, private key material, or mutable attestation content.

## AdmissionAttestation

Portable proof for a subject.

- schema version and attestation ID;
- signer key ID and public-key reference;
- canonical subject digest;
- covered receipt digests and path coverage;
- issued-at and expiry policy if configured;
- Ed25519 signature over the canonical payload.

The private signing key is not an entity in workspace state and must be stored outside the workspace.
An attestation is invalid if the subject, covered receipt set, key, or signature changes.

## GraphSnapshot

Bounded read model shared by daemon, portal, and MCP Apps.

| Field | Meaning |
|---|---|
| `schemaVersion` | Graph contract version |
| `kind` | `code`, `impact`, `work`, or `lineage` |
| `snapshotId` | Stable snapshot identity |
| `generatedAt` | Source observation time |
| `nodes` | Bounded normalized graph nodes |
| `edges` | Bounded normalized graph edges |
| `bounds` | Applied node/edge/attribute/depth limits |
| `truncated` / `cursor` | Continuation state |
| `evidenceRefs` | Authoritative records supporting the projection |
| `degraded` | Provider and reason when a source is unavailable |

Nodes and edges use stable IDs, bounded scalar attributes, confidence/reason metadata, and explicit
derived provenance when a direct source record is unavailable. Sensitive paths are filtered before
the UI boundary.

## PolicyBundle

Host-specific experimental controls.

- host and version identity;
- maturity: monitoring, managed, or strict-capable candidate;
- allowed my-pi mutation/verification paths;
- denied or known-unenforced native paths;
- explicit exceptions and verification allowlist;
- generation evidence and residual risks.

The maturity value describes evidence, not an instruction to claim enforcement. Strict-certified
status requires a separate seeded bypass result.

## Relationships

```text
ObservedTask v2 1---* ObservedResult v2
ObservedResult v2 1---* MutationObservation
MutationObservation *---0..1 AdmissionAttestation
AdmissionAttestation 1---1 AdmissionSubject
AdmissionSubject 1---* changed path entries
GraphSnapshot 1---* GraphNode
GraphSnapshot 1---* GraphEdge
GraphNode/GraphEdge *---* evidence references
PolicyBundle 1---* host verification observations
```
