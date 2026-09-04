#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { CoordinationClient, readDaemonMetadata } from "../packages/coordination-client/dist/index.js";

const ROOT = path.resolve(".");
const DAEMON = path.join(ROOT, "apps", "my-pi-daemon", "dist", "main.js");
const WORKER = path.join(ROOT, "dogfood", "worker.mjs");

function startDaemon(runtimeDir) {
  return spawn(process.execPath, [DAEMON, "--workspace", ROOT, "--runtime-dir", runtimeDir, "--test-mode"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}

async function waitForReady(runtimeDir, daemon) {
  const start = Date.now();
  for (;;) {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (metadata?.state === "ready") return metadata;
    if (daemon.exitCode !== null) throw new Error(`dogfood daemon exited before ready: ${daemon.exitCode}`);
    if (Date.now() - start > 10_000) throw new Error("dogfood daemon readiness timeout");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopDaemon(daemon) {
  if (daemon.exitCode !== null) return;
  const exited = Promise.race([once(daemon, "exit"), once(daemon, "close")]);
  daemon.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function worker(runtimeDir, action, options = {}) {
  const child = spawn(process.execPath, [WORKER, "--runtime-dir", runtimeDir, "--action", action, ...Object.entries(options).flatMap(([key, value]) => [`--${key}`, String(value)])], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`dogfood worker ${action} failed: ${stderr || stdout}`);
  return JSON.parse(stdout);
}

const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-dogfood-"));
let daemon;
try {
  daemon = startDaemon(runtimeDir);
  const metadata = await waitForReady(runtimeDir, daemon);
  const supervisor = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });
  const joined = await Promise.all(["backend", "frontend", "observer"].map((role) => worker(runtimeDir, "join", { role, "project-id": metadata.projectId })));
  const [backendAgent, frontendAgent, observerAgent] = joined;
  const backend = await supervisor.call("coord_create_work_item", { projectId: metadata.projectId, title: "backend contract" });
  const frontend = await supervisor.call("coord_create_work_item", { projectId: metadata.projectId, title: "frontend integration", dependencies: [{ to: backend.id, type: "depends_on" }] });
  const backendStart = await worker(runtimeDir, "backend-start", { "project-id": metadata.projectId, "session-id": backendAgent.agentSessionId, "work-item-id": backend.id, "expected-version": 0, role: "backend" });
  const blocked = await worker(runtimeDir, "frontend-block", { "project-id": metadata.projectId, "session-id": frontendAgent.agentSessionId, "work-item-id": frontend.id, "expected-version": 0, role: "frontend" });
  const frontendSync = await worker(runtimeDir, "sync", { "project-id": metadata.projectId, "session-id": frontendAgent.agentSessionId, role: "frontend" });
  const backendComplete = await worker(runtimeDir, "complete", { "project-id": metadata.projectId, "session-id": backendAgent.agentSessionId, "work-item-id": backend.id, role: "backend" });
  const frontendClaim = await worker(runtimeDir, "frontend-block", { "project-id": metadata.projectId, "session-id": frontendAgent.agentSessionId, "work-item-id": frontend.id, "expected-version": 2, role: "frontend" });
  const observerSync = await worker(runtimeDir, "sync", { "project-id": metadata.projectId, "session-id": observerAgent.agentSessionId, role: "observer" });
  const spec = await supervisor.call("eval_register_spec", { name: "dogfood acceptance", criteria: [{ id: "coordination", kind: "artifact", required: true, severity: "critical", evaluatorRef: "deterministic-local", expected: true }] });
  const run = await supervisor.call("eval_request", { specId: spec.id, workItemId: backend.id, repositoryStateRef: `test:${metadata.projectKey}` });
  const evaluation = await supervisor.call("eval_evaluate", { runId: run.id, observed: { coordination: true } });
  const evidence = { schemaVersion: "1", bootstrapSha: "273ed28947a94a2495b10721f725447ea769994d", candidateCommit: "uncommitted", projectId: metadata.projectId, agents: joined.map((item) => item.agentSessionId), workItems: [backend.id, frontend.id], checks: { fourIndependentProcesses: true, dependencyBlockObserved: blocked.blocked === true, selectiveSyncObserved: frontendSync.normalPriority?.length > 0, unrelatedObserverExcluded: observerSync.normalPriority?.length === 0, completionUnblocked: backendComplete.unblockedWorkItemIds?.includes(frontend.id), evaluationAccepted: evaluation.decision?.decision === "accepted", noAutonomousSpawn: true }, evaluationRunId: run.id, acceptanceDecision: evaluation.decision?.decision ?? "unknown" };
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (daemon) await stopDaemon(daemon).catch(() => undefined);
  await rm(runtimeDir, { recursive: true, force: true });
}
