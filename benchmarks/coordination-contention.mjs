#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createProjectId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";

const workers = 4;
const eventsPerWorker = 100;
const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-coordination-contention-"));
const databasePath = path.join(dir, "coordination.sqlite");
const projectId = createProjectId();
const workerScript = path.join(process.cwd(), "benchmarks", "coordination-contention-worker.mjs");
const started = Date.now();
try {
  const seed = new SqliteCoordinationStore(databasePath);
  await seed.init();
  await seed.close();
  const children = Array.from({ length: workers }, (_, index) => spawn(process.execPath, [workerScript, databasePath, projectId, String(index), String(eventsPerWorker)], { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"], windowsHide: true }));
  const exits = await Promise.all(children.map(async (child) => { const [code] = await once(child, "exit"); return code; }));
  const verify = new SqliteCoordinationStore(databasePath);
  await verify.init();
  try {
    const page = await verify.listEvents({ projectId, limit: workers * eventsPerWorker });
    console.log(JSON.stringify({ profile: "coordination-contention", workers, eventsPerWorker, exitCodes: exits, observedEvents: page.events.length, elapsedMs: Date.now() - started }, null, 2));
  } finally {
    await verify.close();
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
