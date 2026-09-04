#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createProjectId, createRepositoryId, createWorktreeId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";
import { CodeStateIndexer } from "../packages/code-state/dist/index.js";

const fileCount = Number(process.argv[process.argv.indexOf("--files") + 1] ?? 20);
if (!Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > 200) throw new Error("--files must be between 1 and 200");
const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-code-state-bench-"));
const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
const context = { projectId: createProjectId(), repositoryId: createRepositoryId(), worktreeId: createWorktreeId(), repositoryIdentity: "git:benchmark:code-state", root: dir, signal: new AbortController().signal };
const indexer = new CodeStateIndexer(store);
try {
  await store.init();
  const paths = [];
  for (let index = 0; index < fileCount; index++) {
    const relative = `sample-${index}.ts`;
    paths.push(relative);
    await writeFile(path.join(dir, relative), `export function sample${index}(): number { return ${index}; }\n`, "utf8");
  }
  const started = performance.now();
  await indexer.indexPaths(context, paths);
  const elapsedMs = performance.now() - started;
  const snapshot = indexer.snapshot();
  console.log(JSON.stringify({ profile: "code-state-index", fileCount, elapsedMs: Number(elapsedMs.toFixed(3)), entities: snapshot.entities.length, edges: snapshot.edges.length }, null, 2));
} finally {
  await store.close();
  await rm(dir, { recursive: true, force: true });
}
