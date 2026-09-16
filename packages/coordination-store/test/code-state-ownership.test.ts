import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  createProjectId,
  createRepositoryId,
  createWorktreeId,
  isMyPiError,
} from "@my-pi/contracts";
import { SqliteCoordinationStore } from "@my-pi/coordination-store";

// Local mirror of the pure key derivation in @my-pi/code-state identity.ts.
// Duplicated (not imported) to preserve layering: coordination-store must
// not depend on code-state. Any drift between these helpers and the real
// derivation only makes the collision test weaker, never stronger — the
// ownership guard under test does not rely on key shape.
function fileStableKey(worktreeId: string, relativePath: string): string {
  return `${worktreeId}|file|${relativePath}`;
}

function stableEntityId(stableKey: string): string {
  return `entity_${createHash("sha256").update(`my-pi-code-entity:${stableKey}`, "utf8").digest("hex").slice(0, 12)}`;
}

function entityFor(projectId, repositoryId, worktreeId, relativePath, fingerprintDigest) {
  const stableKey = fileStableKey(String(worktreeId), relativePath);
  return {
    id: stableEntityId(stableKey),
    projectId,
    repositoryId,
    worktreeId,
    kind: "file",
    stableKey,
    displayName: relativePath,
    path: relativePath,
    fingerprint: { digest: fingerprintDigest, bytes: 4, mtimeMs: 1 },
    observedAt: new Date().toISOString(),
    provider: "fs",
  };
}

function deltaFor(projectId, repositoryId, worktreeId, entities, extra = {}) {
  return {
    projectId,
    repositoryId,
    worktreeId: String(worktreeId),
    changedPath: "src/same.ts",
    entities,
    edges: [],
    removedStableKeys: [],
    observedAt: new Date().toISOString(),
    ...extra,
  };
}

test("invariant 4/5: same id under another worktree fails loudly, never migrates", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-ownership-"));
  const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
  try {
    await store.init();
    const projectId = createProjectId();
    const repositoryId = createRepositoryId();
    const worktreeA = createWorktreeId();
    const worktreeB = createWorktreeId();

    await store.applyCodeStateDelta(deltaFor(projectId, repositoryId, worktreeA, [
      entityFor(projectId, repositoryId, worktreeA, "src/same.ts", "fp-a"),
    ]));

    // Same entity id persisted under worktree B scope must be rejected.
    const colliding = entityFor(projectId, repositoryId, worktreeA, "src/same.ts", "fp-a");
    await assert.rejects(
      () => store.applyCodeStateDelta(deltaFor(projectId, repositoryId, worktreeB, [colliding])),
      (error) => isMyPiError(error) && /ownership invariant/.test(error.message),
      "cross-worktree id reuse must fail loudly",
    );

    // Ownership of A is unchanged.
    const stateA = await store.getCodeState(projectId, String(worktreeA));
    assert.equal(stateA.entities.length, 1);
    assert.equal(String(stateA.entities[0].worktreeId ?? worktreeA), String(worktreeA));
    const stateB = await store.getCodeState(projectId, String(worktreeB));
    assert.equal(stateB.entities.length, 0);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("invariant 5/6: deletes and fingerprint updates stay scoped by worktree", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-ownership-scoped-"));
  const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
  try {
    await store.init();
    const projectId = createProjectId();
    const repositoryId = createRepositoryId();
    const worktreeA = createWorktreeId();
    const worktreeB = createWorktreeId();

    await store.applyCodeStateDelta(deltaFor(projectId, repositoryId, worktreeA, [
      entityFor(projectId, repositoryId, worktreeA, "src/same.ts", "fp-a"),
    ]));
    await store.applyCodeStateDelta(deltaFor(projectId, repositoryId, worktreeB, [
      entityFor(projectId, repositoryId, worktreeB, "src/same.ts", "fp-b"),
    ]));

    // Reconciling B (same path, new content) must not touch A's fingerprint.
    await store.applyCodeStateDelta(deltaFor(projectId, repositoryId, worktreeB, [
      entityFor(projectId, repositoryId, worktreeB, "src/same.ts", "fp-b2"),
    ]));
    const stateA = await store.getCodeState(projectId, String(worktreeA));
    assert.equal(stateA.entities[0].fingerprint?.digest, "fp-a");

    // Removing B's stable key must not delete A's row at the same logical path.
    const stableKeyB = fileStableKey(String(worktreeB), "src/same.ts");
    await store.applyCodeStateDelta(
      deltaFor(projectId, repositoryId, worktreeB, [], { removedStableKeys: [stableKeyB] }),
    );
    const afterA = await store.getCodeState(projectId, String(worktreeA));
    assert.equal(afterA.entities.length, 1);
    const afterB = await store.getCodeState(projectId, String(worktreeB));
    assert.equal(afterB.entities.length, 0);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("invariant 7: edges remain scoped by (project, worktree)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-ownership-edges-"));
  const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
  try {
    await store.init();
    const projectId = createProjectId();
    const repositoryId = createRepositoryId();
    const worktreeA = createWorktreeId();
    const worktreeB = createWorktreeId();
    const entA = entityFor(projectId, repositoryId, worktreeA, "src/a.ts", "fp-a");
    const entB = entityFor(projectId, repositoryId, worktreeB, "src/a.ts", "fp-b");
    await store.applyCodeStateDelta({
      ...deltaFor(projectId, repositoryId, worktreeA, [entA]),
      changedPath: "src/a.ts",
      edges: [{ from: entA.id, to: entA.id, kind: "contains", confidence: "exact", provider: "fs", observedAt: new Date().toISOString() }],
    });
    await store.applyCodeStateDelta({
      ...deltaFor(projectId, repositoryId, worktreeB, [entB]),
      changedPath: "src/a.ts",
      edges: [{ from: entB.id, to: entB.id, kind: "contains", confidence: "exact", provider: "fs", observedAt: new Date().toISOString() }],
    });
    const stateA = await store.getCodeState(projectId, String(worktreeA));
    const stateB = await store.getCodeState(projectId, String(worktreeB));
    assert.equal(stateA.edges.length, 1);
    assert.equal(stateB.edges.length, 1);
    assert.notEqual(String(stateA.edges[0].from), String(stateB.edges[0].from));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
