import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { CoordinationClient, readDaemonMetadata } from "@my-pi/coordination-client";

const ROOT = path.resolve(".");
const DAEMON = path.join(ROOT, "apps", "my-pi-daemon", "dist", "main.js");

function startDaemon(runtimeDir: string): ChildProcess {
  return spawn(process.execPath, [DAEMON, "--workspace", ROOT, "--runtime-dir", runtimeDir], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}

async function waitForReady(runtimeDir: string, daemon: ChildProcess) {
  const started = Date.now();
  for (;;) {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (metadata?.state === "ready") return metadata;
    if (daemon.exitCode !== null) throw new Error(`daemon exited before ready: ${daemon.exitCode}`);
    if (Date.now() - started > 10_000) throw new Error("daemon did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopDaemon(daemon: ChildProcess): Promise<void> {
  if (daemon.exitCode !== null) return;
  const exited = Promise.race([once(daemon, "exit"), once(daemon, "close")]);
  daemon.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

test("PN8 IPC: evaluator records exact-state evidence and returns acceptance state", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-daemon-eval-"));
  let daemon: ChildProcess | undefined;
  try {
    daemon = startDaemon(runtimeDir);
    const metadata = await waitForReady(runtimeDir, daemon);
    const client = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });
    const joined = await client.call<{ agentSessionId: string }>("coord_join", {
      repository: { id: "repo-eval-test", projectId: metadata.projectId, vcs: "git", canonicalIdentity: "git:local:eval-test" },
      worktree: { id: "worktree-eval-test", repositoryId: "repo-eval-test", root: ROOT, branch: "main", observedAt: "2026-09-04T00:00:00.000Z" },
      host: "eval-test-host",
    });
    const spec = await client.call<{ id: string; specDigest: string }>("eval_register_spec", {
      name: "daemon acceptance",
      criteria: [{ id: "contract", kind: "artifact", required: true, severity: "critical", evaluatorRef: "deterministic-local", expected: true }],
    });
    assert.match(spec.specDigest, /^[a-f0-9]{64}$/);
    const workItem = await client.call<{ id: string }>("coord_create_work_item", { projectId: metadata.projectId, title: "evaluation-gated work", evaluationSpecId: spec.id });
    await client.call("coord_claim", { projectId: metadata.projectId, agentSessionId: joined.agentSessionId, workItemId: workItem.id, expectedVersion: 0 });
    const awaiting = await client.call<{ workItem: { state: string } }>("coord_complete", { projectId: metadata.projectId, agentSessionId: joined.agentSessionId, workItemId: workItem.id });
    assert.equal(awaiting.workItem.state, "awaiting_evaluation");
    const run = await client.call<{ id: string }>("eval_request", { specId: spec.id, workItemId: workItem.id, repositoryStateRef: "receipt-eval-1" });
    await client.call("eval_record", {
      runId: run.id,
      providerResultId: "result-eval-1",
      providerId: "deterministic-local",
      criterionId: "contract",
      result: { criterionId: "contract", outcome: "pass", evidence: [{ provider: "deterministic-local", digest: "sha256:eval1234", targetStateRef: "receipt-eval-1", observedAt: "2026-09-04T00:00:01.000Z" }] },
    });
    await client.call("eval_complete", { runId: run.id });
    const status = await client.call<{ run: { state: string }; decision?: { decision: string }; feedback?: unknown; retry?: unknown }>("eval_status", { runId: run.id });
    assert.equal(status.run.state, "completed");
    assert.equal(status.decision?.decision, "accepted");
    assert.equal(status.feedback, undefined);
    assert.equal(status.retry, undefined);
    const done = await client.call<{ workItem: { state: string } }>("coord_complete", { projectId: metadata.projectId, agentSessionId: joined.agentSessionId, workItemId: workItem.id, evaluationRunId: run.id });
    assert.equal(done.workItem.state, "done");
    assert.equal(joined.agentSessionId.length > 0, true);
  } finally {
    if (daemon) await stopDaemon(daemon);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
