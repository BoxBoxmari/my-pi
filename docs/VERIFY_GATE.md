# Verify Gate

The verify gate is read-only. It may inspect handoff templates, sub-agent returns, completion cards, claim packets, evidence packets, diffs, command outputs, and trace events. It must not edit source files or repair work while verifying.

Activation may occur when a specialist returns `fix_status: fixed`, returns `verification.status: passed`, creates claim/evidence, or when the orchestrator is about to declare work done.

Outcomes:

```yaml
success: accepted
failed: withheld
blocked: withheld
skipped: withheld
timeout: withheld
error: withheld
```

Blocked verification must identify blocking predicate, blocked reason class, next owner, and next action.

## Failure taxonomy

The verify gate assigns typed withheld reasons per `schemas/withheld-reason.schema.json`:

- `class`: category from the schema enum (e.g., `evidence_floor_missing`, `context_floor_blocked`, `approval_receipt_missing`).
- `blocking_predicate`: the predicate key that blocked admission.
- `stage`: where the failure was caught (`schema`, `policy`, `verification`, `admission`, `evidence`, `handoff`, `approval`, `state`, `context`, `recovery`).
- `recoverability`: legacy recovery hint (`retry_after_refresh`, `retry_with_fixes`, `human_intervention`, `manual_review`). Kept for backward compatibility.
- `schema_recoverability`: schema enum value derived from `recoverability` (`automatic`, `manual`, `blocked`, `unknown`). Present during compatibility phase.
- `owner`: who handles recovery.
- `next_action`: recommended recovery step.

In JSON output, taxonomy fields are nested under `withheld_reason`. Success cases omit the object.

> Source of truth: [`schemas/withheld-reason.schema.json`](../schemas/withheld-reason.schema.json).

## Evidence scope verification

The verify gate evaluates evidence scope according to tier:

- `light`: `verification_artifacts`, `verifies`, `does_not_verify`, `untested_regions` are optional.
- `standard`: The above are recommended; missing scope produces a warning, not a hard failure.
- `deep`: The above are required. Missing `remaining_risks`, `state.read_set`, or `state.write_set` blocks admission.

Allowed artifact kinds:

```txt
typecheck, unit_test, integration_test, e2e_test, lint, build,
static_analysis, security_scan, fuzz, performance_profile,
manual_review, model_critique, custom
```

Allowed artifact statuses:

```txt
passed, failed, blocked, skipped, timeout, error
```

For command-backed evidence, any non-zero `exit_code` in `claim.evidence.command_evidence[]` or `verification_artifacts[]` blocks admission, even if the artifact `status` says `passed`.

For stronger provenance, prefer command records produced by `xh evidence run`
or CI artifacts bound with `ci_run_url`, repository state, and checksums. See
[Evidence Provenance](EVIDENCE_PROVENANCE.md) for the runtime fields enforced by
`--strict`, `--require-evidence-hash`, and governed profiles.

## Read-only mutation guard

The verify command supports an explicit `--mutation-guard` flag. The guard is also enabled by `--strict`, by standard/deep tier auto-detection, and by admission-capable verify profiles such as `ci-standard`, `ci-strict`, and `governed-deep`. When enabled, verify snapshots the workspace before and after the full verification pipeline and compares the delta. This does not require a clean worktree.

Behavior:

- In git workspaces, the guard uses `git status --porcelain=v1 -z --untracked-files=all` and content hashes for dirty/untracked files.
- In non-git workspaces, the guard falls back to a directory snapshot with bounded-concurrency content hashing.
- Hashing concurrency defaults to `16`. Set `X_HARNESS_MUTATION_GUARD_HASH_CONCURRENCY` for high file-count dirty/untracked worktrees; values below `1` fall back to the default and values above `64` are capped at `64`.
- Non-git fallback always ignores `.git/`, `node_modules/`, and `.x-harness/`. It also reads root `.gitignore` entries and optional `policies/mutation-guard.yaml` `fallback_ignore` rules.
- If no baseline can be established while the guard is enabled, verification is fail-closed because read-only verification cannot be proven.
- Writes under `.x-harness/` (including trace output in `.x-harness/traces/`) are allowlisted and do not trigger the guard.
- The guard wraps schema validation, admission policy, approval-risk, contract oracle, boundary, decision, intent, context, and trace rendering paths.
- If any unexpected file change is detected, verify produces a `blocked` outcome with `blocking_predicate: verifier_not_read_only` and recovery routed to `admission-verifier`.
- Without `--mutation-guard`, existing behavior is unchanged.

Latency can be measured with:

```bash
./x-harness benchmark --filter mutation-guard --json
# compatibility: node packages/cli/dist/index.js benchmark --filter mutation-guard --json
```

By default this measures git and non-git fallback snapshots with `100`, `1000`, and `5000` files across concurrency levels `1`, `4`, `16`, and `64`. Use `--mutation-files` and `--mutation-concurrency` to override those lists.

## Governance verification

For `deep` tasks with `governance.requires_human_approval: true`, verify checks that `approval_status` is `approved`. Pending or missing approval blocks admission.

Governance intervention artifacts used by permissions/admission support must remain inside the workspace root, validate against `schemas/intervention.schema.json`, include a non-empty `authorizer`, use an allowing decision, remain unexpired, and cover the target scope. Invalid intervention artifacts fail closed instead of granting approval authority.

## Contract oracle verification

The verify command supports an opt-in `--contract-oracles` flag that performs rule-based oracle assertions against the repository. This is an opt-in feature that is disabled by default.

Behavior:

- Contract Oracle is **off by default** and only runs when `--contract-oracles` (or `xh contract check`) is explicitly passed. The FAQ states: "Contract Oracle is off by default and must be explicitly enabled."
- When enabled, verify reads the policy file `policies/contract-oracle.yaml`. A custom policy file can be specified with `--contract-oracles-policy <path>`.
- Assertions are evaluated using grep patterns (`grep_rules`) and line-level import scanning (`dependency_rules`) against workspace files; no AST parsing, package graph resolution, or runtime subprocesses are used.
- `grep_rules` match regex patterns against file content.
- `dependency_rules` scan for import-like lines (Go `import`, TypeScript/JavaScript `import ... from`, `require()`) and check import paths against `forbidden_imports` substrings. `allowed_imports` can suppress a match. `exclude` patterns apply to file paths.
- The checked-in default policy is empty-safe (`grep_rules: []`, `dependency_rules: []`), meaning no assertions run even when explicitly enabled unless a custom policy is provided.
- The hard-error on a missing or unreadable policy file only applies **once Contract Oracle has been explicitly enabled** (via `--contract-oracles`, `--contract-oracles-policy <path>`, or the standalone `xh contract check`). When Contract Oracle is not enabled, the verify gate ignores the policy file entirely and never hard-errors on its absence. This is consistent with the FAQ: Contract Oracle is off by default and does not affect ordinary verify runs.
- Failures produce a `blocked` outcome with `blocking_predicate: contract_oracle_blocked`.

## Enforce flags

The verify gate supports optional enforce flags that promote advisory checks into blocking predicates:

- `--boundary-enforce off|advisory|block_high|block_all` — promotes boundary policy violations to advisory or blocking findings. Requires `--boundary-policy <path>` when using a non-default policy.
- `--decision-enforce off|advisory|block` — validates that the completion card links to decision records when required.
- `--intent-enforce off|advisory|block` — validates permission-intent classification and approval receipts for high-risk commands.
- `--context-enforce off|advisory|block` — validates context manifest freshness and managed-block consistency.

All enforce flags default to `off`. They are intended for CI and strict conformance runs where additional policy dimensions must be admission-critical.

## Verify profiles

`xh verify` supports preset profiles that configure the default strictness of enforce flags and optional checks:

- `light-local` — Minimal checks, no mutation guard. Boundary, decision, intent, and context enforcement are advisory-only and never block.
- `ci-standard` — Enables mutation guard and context floor. Contract oracles are disabled; boundary, decision, intent, and context enforcement are advisory-only.
- `ci-strict` — Enables mutation guard, context floor, contract oracles, and strict withheld-reason schema. Blocks high/critical boundary violations and missing `context_alignment.decision_refs` on standard/deep cards. Intent and context manifest staleness are blocked by default.
- `governed-deep` — All ci-strict checks. Blocks all boundary violations unless approved via `boundary_approvals`, blocks missing `context_alignment.decision_refs`, missing/blank `intent_ref`, and stale context manifests on standard/deep cards.

Explicit flags (e.g., `--mutation-guard`, `--boundary-enforce`) override profile defaults.

`boundary_approvals` suppress only matching boundary findings and only when each approval includes `rule_id`, `approver`, RFC3339 `approved_at`, and `reason`. Rule-only or malformed entries are ignored.

## Context manifest relation

The `xh context manifest write` command generates a manifest of file hashes (default `.x-harness/context-manifest.yaml`). `xh context manifest check --manifest <path>` verifies that the tracked files have not drifted. When `--context-enforce` is enabled, verify checks manifest freshness as part of the admission gate.

## Compatibility boundary

The Go runtime emits `withheld_reason` as a **compatibility superset** that includes both strict-schema fields and legacy fields:

Go verify JSON also emits `schema_version: "x-harness.verify-result.v1"` so automation can pin the result contract.

- **Strict-schema fields**: `class`, `stage`, `owner`, `schema_recoverability`, `blocking_predicate`, `next_action`
- **Legacy fields**: `failure_class`, `failure_stage`, legacy `recoverability` values

The strict schema target (`schemas/withheld-reason.schema.json`) uses `additionalProperties: false` and `recoverability` enum values `automatic|manual|blocked|unknown`. Legacy fields are not permitted.

**Compatibility boundary**: The verify gate accepts the superset; strict-schema validators (used in tests) enforce the canonical form.
