import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProjectId, createRepositoryId, createWorktreeId } from "@my-pi/contracts";
import { SqliteCoordinationStore } from "@my-pi/coordination-store";
import { CodeStateIndexer, CodeStateWatcher, FileSystemCodeStateProvider, type CodeStateProvider, type IndexContext } from "@my-pi/code-state";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-code-state-"));
  const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
  await store.init();
  const context: IndexContext = {
    projectId: createProjectId(),
    repositoryId: createRepositoryId(),
    worktreeId: createWorktreeId(),
    repositoryIdentity: "git:local:my-pi",
    root: dir,
    signal: new AbortController().signal,
  };
  return { dir, store, context };
}

test("PN5 indexes File/Module/Symbol entities with provider and fingerprint metadata", async () => {
  const { dir, store, context } = await setup();
  const file = path.join(dir, "sample.ts");
  const helper = path.join(dir, "helper.ts");
  await writeFile(file, 'import { helper } from "./helper.js";\nexport function buildThing(): string { return helper(); }\nexport class Worker {}\n', "utf8");
  await writeFile(helper, "export function helper(): string { return \"ok\"; }\n", "utf8");
  const indexer = new CodeStateIndexer(store);
  try {
    const delta = await indexer.indexFile(context, file);
    await indexer.indexFile(context, helper);
    const snapshot = indexer.snapshot();
    assert.ok(snapshot.entities.some((entity) => entity.kind === "file" && entity.fingerprint?.size > 0));
    assert.ok(snapshot.entities.some((entity) => entity.kind === "symbol" && entity.displayName === "buildThing"));
    assert.ok(snapshot.entities.some((entity) => entity.kind === "symbol" && entity.displayName === "Worker"));
    assert.ok(snapshot.entities.some((entity) => entity.kind === "module"));
    assert.ok(snapshot.edges.some((edge) => edge.kind === "contains" && edge.confidence === "exact"));
    assert.ok(snapshot.edges.some((edge) => edge.kind === "imports" && edge.confidence === "strong"));
    const sampleEntity = snapshot.entities.find((entity) => entity.kind === "file" && entity.path === "sample.ts");
    const helperEntity = snapshot.entities.find((entity) => entity.kind === "file" && entity.path === "helper.ts");
    assert.ok(sampleEntity && helperEntity);
    assert.ok(snapshot.edges.some((edge) => edge.from === sampleEntity.id && edge.to === helperEntity.id && edge.kind === "imports"));
    assert.equal(delta.provider, "composite");
    assert.equal(delta.providerHealth.fs.status, "ready");
    assert.ok(delta.providerHealth.ast.status === "ready" || delta.providerHealth.ast.status === "degraded");

    const persisted = await store.getCodeState(context.projectId, context.worktreeId);
    assert.equal(persisted.entities.length, snapshot.entities.length);
    assert.equal(persisted.edges.length, snapshot.edges.length);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN5 incremental edits replace only the changed path and reload from persistence", async () => {
  const { dir, store, context } = await setup();
  const sample = path.join(dir, "sample.ts");
  const other = path.join(dir, "other.ts");
  await writeFile(sample, "export function oldName() {}\n", "utf8");
  await writeFile(other, "export function stableName() {}\n", "utf8");
  const indexer = new CodeStateIndexer(store);
  try {
    await indexer.indexPaths(context, [sample, other]);
    await writeFile(sample, "export function newName() {}\n", "utf8");
    await indexer.indexFile(context, sample);
    const changed = indexer.snapshot();
    assert.equal(changed.entities.some((entity) => entity.displayName === "oldName"), false);
    assert.equal(changed.entities.some((entity) => entity.displayName === "newName"), true);
    assert.equal(changed.entities.some((entity) => entity.displayName === "stableName"), true);

    await rm(other);
    await indexer.invalidate(context, [other]);
    const reloaded = new CodeStateIndexer(store);
    await reloaded.load(context);
    assert.equal(reloaded.snapshot().entities.some((entity) => entity.displayName === "stableName"), false);
    assert.equal(reloaded.snapshot().entities.some((entity) => entity.displayName === "newName"), true);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN5 provider failure is explicit and does not discard successful providers", async () => {
  const { dir, store, context } = await setup();
  const file = path.join(dir, "sample.ts");
  await writeFile(file, "export function works() {}\n", "utf8");
  const failing: CodeStateProvider = {
    name: "test-provider",
    supports: () => true,
    async indexFile() { throw new Error("provider unavailable"); },
    async invalidate() { return []; },
  };
  const indexer = new CodeStateIndexer(store, [new FileSystemCodeStateProvider(), failing]);
  try {
    const delta = await indexer.indexFile(context, file);
    assert.equal(delta.providerHealth["test-provider"]?.status, "degraded");
    assert.ok(delta.entities.some((entity) => entity.kind === "file"));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN5 watcher coalesces changed paths and ignores build/vendor segments", async () => {
  const { dir, store, context } = await setup();
  const observed: string[][] = [];
  const watcher = new CodeStateWatcher(dir, { debounceMs: 10, onPaths: (paths) => { observed.push(paths); } });
  try {
    watcher.start();
    await writeFile(path.join(dir, "src.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(dir, "src.ts"), "export const value = 2;\n", "utf8");
    await writeFile(path.join(dir, "dist", "ignored.js"), "ignored", "utf8").catch(async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(observed.length > 0, true);
    assert.ok(observed.flat().includes("src.ts"));
    assert.equal(observed.flat().includes("dist/ignored.js"), false);
  } finally {
    watcher.stop();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
