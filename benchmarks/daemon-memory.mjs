#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { CoordinationClient, readDaemonMetadata } from "../packages/coordination-client/dist/index.js";

const ROOT = path.resolve(".");
const daemonPath = path.join(ROOT, "apps", "my-pi-daemon", "dist", "main.js");
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-daemon-memory-"));
const daemon = spawn(process.execPath, [daemonPath, "--workspace", ROOT, "--runtime-dir", runtimeDir], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
const started = Date.now();
try {
  let metadata;
  while (!metadata) {
    metadata = await readDaemonMetadata(runtimeDir);
    if (daemon.exitCode !== null) throw new Error(`daemon exited before ready: ${daemon.exitCode}`);
    if (Date.now() - started > 10_000) throw new Error("daemon readiness timeout");
    if (!metadata) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const client = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });
  const samples = [];
  for (let index = 0; index < 100; index++) {
    const health = await client.health();
    samples.push(health.rssBytes);
  }
  console.log(JSON.stringify({ profile: "daemon-memory", samples: samples.length, initialRssBytes: samples[0], peakRssBytes: Math.max(...samples), finalRssBytes: samples[samples.length - 1], elapsedMs: Date.now() - started }, null, 2));
} finally {
  if (daemon.exitCode === null) {
    daemon.kill("SIGTERM");
    await Promise.race([once(daemon, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
  await rm(runtimeDir, { recursive: true, force: true });
}
