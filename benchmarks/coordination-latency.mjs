#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createProjectId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";

const count = Number(process.argv[process.argv.indexOf("--events") + 1] ?? 1000);
if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error("--events must be between 1 and 100000");
const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-coordination-latency-"));
const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
const projectId = createProjectId();
const timings = [];
try {
  await store.init();
  for (let index = 0; index < count; index++) {
    const started = performance.now();
    await store.appendEvent({ projectId, eventType: "AgentHeartbeat", actor: { kind: "system", name: "coordination-latency" }, payload: { index } });
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  const percentile = (p) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))];
  console.log(JSON.stringify({ profile: "coordination-latency", events: count, p50Ms: Number(percentile(0.5).toFixed(3)), p95Ms: Number(percentile(0.95).toFixed(3)), maxMs: Number(Math.max(...timings).toFixed(3)) }, null, 2));
} finally {
  await store.close();
  await rm(dir, { recursive: true, force: true });
}
