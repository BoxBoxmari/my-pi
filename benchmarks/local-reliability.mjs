#!/usr/bin/env node
/**
 * Local PN12 recovery/fault qualification. All state is created under a
 * temporary directory and removed at the end; this script never mutates the
 * repository source tree.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { CoordinationClient, encodeFrame, readDaemonMetadata } from "../packages/coordination-client/dist/index.js";
import { createProjectId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";
import { EvaluationRuntime } from "../packages/evaluation-runtime/dist/index.js";
import { makeRetryCycle } from "../packages/evaluation-runtime/dist/index.js";
import { candidateCommit, candidateDirty, candidateStateDigest } from "../scripts/candidate-state.mjs";

const ROOT = path.resolve(".");
const DAEMON = path.join(ROOT, "apps", "my-pi-daemon", "dist", "main.js");

function assertCondition(value, message) {
  if (!value) throw new Error(message);
}

function startDaemon(runtimeDir, databasePath) {
  const child = spawn(process.execPath, [DAEMON, "--workspace", ROOT, "--runtime-dir", runtimeDir, "--database", databasePath], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  child.diagnosticStderr = () => stderr;
  return child;
}

async function ready(runtimeDir, daemon) {
  const started = Date.now();
  for (;;) {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (metadata?.state === "ready" && metadata.pid === daemon.pid) return metadata;
    if (daemon.exitCode !== null) throw new Error(`daemon exited before recovery test was ready: ${daemon.exitCode}: ${daemon.diagnosticStderr?.() ?? "no stderr"}`);
    if (Date.now() - started > 10_000) throw new Error("daemon recovery readiness timeout");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopDaemon(daemon) {
  if (daemon.exitCode !== null) return;
  const exited = Promise.race([once(daemon, "exit"), once(daemon, "close")]);
  daemon.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function hardKill(daemon) {
  if (daemon.exitCode !== null) return;
  const exited = Promise.race([once(daemon, "exit"), once(daemon, "close")]);
  daemon.kill("SIGKILL");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function evaluatorFailureCheck() {
  const store = new SqliteCoordinationStore(":memory:");
  const projectId = createProjectId();
  try {
    await store.init();
    await store.transact((tx) => {
      tx.putProjection("project", projectId, { id: projectId, schemaVersion: "1", createdAt: "2026-09-04T00:00:00.000Z" }, projectId);
      tx.putProjection("work_item", "work-reliability", { id: "work-reliability", projectId, title: "reliability", state: "ready", version: 0, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" }, projectId);
    });
    const provider = { id: "faulty-provider", supports: () => true, evaluate: async () => { throw new Error("fault injected"); } };
    const evaluation = new EvaluationRuntime(store, projectId, [provider]);
    const spec = await evaluation.registerSpec({ name: "fault", criteria: [{ id: "check", kind: "artifact", required: true, severity: "critical", evaluatorRef: provider.id, expected: true }] });
    const run = await evaluation.requestRun({ specId: spec.id, workItemId: "work-reliability", repositoryStateRef: "tree:fault" });
    const status = await evaluation.evaluateRun(run.id, { check: true });
    return { pass: status.run.state === "completed" && status.decision?.decision === "inconclusive" && status.results[0]?.result.reasonCode === "EVALUATOR_ERROR" };
  } finally {
    await store.close();
  }
}

async function staleEvidenceCheck() {
  const store = new SqliteCoordinationStore(":memory:");
  const projectId = createProjectId();
  try {
    await store.init();
    await store.transact((tx) => {
      tx.putProjection("project", projectId, { id: projectId, schemaVersion: "1", createdAt: "2026-09-04T00:00:00.000Z" }, projectId);
      tx.putProjection("work_item", "work-stale", { id: "work-stale", projectId, title: "stale", state: "ready", version: 0, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" }, projectId);
    });
    const evaluation = new EvaluationRuntime(store, projectId);
    const spec = await evaluation.registerSpec({ name: "stale", criteria: [{ id: "check", kind: "artifact", required: true, severity: "critical", evaluatorRef: "fixture", expected: true }] });
    const run = await evaluation.requestRun({ specId: spec.id, workItemId: "work-stale", repositoryStateRef: "tree:new" });
    let rejected = false;
    try {
      await evaluation.recordResult(run.id, { providerResultId: "stale-result", providerId: "fixture", criterionId: "check", result: { criterionId: "check", outcome: "pass", evidence: [{ provider: "fixture", digest: "sha256:old", targetStateRef: "tree:old", observedAt: "2026-09-04T00:00:00.000Z" }] } });
    } catch (error) {
      rejected = error?.code === "ERR_EVALUATION_TARGET_STALE";
    }
    return { pass: rejected };
  } finally {
    await store.close();
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), "my-pi-local-reliability-"));
const runtimeDir = path.join(root, "runtime");
const databasePath = path.join(root, "coordination.sqlite");
let daemon;
let recoveredDaemon;
const started = performance.now();
try {
  daemon = startDaemon(runtimeDir, databasePath);
  const metadata = await ready(runtimeDir, daemon);
  const client = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 1 });
  const event = await client.call("append_event", { projectId: metadata.projectId, eventType: "RecoveryProbe", actor: { kind: "system", name: "local-reliability" }, payload: { marker: "committed-before-crash" } });
  const crashStarted = performance.now();
  await hardKill(daemon);
  recoveredDaemon = startDaemon(runtimeDir, databasePath);
  const recoveredMetadata = await ready(runtimeDir, recoveredDaemon);
  const recoveredClient = new CoordinationClient({ endpoint: recoveredMetadata.endpoint, maxAttempts: 1 });
  const events = await recoveredClient.call("list_events", { projectId: metadata.projectId, afterSequence: "0", limit: 100, maxBytes: 128 * 1024 });
  const persisted = events.events.some((item) => item.eventType === "RecoveryProbe" && item.payload?.marker === "committed-before-crash");
  const direct = new SqliteCoordinationStore(databasePath);
  await direct.init();
  const idempotencyInput = { clientId: "reliability", key: "same-request", operationKind: "append", requestDigest: "sha256:request" };
  await direct.recordIdempotency(idempotencyInput);
  const sameIdempotency = await direct.checkIdempotency(idempotencyInput);
  await direct.close();
  const staleEvidence = await staleEvidenceCheck();
  const evaluatorFailure = await evaluatorFailureCheck();
  const retry = makeRetryCycle({ id: "evalrun-reliability", specId: "evalspec-reliability", specVersion: 1, workItemId: "work-reliability", repositoryStateRef: "tree:retry", attempt: 3, state: "completed" }, "recommended", ["FAIL"], ["preserve"], 3);
  let oversizedFrameRejected = false;
  try {
    encodeFrame({ payload: "x".repeat(300_000) });
  } catch {
    oversizedFrameRejected = true;
  }
  const sourceState = await candidateStateDigest();
  const report = {
    profile: "local-reliability",
    evidenceKind: "local_fault_qualification",
    platform: process.platform,
    node: process.version,
    scenarios: {
      committedEventSurvivesHardCrash: persisted,
      idempotencyReplayIsStable: sameIdempotency?.requestDigest === idempotencyInput.requestDigest,
      staleEvaluationEvidenceRejected: staleEvidence.pass,
      evaluatorFailureIsInconclusive: evaluatorFailure.pass,
      retryBudgetExhaustion: retry.state === "exhausted",
      oversizedIpcFrameRejected: oversizedFrameRejected,
    },
    metrics: { crashRecoveryMs: Number((performance.now() - crashStarted).toFixed(3)), totalMs: Number((performance.now() - started).toFixed(3)), recoveredEventSequence: event.sequence },
    sourceStateDigest: sourceState,
    untestedFaults: ["disk-full", "permission-loss", "artifact-store-disk-full", "LSP-crash-loop", "Git-cancellation", "enterprise-network-partition", "PostgreSQL-failover"],
  };
  if (!Object.values(report.scenarios).every(Boolean)) throw new Error(`local reliability scenario failed: ${JSON.stringify(report.scenarios)}`);
  const outputArg = process.argv.indexOf("--evidence-out");
  const output = outputArg < 0 ? undefined : process.argv[outputArg + 1];
  if (outputArg >= 0 && !output) throw new Error("--evidence-out requires a path");
  if (output === undefined) console.log(JSON.stringify(report, null, 2));
  else {
    const outputPath = path.resolve(ROOT, output);
    const relative = path.relative(ROOT, outputPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--evidence-out must stay inside the repository");
    const commit = candidateCommit();
    const dirty = candidateDirty();
    const evidence = { schemaVersion: "1", id: "PN12", profile: report.profile, status: "CANDIDATE", evidenceKind: report.evidenceKind, commit, candidateSha: dirty ? "uncommitted" : commit, candidateDirty: dirty, candidateStateDigest: sourceState, promotionEligible: false, report };
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ profile: report.profile, evidencePath: relative.replaceAll(path.sep, "/"), candidateSha: evidence.candidateSha, candidateDirty: evidence.candidateDirty }, null, 2));
  }
} finally {
  if (daemon) await stopDaemon(daemon).catch(() => undefined);
  if (recoveredDaemon) await stopDaemon(recoveredDaemon).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
