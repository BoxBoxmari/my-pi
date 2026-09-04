#!/usr/bin/env node
import { stat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createProjectId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";

function parseEvents(argv) {
  const index = argv.indexOf("--events");
  const value = index >= 0 ? Number(argv[index + 1]) : 1000;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) throw new Error("--events must be an integer between 1 and 100000");
  return value;
}

const eventCount = parseEvents(process.argv.slice(2));
const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-coordination-bench-"));
const dbPath = path.join(dir, "coordination.sqlite");
const store = new SqliteCoordinationStore(dbPath);
const projectId = createProjectId();
const started = performance.now();
try {
  await store.init();
  for (let index = 0; index < eventCount; index++) {
    await store.appendEvent({
      projectId,
      eventType: "AgentHeartbeat",
      actor: { kind: "system", name: "coordination-store-benchmark" },
      payload: { index },
    });
  }
  const elapsedMs = performance.now() - started;
  const details = await stat(dbPath);
  console.log(JSON.stringify({
    profile: "coordination-store",
    eventCount,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    eventsPerSecond: Number((eventCount / (elapsedMs / 1000)).toFixed(2)),
    databaseBytes: details.size,
  }, null, 2));
} finally {
  await store.close();
  await rm(dir, { recursive: true, force: true });
}
