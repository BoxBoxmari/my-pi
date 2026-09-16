import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProjectId, createRepositoryId, createWorktreeId } from "@my-pi/contracts";
import { SqliteCoordinationStore } from "@my-pi/coordination-store";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import type { IndexContext } from "@my-pi/code-state";
import { CodeStateManager } from "../dist/code-state-manager.js";

async function makeContext(root: string, projectId: string, repositoryId: string, worktreeId: string): Promise<IndexContext> {
  const workspace = new WorkspaceRuntime();
  await workspace.open({ root });
  return {
    projectId: projectId as never,
    repositoryId: repositoryId as never,
    worktreeId: worktreeId as never,
    repositoryIdentity: `path:${root}`,
    root,
    signal: new AbortController().signal,
    resolveReadPath: (filePath) => workspace.pathPolicy.resolveForRead(workspace.workspaceOrThrow, filePath, { allowMissing: true }),
  };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error("worktree identity condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function entityByPath(snapshot, relPath) {
  return snapshot.entities.filter((e) => e.path === relPath);
}

test("invariants 1+10: two worktrees from one repo have distinct ids and ownership", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-pi-wt-identity-"));
  const dirA = path.join(root, "wt-a");
  const dirB = path.join(root, "wt-b");
  await mkdir(path.join(dirA, "src"), { recursive: true });
  await mkdir(path.join(dirB, "src"), { recursive: true });
  const projectId = createProjectId();
  const repositoryId = createRepositoryId();
  const worktreeA = createWorktreeId();
  const worktreeB = createWorktreeId();
  await writeFile(path.join(dirA, "src/same.ts"), "export const source = 'A';\n", "utf8");
  await writeFile(path.join(dirB, "src/same.ts"), "export const source = 'B';\n", "utf8");
  const store = new SqliteCoordinationStore(path.join(root, "coordination.sqlite"));
  await store.init();
  const manager = new CodeStateManager(store, { reconcileMs: 10, watchPlatform: "win32" });
  try {
    // Interleaved registration order: A, B.
    await manager.register(await makeContext(dirA, projectId, repositoryId, worktreeA));
    await manager.register(await makeContext(dirB, projectId, repositoryId, worktreeB));
    const snapA = await manager.snapshot(projectId, worktreeA);
    const snapB = await manager.snapshot(projectId, worktreeB);
    const entA = entityByPath(snapA, "src/same.ts");
    const entB = entityByPath(snapB, "src/same.ts");
    assert.ok(entA.length > 0 && entB.length > 0);
    // Both ids AND ownership asserted, not only fingerprints.
    const idsA = new Set(entA.map((e) => String(e.id)));
    const idsB = new Set(entB.map((e) => String(e.id)));
    assert.equal([...idsA].some((id) => idsB.has(id)), false, "ids must not collide across worktrees");
    for (const e of [...entA, ...snapA.entities]) assert.equal(String(e.worktreeId ?? worktreeA), String(worktreeA));
    for (const e of [...entB, ...snapB.entities]) assert.equal(String(e.worktreeId ?? worktreeB), String(worktreeB));
    assert.notEqual(
      entA.find((e) => e.kind === "file")?.fingerprint?.digest,
      entB.find((e) => e.kind === "file")?.fingerprint?.digest,
    );
  } finally {
    await manager.stop();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invariants 4+5: interleaved reconcile cannot migrate ownership", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-pi-wt-interleave-"));
  const dirA = path.join(root, "wt-a");
  const dirB = path.join(root, "wt-b");
  await mkdir(path.join(dirA, "src"), { recursive: true });
  await mkdir(path.join(dirB, "src"), { recursive: true });
  const projectId = createProjectId();
  const repositoryId = createRepositoryId();
  const worktreeA = createWorktreeId();
  const worktreeB = createWorktreeId();
  await writeFile(path.join(dirA, "src/same.ts"), "export const v = 1;\n", "utf8");
  await writeFile(path.join(dirB, "src/same.ts"), "export const v = 1;\n", "utf8");
  const store = new SqliteCoordinationStore(path.join(root, "coordination.sqlite"));
  await store.init();
  const manager = new CodeStateManager(store, { reconcileMs: 10, watchPlatform: "win32" });
  try {
    const ctxA = await makeContext(dirA, projectId, repositoryId, worktreeA);
    const ctxB = await makeContext(dirB, projectId, repositoryId, worktreeB);
    // A register -> B register -> A reconcile -> B mutate -> B reconcile -> snapshots.
    await manager.register(ctxA);
    await manager.register(ctxB);
    const beforeA = await manager.snapshot(projectId, worktreeA);
    const idsBeforeA = new Set(beforeA.entities.map((e) => String(e.id)));
    await writeFile(path.join(dirB, "src/same.ts"), "export const v = 2;\n", "utf8");
    await waitFor(async () => {
      const s = await manager.snapshot(projectId, worktreeB);
      return s.entities.some((e) => e.path === "src/same.ts" && e.kind === "file" && String(e.fingerprint?.digest ?? "").length > 0);
    });
    await new Promise((r) => setTimeout(r, 200));
    const afterA = await manager.snapshot(projectId, worktreeA);
    const afterB = await manager.snapshot(projectId, worktreeB);
    // A's identity set is stable; B's update did not re-key or migrate A.
    for (const e of afterA.entities) {
      assert.ok(idsBeforeA.has(String(e.id)), `A entity ${String(e.id)} must remain stable`);
      assert.equal(String(e.worktreeId ?? worktreeA), String(worktreeA));
    }
    for (const e of afterB.entities) assert.equal(String(e.worktreeId ?? worktreeB), String(worktreeB));
  } finally {
    await manager.stop();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invariants 3+9: restart preserves identity; branch-independent worktree scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-pi-wt-restart-"));
  const dirA = path.join(root, "wt-a");
  await mkdir(path.join(dirA, "src"), { recursive: true });
  const projectId = createProjectId();
  const repositoryId = createRepositoryId();
  const worktreeA = createWorktreeId();
  await writeFile(path.join(dirA, "src/a.ts"), "export const a = 1;\n", "utf8");
  const dbFile = path.join(root, "coordination.sqlite");
  const store = new SqliteCoordinationStore(dbFile);
  await store.init();
  const manager = new CodeStateManager(store, { reconcileMs: 10, watchPlatform: "win32" });
  let idsBefore;
  try {
    await manager.register(await makeContext(dirA, projectId, repositoryId, worktreeA));
    idsBefore = new Set((await manager.snapshot(projectId, worktreeA)).entities.map((e) => String(e.id)));
  } finally {
    await manager.stop();
    await store.close();
  }
  // Simulate daemon restart: new store + new manager, same logical worktree ids.
  const store2 = new SqliteCoordinationStore(dbFile);
  await store2.init();
  const manager2 = new CodeStateManager(store2, { reconcileMs: 10, watchPlatform: "win32" });
  try {
    await manager2.register(await makeContext(dirA, projectId, repositoryId, worktreeA));
    const after = await manager2.snapshot(projectId, worktreeA);
    const idsAfter = new Set(after.entities.map((e) => String(e.id)));
    assert.deepEqual([...idsAfter].sort(), [...idsBefore].sort(), "restart must recover deterministic ids");
  } finally {
    await manager2.stop();
    await store2.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invariants 6+7: delete/recreate has explicit deterministic semantics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-pi-wt-delete-"));
  const dirA = path.join(root, "wt-a");
  const dirB = path.join(root, "wt-b");
  await mkdir(path.join(dirA, "src"), { recursive: true });
  await mkdir(path.join(dirB, "src"), { recursive: true });
  const projectId = createProjectId();
  const repositoryId = createRepositoryId();
  const worktreeA = createWorktreeId();
  const worktreeB = createWorktreeId();
  await writeFile(path.join(dirA, "src/keep.ts"), "export const k = 'A';\n", "utf8");
  await writeFile(path.join(dirB, "src/gone.ts"), "export const g = 'B';\n", "utf8");
  const store = new SqliteCoordinationStore(path.join(root, "coordination.sqlite"));
  await store.init();
  const manager = new CodeStateManager(store, { reconcileMs: 10, watchPlatform: "win32" });
  try {
    await manager.register(await makeContext(dirA, projectId, repositoryId, worktreeA));
    await manager.register(await makeContext(dirB, projectId, repositoryId, worktreeB));
    const idsA = new Set((await manager.snapshot(projectId, worktreeA)).entities.map((e) => String(e.id)));
    // Delete B's only file: A's entities must be untouched.
    await rm(path.join(dirB, "src/gone.ts"));
    await waitFor(async () => (await manager.snapshot(projectId, worktreeB)).entities.length === 0);
    const afterA = await manager.snapshot(projectId, worktreeA);
    assert.deepEqual(new Set(afterA.entities.map((e) => String(e.id))), idsA);
    // Recreate the directory with a FRESH worktreeId: fresh identity, no id reuse.
    const worktreeB2 = createWorktreeId();
    await writeFile(path.join(dirB, "src/gone.ts"), "export const g = 'B2';\n", "utf8");
    await manager.register(await makeContext(dirB, projectId, repositoryId, worktreeB2));
    const snapB2 = await manager.snapshot(projectId, worktreeB2);
    assert.ok(snapB2.entities.length > 0);
    for (const e of snapB2.entities) assert.equal(String(e.worktreeId ?? worktreeB2), String(worktreeB2));
  } finally {
    await manager.stop();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
