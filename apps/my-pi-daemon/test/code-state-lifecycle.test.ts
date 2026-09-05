import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProjectId, createRepositoryId, createWorktreeId, fingerprintBytes } from "@my-pi/contracts";
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

async function waitFor(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error("code-state lifecycle condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("PN5 daemon code-state is live, worktree-aware, and policy-authorized", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-pi-code-state-lifecycle-"));
  const worktreeA = path.join(root, "worktree-a");
  const worktreeB = path.join(root, "worktree-b");
  await mkdir(worktreeA);
  await mkdir(worktreeB);
  const projectId = createProjectId();
  const contextA = await makeContext(worktreeA, projectId, createRepositoryId(), createWorktreeId());
  const contextB = await makeContext(worktreeB, projectId, createRepositoryId(), createWorktreeId());
  const samePath = "src/same.ts";
  await mkdir(path.join(worktreeA, "src"));
  await mkdir(path.join(worktreeB, "src"));
  await mkdir(path.join(worktreeA, ".agent", "nested"), { recursive: true });
  await mkdir(path.join(worktreeA, ".cursor"), { recursive: true });
  await Promise.all(Array.from({ length: 120 }, (_, index) => writeFile(path.join(worktreeA, ".cursor", `metadata-${index}.ts`), `export const metadata${index} = ${index};\n`, "utf8")));
  await writeFile(path.join(worktreeA, ".agent", "nested", "ignored.ts"), "export const ignored = true;\n", "utf8");
  await writeFile(path.join(worktreeA, samePath), "export const source = 'A';\n", "utf8");
  await writeFile(path.join(worktreeB, samePath), "export const source = 'B';\n", "utf8");
  await writeFile(path.join(worktreeA, ".env"), "SECRET=A\n", "utf8");
  const store = new SqliteCoordinationStore(path.join(root, "coordination.sqlite"));
  await store.init();
  let deltaCount = 0;
  const manager = new CodeStateManager(store, { initialFileLimit: 100, reconcileFileLimit: 100, reconcileMs: 10, onDelta: () => { deltaCount++; } });
  try {
    await manager.register(contextA);
    await manager.register(contextB);
    const snapshotA = await manager.snapshot(projectId, contextA.worktreeId);
    const snapshotB = await manager.snapshot(projectId, contextB.worktreeId);
    assert.equal(snapshotA.entities.some((entity) => entity.path === samePath && entity.fingerprint?.digest === fingerprintBytes(new TextEncoder().encode("export const source = 'A';\n")).digest), true);
    assert.equal(snapshotB.entities.some((entity) => entity.path === samePath && entity.fingerprint?.digest === fingerprintBytes(new TextEncoder().encode("export const source = 'B';\n")).digest), true);
    assert.equal(snapshotA.entities.some((entity) => entity.path === ".env"), false);
    assert.equal(snapshotA.entities.some((entity) => entity.path?.includes(".agent/") || entity.path?.includes(".cursor/")), false);
    assert.equal(snapshotA.entities.some((entity) => entity.path === samePath), true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(deltaCount, 0);

    await writeFile(path.join(worktreeB, samePath), "export const source = 'B-updated';\n", "utf8");
    await waitFor(async () => {
      const updated = await manager.snapshot(projectId, contextB.worktreeId);
      return updated.entities.some((entity) => entity.path === samePath && entity.fingerprint?.digest === fingerprintBytes(new TextEncoder().encode("export const source = 'B-updated';\n")).digest);
    });
    const deltaCountAfterChange = deltaCount;
    assert.ok(deltaCountAfterChange > 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(deltaCount, deltaCountAfterChange);
    const unchangedA = await manager.snapshot(projectId, contextA.worktreeId);
    assert.equal(unchangedA.entities.some((entity) => entity.path === samePath && entity.fingerprint?.digest === fingerprintBytes(new TextEncoder().encode("export const source = 'A';\n")).digest), true);

    await rm(path.join(worktreeB, samePath));
    await waitFor(async () => {
      const deleted = await manager.snapshot(projectId, contextB.worktreeId);
      return !deleted.entities.some((entity) => entity.path === samePath);
    });
  } finally {
    await manager.stop();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
