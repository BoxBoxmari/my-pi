# Test Contract (Issue #31)

One manifest answers: what must never regress, which executable check proves
each claim, where that check runs, and whether it is merge-blocking,
release-blocking, or experimental evidence.

- Manifest: `test-contract/invariants.json` (code-owned, reviewable).
- Verifier: `scripts/verify-test-contract.mjs` (`pnpm check:contract`).
- CI binding: `quality-matrix` runs the verifier early, before expensive
  steps, on every lane; `ci-required` aggregates the lanes for merge policy.

## Proof levels

```text
unit        pure helper/derivation (identity keys, params, layout, UI state)
integration two or more packages cooperating (store + manager, adapter + runtime)
process     spawned process or live service (daemon IPC, SSE, CLI smoke)
artifact    the exact packed TGZ / SHA / SBOM / manifest (release only)
```

A unit test never counts as proof for an artifact-level claim; each invariant
declares the strongest level at which it is proven.

## Gates

- `merge` — blocks PR merge via `ci-required` + CodeQL (see
  `docs/GITHUB_GOVERNANCE.md`).
- `release` — blocks publish via the release admission chain (Model A:
  exact TGZ → qualify → admit → publish).
- `evidence` — must run green on the normative lane; empirical/recorded
  (Production Next PN gates). PN entries record `experimental-blocking`
  in their title so a future experiment cannot silently redefine stable
  admission.

## Verification questions (answered)

| Question | Answer |
|---|---|
| Which test proves worktrees cannot clobber each other's identities? | `code-state.worktree-isolation`: `packages/code-state/test/identity-invariants.test.ts`, `packages/coordination-store/test/code-state-ownership.test.ts`, `apps/my-pi-daemon/test/worktree-identity-invariants.test.ts` (+ PN5 `code-state-lifecycle.test.ts`). Fails loudly on cross-worktree `id` reuse. |
| Which check proves dependency rules cannot be bypassed? | `architecture.package-boundaries`: `node scripts/architecture-check.mjs` (AST-based, quote-independent) + `test/compat/architecture-syntax-parity.test.mjs`. |
| Which lane proves the minimum supported Node runtime? | `runtime.minimum-supported`: exact `24.0.0` lane in `ci.yml`/`release.yml` + `test/compat/runtime-contract.test.mjs` (`node:sqlite` smoke). |
| Which command proves the packed artifact is the qualified artifact? | `release.artifact-sha-binding`: `node scripts/verify-release.mjs --strict` + `SHA256SUMS.txt` preservation across prepare/qualify/admit (`test/release/publish-artifact-binding.test.mjs`). |
| Which tests prove daemon coordination lifecycle? | `daemon.lifecycle`: `apps/my-pi-daemon/test/daemon.test.ts`, `evaluation.test.ts`, `graph-events.test.ts`, plus `request-router-inventory.test.ts` (28-operation inventory). |

## Numeric coverage policy

No repository-wide percentage target — high line coverage can miss exactly
the cross-worktree, artifact-provenance, and compatibility failures this
contract exists to catch. Numeric thresholds (Node test-runner V8 coverage)
may be added only per package, only with justification, and only for pure
packages where statement/branch meaning is clear (identity derivation,
graph normalization, param parsing, pure UI state/layout). Currently **zero**
numeric thresholds are enforced. Process/artifact workflows are never gated
by percentage.

## Adding or changing an invariant

1. Add the executable proof first (test, script, or lane).
2. Register it in `test-contract/invariants.json` with `id`, `title`,
   `level`, `gate`, `proof.command`, `proof.files[]`, and `ci.workflow` +
   verbatim `ci.anchors[]` found in that workflow.
3. Run `pnpm check:contract`. Removing a proof file, renaming a command, or
   deleting a CI anchor fails the verifier until the manifest is
   intentionally updated in the same PR.
4. Prefer stable anchors (`ci-required`, script paths, exact versions) over
   matrix-generated job names.

## Cost control

The verifier is milliseconds of file reads and substring checks; it runs on
every lane without lengthening them. Expensive release qualification stays in
the release workflow, not in merge lanes (see `docs/GITHUB_GOVERNANCE.md`).
