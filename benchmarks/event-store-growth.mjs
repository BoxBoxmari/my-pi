#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createProjectId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";

const count = 10_000;
const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-event-store-growth-"));
const databasePath = path.join(dir, "coordination.sqlite");
const projectId = createProjectId();
const store = new SqliteCoordinationStore(databasePath);
const started = performance.now();
try {
  await store.init();
  for (let index = 0; index < count; index++) await store.appendEvent({ projectId, eventType: "AgentHeartbeat", actor: { kind: "system", name: "event-growth" }, payload: { index, marker: "bounded" } });
  const details = await stat(databasePath);
  console.log(JSON.stringify({ profile: "event-store-growth", events: count, databaseBytes: details.size, elapsedMs: Number((performance.now() - started).toFixed(3)) }, null, 2));
} finally {
  await store.close();
  await rm(dir, { recursive: true, force: true });
}
