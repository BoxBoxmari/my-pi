import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CoordinationClient, readDaemonMetadata } from "@my-pi/coordination-client";

const ROOT = path.resolve(".");
const DAEMON = path.join(ROOT, "apps", "my-pi-daemon", "dist", "main.js");
const MCP = path.join(ROOT, "apps", "my-pi-mcp", "dist", "main.js");

function startDaemon(runtimeDir: string): ChildProcess {
  return spawn(process.execPath, [DAEMON, "--workspace", ROOT, "--runtime-dir", runtimeDir], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
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

async function stop(processHandle: ChildProcess): Promise<void> {
  if (processHandle.exitCode !== null) return;
  const exited = Promise.race([once(processHandle, "exit"), once(processHandle, "close")]);
  processHandle.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

function capabilityData(response: { content: Array<{ type: string; text?: string }> }): any {
  return JSON.parse(response.content[0]!.text!).data;
}

test("PN4 MCP adapter: coordination mode exposes six opt-in tools backed by the daemon", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-mcp-coord-"));
  let daemon: ChildProcess | undefined;
  let client: Client | undefined;
  try {
    daemon = startDaemon(runtimeDir);
    const metadata = await waitForReady(runtimeDir, daemon);
    const health = await new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 1 }).health() as { projectId: string };

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP, "--workspace", ROOT, "--coordination", "--coordination-runtime-dir", runtimeDir],
      cwd: ROOT,
      stderr: "pipe",
    });
    client = new Client({ name: "my-pi-coordination-mcp-test", version: "1" });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.equal(names.length, 19);
    for (const name of ["coord_join", "coord_claim", "coord_intent", "coord_sync", "coord_publish", "coord_complete"]) assert.ok(names.includes(name));

    const joined = capabilityData(await client.callTool({
      name: "coord_join",
      arguments: {
        project: { displayName: "MCP coordination test" },
        repository: { id: "repo-mcp-test", projectId: health.projectId, vcs: "git", canonicalIdentity: "git:local:mcp-test" },
        worktree: { id: "worktree-mcp-test", repositoryId: "repo-mcp-test", root: ROOT, branch: "main", observedAt: "2026-09-04T00:00:00.000Z" },
        host: "mcp-test-host",
      },
    }));
    assert.equal(joined.projectHandle.projectId, health.projectId);

    const intent = capabilityData(await client.callTool({
      name: "coord_intent",
      arguments: { projectId: health.projectId, agentSessionId: joined.agentSessionId, kind: "investigate", summary: "verify MCP coordination wiring", targets: [] },
    }));
    assert.equal(intent.state, "active");
    const artifact = capabilityData(await client.callTool({
      name: "coord_publish",
      arguments: { projectId: health.projectId, agentSessionId: joined.agentSessionId, kind: "finding", contentDigest: "sha256:mcp1234", classification: "internal", retention: "until-superseded" },
    }));
    assert.equal(artifact.kind, "finding");
    const sync = capabilityData(await client.callTool({
      name: "coord_sync",
      arguments: { projectId: health.projectId, agentSessionId: joined.agentSessionId, sinceSequence: "0", maxEvents: 20, maxBytes: 64 * 1024 },
    }));
    assert.ok(sync.highPriority.length >= 2);
  } finally {
    await client?.close().catch(() => undefined);
    if (daemon) await stop(daemon);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("PN8 MCP adapter: evaluation mode exposes only the opt-in evaluation family", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-mcp-eval-"));
  let daemon: ChildProcess | undefined;
  let client: Client | undefined;
  try {
    daemon = startDaemon(runtimeDir);
    const metadata = await waitForReady(runtimeDir, daemon);
    const raw = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });
    const joined = await raw.call<{ agentSessionId: string }>("coord_join", {
      repository: { id: "repo-mcp-eval", projectId: metadata.projectId, vcs: "git", canonicalIdentity: "git:local:mcp-eval" },
      worktree: { id: "worktree-mcp-eval", repositoryId: "repo-mcp-eval", root: ROOT, branch: "main", observedAt: "2026-09-04T00:00:00.000Z" },
      host: "mcp-eval-host",
    });
    const spec = await raw.call<{ id: string }>("eval_register_spec", {
      name: "MCP evaluation",
      criteria: [{ id: "check", kind: "artifact", required: true, severity: "error", evaluatorRef: "deterministic-local", expected: true }],
    });
    const workItem = await raw.call<{ id: string }>("coord_create_work_item", { projectId: metadata.projectId, title: "MCP evaluation work", evaluationSpecId: spec.id });
    await raw.call("coord_claim", { projectId: metadata.projectId, agentSessionId: joined.agentSessionId, workItemId: workItem.id, expectedVersion: 0 });
    await raw.call("coord_complete", { projectId: metadata.projectId, agentSessionId: joined.agentSessionId, workItemId: workItem.id });
    const transport = new StdioClientTransport({ command: process.execPath, args: [MCP, "--workspace", ROOT, "--evaluation", "--coordination-runtime-dir", runtimeDir], cwd: ROOT, stderr: "pipe" });
    client = new Client({ name: "my-pi-evaluation-mcp-test", version: "1" });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.equal(names.length, 16);
    assert.ok(names.includes("eval_request"));
    assert.ok(names.includes("eval_record"));
    assert.ok(names.includes("eval_status"));
    assert.equal(names.includes("coord_join"), false);
    const requested = capabilityData(await client.callTool({ name: "eval_request", arguments: { specId: spec.id, workItemId: workItem.id, repositoryStateRef: "receipt-mcp-eval" } }));
    await client.callTool({ name: "eval_record", arguments: { runId: requested.id, providerResultId: "mcp-eval-result", providerId: "deterministic-local", criterionId: "check", result: { criterionId: "check", outcome: "pass", evidence: [{ provider: "deterministic-local", digest: "sha256:mcp1234", targetStateRef: "receipt-mcp-eval", observedAt: "2026-09-04T00:00:01.000Z" }] } } });
    await raw.call("eval_complete", { runId: requested.id });
    const status = capabilityData(await client.callTool({ name: "eval_status", arguments: { runId: requested.id } }));
    assert.equal(status.decision.decision, "accepted");
    assert.equal(joined.agentSessionId.length > 0, true);
  } finally {
    await client?.close().catch(() => undefined);
    if (daemon) await stop(daemon);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
