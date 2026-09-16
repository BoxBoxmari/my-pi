# Code-State Worktree Identity Invariants

Close-to-implementation contract for `packages/code-state/src/identity.ts`,
`packages/coordination-store/src/projections.ts` (`applyCodeStateDelta`), and
`apps/my-pi-daemon/src/code-state-manager.ts`.

Core property:

> At no point can an entity row or edge created under worktree A become owned
> by worktree B as a side effect of indexing, reconciliation, restart,
> deletion, or interleaving.

## Stable-key contract

- `fileStableKey(worktreeId, relativePath)`
- `symbolStableKey(worktreeId, relativePath, kind, name, line)`
- `moduleStableKey(worktreeId, relativePath, importText)`
- Entity `id = stableEntityId(stableKey)` (sha256, 12 hex chars).

`worktreeId` is part of every worktree-scoped stable key. Repository identity
alone MUST NOT define worktree-scoped entity identity.

## Invariants

1. Same repository + different worktrees => distinct worktree-scoped identities.
2. Same worktree + unchanged file => stable identity across reconciliation.
3. Same logical worktree after daemon restart => same IDs (persisted
   `code_entities` reloaded via `getCodeState` / `indexer.load`).
4. Concurrent/interleaved registration of multiple worktrees cannot migrate or
   overwrite entities across worktrees (per-worktree queue + worktree-scoped
   deletes + ownership guard).
5. Updating one worktree cannot mutate fingerprints/ownership in another
   (all deletes/edge rewrites scoped by `(project_id, worktree_id)`).
6. Deleting one worktree's path cannot delete/re-key entities owned by another
   worktree.
7. Delete/recreate semantics: `worktreeId` identifies one registered logical
   worktree lifecycle. Deleting and recreating a filesystem directory at the
   same path does NOT imply the same worktree identity unless registration
   resolves to the same persisted worktree record. A fresh `worktreeId` gets
   fresh entity identities even at a reused path.
8. Rename semantics: rename = remove old path identity + create new path
   identity. Stable keys embed relative path, so rename yields NEW entity
   identity. Rename continuity, if ever needed, must be an explicit
   relationship/evidence edge — never overloaded onto stable identity.
9. Branch checkout / detached HEAD does NOT change worktree identity.
   `worktreeId` is independent of branch/ref; only stable-key components
   (path/kind/name/line/import) affect entity IDs.
10. Same relative path with different contents across worktrees stays isolated:
    distinct IDs AND distinct fingerprints AND distinct `worktree_id` ownership.

## Persistence defense (fail loudly)

`code_entities` has `id PRIMARY KEY` + `UNIQUE (project_id, worktree_id,
stable_key)`. The upsert path previously allowed
`ON CONFLICT(id) DO UPDATE ... worktree_id=excluded.worktree_id`, which would
silently migrate ownership if identity derivation ever regressed.

`applyCodeStateDelta` now enforces, inside the caller transaction:

- effective entity worktree (`entity.worktreeId ?? input.worktreeId`) MUST
  equal the delta scope `input.worktreeId`;
- an existing row with the same `id` owned by a different
  `(project_id, worktree_id)` aborts with a coordination-store invariant
  error instead of reassigning the row.

A future schema redesign (composite PK) is explicitly deferred; the
application-level guard is the normative defense for this ticket.

## Executable coverage

- `packages/code-state/test/identity-invariants.test.ts`: primitive-level
  invariants 1, 2, 8, 9, 10 (keys + IDs, rename, branch-independence).
- `packages/coordination-store/test/code-state-ownership.test.ts`:
  store-level invariants 4, 5, 6 (cross-worktree `id` reuse fails loudly,
  scoped deletes, edge scoping).
- `apps/my-pi-daemon/test/worktree-identity-invariants.test.ts`:
  lifecycle invariants 1–7, 10 (two live worktrees, interleaved
  register/reconcile, restart re-registration, delete/recreate).
- Existing `apps/my-pi-daemon/test/code-state-lifecycle.test.ts` remains the
  high-level PN5 behavior test and is unchanged.
