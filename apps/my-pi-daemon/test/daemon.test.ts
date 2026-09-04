import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import {
  CoordinationClient,
  readDaemonMetadata,
  type DaemonMetadata,
} from "@my-pi/coordination-client";

const ROOT = path.resolve(".");
const DAEMON = path.join(ROOT, "apps", "my-pi-daemon", "dist", "main.js");
const WORKER = path.join(ROOT, "apps", "my-pi-daemon", "test", "client-worker.mjs");

function startDaemon(runtimeDir: string, testMode = true): ChildProcess {
  const args = [DAEMON, "--workspace", ROOT, "--runtime-dir", runtimeDir];
  if (testMode) args.push("--test-mode");
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  (child as ChildProcess & { diagnosticStderr?: () => string }).diagnosticStderr = () => stderr;
  return child;
}

async function collect(processHandle: ChildProcess): Promise<{ code: number | null; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  processHandle.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  processHandle.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  if (processHandle.exitCode !== null) return { code: processHandle.exitCode, stdout, stderr };
  const [code, signal] = await once(processHandle, "exit") as [number | null, NodeJS.Signals | null];
  return { code: code ?? (signal ? 1 : null), stdout, stderr };
}

async function waitForReady(runtimeDir: string, processHandle: ChildProcess, previousPid?: number): Promise<DaemonMetadata> {
  const started = Date.now();
  for (;;) {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (metadata?.state === "ready" && (previousPid === undefined || metadata.pid !== previousPid)) return metadata;
    if (processHandle.exitCode !== null) throw new Error(`daemon exited before ready: ${processHandle.exitCode}: ${(processHandle as ChildProcess & { diagnosticStderr?: () => string }).diagnosticStderr?.() ?? "no stderr"}`);
    if (Date.now() - started > 10_000) throw new Error("daemon did not become ready within 10 seconds");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopDaemon(processHandle: ChildProcess, hard = false): Promise<void> {
  if (processHandle.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    const finish = () => {
      processHandle.off("exit", finish);
      processHandle.off("close", finish);
      resolve();
    };
    processHandle.once("exit", finish);
    processHandle.once("close", finish);
  });
  processHandle.kill(hard ? "SIGKILL" : "SIGTERM");
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function runWorker(runtimeDir: string, workerId: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return collect(spawn(process.execPath, [WORKER, runtimeDir, String(workerId)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }));
}

test("PN3: four independent Node processes share one local daemon and recover after a hard crash", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-daemon-test-"));
  let daemon: ChildProcess | undefined;
  let restarted: ChildProcess | undefined;
  try {
    if (process.platform !== "win32") await writeFile(path.join(runtimeDir, "daemon.sock"), "stale", "utf8");
    daemon = startDaemon(runtimeDir);
    const metadata = await waitForReady(runtimeDir, daemon);
    assert.ok(metadata.endpoint.transport === "named-pipe" || metadata.endpoint.transport === "unix");
    assert.notEqual(metadata.endpoint.transport, "tcp");

    const clients = await Promise.all([0, 1, 2, 3].map((workerId) => runWorker(runtimeDir, workerId)));
    assert.deepEqual(clients.map((result) => result.code), [0, 0, 0, 0]);

    const client = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });
    const page = await client.call<{ events: Array<{ sequence: string }>; throughSequence: string }>("list_events", {
      projectId: metadata.projectId,
    });
    assert.deepEqual(page.events.map((event) => event.sequence), ["1", "2", "3", "4"]);
    assert.equal(page.throughSequence, "4");

    await stopDaemon(daemon, true);
    restarted = startDaemon(runtimeDir);
    const restartedMetadata = await waitForReady(runtimeDir, restarted, metadata.pid);
    const recovered = await new CoordinationClient({ endpoint: restartedMetadata.endpoint, maxAttempts: 2 }).call<{ events: Array<{ sequence: string }> }>("list_events", {
      projectId: restartedMetadata.projectId,
    });
    assert.deepEqual(recovered.events.map((event) => event.sequence), ["1", "2", "3", "4"]);

    const mismatch = new CoordinationClient({ endpoint: restartedMetadata.endpoint, protocolVersion: "999", maxAttempts: 1 });
    await assert.rejects(mismatch.health(), (error: unknown) => (error as { code?: string }).code === "ERR_DAEMON_PROTOCOL_MISMATCH");
    const bounded = new CoordinationClient({ endpoint: restartedMetadata.endpoint, maxAttempts: 1 });
    await assert.rejects(bounded.call("health", { oversized: "x".repeat(300_000) }), RangeError);
  } finally {
    if (daemon) await stopDaemon(daemon).catch(() => undefined);
    if (restarted) await stopDaemon(restarted).catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("PN3: concurrent daemon startup admits one project owner", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-daemon-race-"));
  const first = startDaemon(runtimeDir);
  const second = startDaemon(runtimeDir);
  const firstResult = collect(first);
  const secondResult = collect(second);
  try {
    await Promise.any([waitForReady(runtimeDir, first), waitForReady(runtimeDir, second)]);
    const firstExit = await Promise.race([firstResult, secondResult]);
    assert.equal(firstExit.code, 1);
    assert.match(firstExit.stderr, /already owns this project|already running/i);
  } finally {
    if (first.exitCode === null) await stopDaemon(first).catch(() => undefined);
    if (second.exitCode === null) await stopDaemon(second).catch(() => undefined);
    await firstResult.catch(() => undefined);
    await secondResult.catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("PN4 IPC: join, intent, typed publication, and bounded sync use the daemon runtime", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-daemon-coord-"));
  let daemon: ChildProcess | undefined;
  try {
    daemon = startDaemon(runtimeDir);
    const metadata = await waitForReady(runtimeDir, daemon);
    const client = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });
    const joined = await client.call<{ projectHandle: { projectId: string }; agentSessionId: string; currentSequence: string }>("coord_join", {
      project: { displayName: "daemon coordination test" },
      repository: { id: "repo-daemon-test", projectId: metadata.projectId, vcs: "git", canonicalIdentity: "git:local:daemon-test" },
      worktree: { id: "worktree-daemon-test", repositoryId: "repo-daemon-test", root: ROOT, branch: "main", observedAt: "2026-09-04T00:00:00.000Z" },
      host: "daemon-test-host",
      clientInstance: "daemon-test-client",
    });
    assert.equal(joined.projectHandle.projectId, metadata.projectId);

    const intent = await client.call<{ state: string }>("coord_intent", {
      projectId: metadata.projectId,
      agentSessionId: joined.agentSessionId,
      kind: "investigate",
      summary: "inspect coordination IPC",
      targets: [],
    });
    assert.equal(intent.state, "active");

    const artifact = await client.call<{ kind: string; contentDigest: string }>("coord_publish", {
      projectId: metadata.projectId,
      agentSessionId: joined.agentSessionId,
      kind: "finding",
      contentDigest: "sha256:daemon1234",
      classification: "internal",
      retention: "until-superseded",
    });
    assert.equal(artifact.kind, "finding");

    const sync = await client.call<{ projectId: string; throughSequence: string; highPriority: unknown[]; normalPriority: unknown[] }>("coord_sync", {
      projectId: metadata.projectId,
      agentSessionId: joined.agentSessionId,
      sinceSequence: "0",
      maxEvents: 20,
      maxBytes: 64 * 1024,
    });
    assert.equal(sync.projectId, metadata.projectId);
    assert.ok(Number(sync.throughSequence) >= Number(joined.currentSequence));
    assert.ok(sync.highPriority.length >= 2);
    assert.equal(sync.normalPriority.length, 0);

    const indexed = await client.call<{ changedPath: string; entities: Array<{ kind: string }>; providerHealth: Record<string, { status: string }>}>("code_state_index", {
      projectId: metadata.projectId,
      repositoryId: "repo-daemon-test",
      worktreeId: "worktree-daemon-test",
      repositoryIdentity: "git:local:daemon-test",
      path: "README.md",
    });
    assert.equal(indexed.changedPath, "README.md");
    assert.ok(indexed.entities.some((entity) => entity.kind === "file"));
    assert.equal(indexed.providerHealth.fs.status, "ready");
    const snapshot = await client.call<{ entities: Array<{ path?: string }>; edges: unknown[] }>("code_state_snapshot", {
      projectId: metadata.projectId,
      worktreeId: "worktree-daemon-test",
    });
    assert.ok(snapshot.entities.some((entity) => entity.path === "README.md"));
  } finally {
    if (daemon) await stopDaemon(daemon).catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("PN10 ordinary IPC clients cannot append raw authoritative events", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-daemon-authority-"));
  let daemon: ChildProcess | undefined;
  try {
    daemon = startDaemon(runtimeDir, false);
    const metadata = await waitForReady(runtimeDir, daemon);
    const client = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 1 });
    await assert.rejects(
      client.call("append_event", { projectId: metadata.projectId, eventType: "ForgedEvent", actor: { kind: "system", name: "ordinary-client" }, payload: {} }),
      /explicit daemon test mode/,
    );
    await assert.rejects(
      client.call("idempotency_record", { clientId: "ordinary-client", key: "key", operationKind: "mutation", requestDigest: "sha256:forged" }),
      /explicit daemon test mode/,
    );
  } finally {
    if (daemon) await stopDaemon(daemon).catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("PN10 daemon binds worktrees and evaluation targets to server-observed state", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-daemon-state-authority-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "my-pi-daemon-outside-"));
  let daemon: ChildProcess | undefined;
  try {
    daemon = startDaemon(runtimeDir, false);
    const metadata = await waitForReady(runtimeDir, daemon);
    const client = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 1 });
    await client.call("coord_join", {
      repository: { id: "repo-authority-test", projectId: metadata.projectId, vcs: "git", canonicalIdentity: "caller-supplied-value" },
      worktree: { id: "worktree-authority-test", repositoryId: "repo-authority-test", root: ROOT, branch: "main", observedAt: "2026-09-04T00:00:00.000Z" },
      host: "authority-test-host",
    });
    const storedWorktree = await client.call<{ root: string }>("get_projection", { projectId: metadata.projectId, kind: "worktree", id: "worktree-authority-test" });
    assert.equal(path.resolve(storedWorktree.root), path.resolve(ROOT));
    const spec = await client.call<{ id: string }>("eval_register_spec", {
      name: "server target authority",
      criteria: [{ id: "check", kind: "artifact", required: true, severity: "critical", evaluatorRef: "deterministic-local", expected: true }],
    });
    const item = await client.call<{ id: string }>("coord_create_work_item", { projectId: metadata.projectId, title: "server target authority", evaluationSpecId: spec.id });
    await assert.rejects(
      client.call("eval_request", { specId: spec.id, workItemId: item.id, repositoryStateRef: "caller-forged-state" }),
      /server-verified change receipt/,
    );
    await assert.rejects(
      client.call("coord_join", {
        repository: { id: "repo-authority-outside", projectId: metadata.projectId, vcs: "git", canonicalIdentity: "caller-supplied-value" },
        worktree: { id: "worktree-authority-outside", repositoryId: "repo-authority-outside", root: outside, branch: "outside", observedAt: "2026-09-04T00:00:00.000Z" },
        host: "authority-test-outside",
      }),
      /not a Git repository|repository identity|workspace is not a Git repository/,
    );
  } finally {
    if (daemon) await stopDaemon(daemon).catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
