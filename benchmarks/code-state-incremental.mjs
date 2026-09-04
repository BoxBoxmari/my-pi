#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createProjectId, createRepositoryId, createWorktreeId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";
import { CodeStateIndexer } from "../packages/code-state/dist/index.js";

const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-code-state-incremental-"));
const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
const context = { projectId: createProjectId(), repositoryId: createRepositoryId(), worktreeId: createWorktreeId(), repositoryIdentity: "git:benchmark:code-state", root: dir, signal: new AbortController().signal };
const indexer = new CodeStateIndexer(store);
const sample = path.join(dir, "sample.ts");
try {
  await store.init();
  await writeFile(sample, "export function initialName() {}\n", "utf8");
  await indexer.indexFile(context, sample);
  const timings = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    await writeFile(sample, `export function changedName${attempt}() {}\n`, "utf8");
    const started = performance.now();
    await indexer.indexFile(context, sample);
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  const percentile = (p) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))];
  console.log(JSON.stringify({ profile: "code-state-incremental", attempts: timings.length, p50Ms: Number(percentile(0.5).toFixed(3)), p95Ms: Number(percentile(0.95).toFixed(3)), maxMs: Number(Math.max(...timings).toFixed(3)) }, null, 2));
} finally {
  await store.close();
  await rm(dir, { recursive: true, force: true });
}
