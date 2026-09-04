#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createProjectId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";
import { EvaluationRuntime } from "../packages/evaluation-runtime/dist/index.js";

const count = 100;
const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-evaluation-throughput-"));
const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
const projectId = createProjectId();
const started = performance.now();
try {
  await store.init();
  await store.transact((tx) => tx.putProjection("project", projectId, { id: projectId, schemaVersion: "1", createdAt: "2026-09-04T00:00:00.000Z" }, projectId));
  const evaluation = new EvaluationRuntime(store, projectId);
  const spec = await evaluation.registerSpec({ name: "throughput", criteria: [{ id: "check", kind: "artifact", required: true, severity: "error", evaluatorRef: "benchmark", expected: true }] });
  for (let index = 0; index < count; index++) {
    const workItemId = `work-${index}`;
    await store.transact((tx) => tx.putProjection("work_item", workItemId, { id: workItemId, projectId, title: workItemId, state: "ready", version: 0, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" }, projectId, "2026-09-04T00:00:00.000Z"));
    const run = await evaluation.requestRun({ specId: spec.id, workItemId, repositoryStateRef: `receipt-${index}` });
    await evaluation.recordResult(run.id, { providerResultId: `result-${index}`, providerId: "benchmark", criterionId: "check", result: { criterionId: "check", outcome: "pass", evidence: [{ provider: "benchmark", digest: `sha256-${index}`, targetStateRef: `receipt-${index}`, observedAt: "2026-09-04T00:00:00.000Z" }] } });
    await evaluation.completeRun(run.id);
  }
  console.log(JSON.stringify({ profile: "evaluation-throughput", runs: count, elapsedMs: Number((performance.now() - started).toFixed(3)), runsPerSecond: Number((count / ((performance.now() - started) / 1000)).toFixed(2)) }, null, 2));
} finally {
  await store.close();
  await rm(dir, { recursive: true, force: true });
}
