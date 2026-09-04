#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CoordinationClient } from "../packages/coordination-client/dist/index.js";
import { fingerprintBytes } from "../packages/contracts/dist/index.js";
import { ChangeRuntime } from "../packages/change-runtime/dist/index.js";
import { WorkspaceRuntime } from "../packages/workspace-runtime/dist/index.js";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const runtimeDir = value("--runtime-dir");
const action = value("--action");
const workspaceRoot = path.resolve(value("--workspace-root") ?? process.cwd());
const projectId = value("--project-id");
const sessionId = value("--session-id");
const workItemId = value("--work-item-id");
const expectedVersion = value("--expected-version");
const worktreeId = value("--worktree-id");
const role = value("--role") ?? "worker";
if (!runtimeDir || !action) throw new Error("--runtime-dir and --action are required");

const client = await CoordinationClient.fromRuntimeDir(runtimeDir, { maxAttempts: 3 });
const health = await client.health();
const activeProjectId = projectId ?? health.projectId;

async function join() {
  const repositoryId = `repo-dogfood-${role}`;
  const joinedWorktreeId = worktreeId ?? `worktree-dogfood-${role}`;
  return client.call("coord_join", {
    project: { displayName: "my-pi Production Next dogfood" },
    repository: { id: repositoryId, projectId: activeProjectId, vcs: "git", canonicalIdentity: "git:local:my-pi" },
    worktree: { id: joinedWorktreeId, repositoryId, root: workspaceRoot, branch: `dogfood/${role}`, observedAt: new Date().toISOString() },
    host: `dogfood-${role}`,
    clientInstance: `worker-${process.pid}`,
    role,
  });
}

async function change() {
  if (!projectId || !sessionId || !workItemId || expectedVersion === undefined || !worktreeId) {
    throw new Error("change actions require project/session/work item/expected version/worktree IDs");
  }
  const target = value("--target") ?? "dogfood/self-host-target.json";
  if (target.startsWith("/") || target.startsWith("\\") || /^[A-Za-z]:/.test(target) || target.split(/[\\/]/).includes("..")) {
    throw new Error("dogfood target must be a workspace-relative path");
  }
  const marker = value("--marker") ?? "attempt-1";
  const attempt = Number(value("--attempt") ?? "1");
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 10) throw new Error("dogfood attempt must be between 1 and 10");
  const claim = await client.call("coord_claim", { projectId, agentSessionId: sessionId, workItemId, expectedVersion: Number(expectedVersion) });
  const intent = await client.call("coord_intent", { projectId, agentSessionId: sessionId, workItemId, kind: "modify", summary: `${action === "retry-change" ? "authorized retry" : "bounded implementation"} for ${target}`, targets: [{ type: "path", value: target }] });
  const workspace = new WorkspaceRuntime();
  await workspace.open({ root: workspaceRoot, policy: { mode: "workspace-write" }, capabilities: { write: true } });
  const absolute = path.join(workspaceRoot, target);
  let current;
  try {
    current = new Uint8Array(await readFile(absolute));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const precondition = current === undefined
    ? { path: target, condition: "absent" }
    : { path: target, condition: "match", fingerprint: fingerprintBytes(current) };
  const bytes = current !== undefined && /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go)$/i.test(target)
    ? Buffer.from(`${Buffer.from(current).toString("utf8")}${Buffer.from(current).toString("utf8").endsWith("\n") ? "" : "\n"}// Production Next self-host marker: ${marker}\n`, "utf8")
    : Buffer.from(`${JSON.stringify({ schemaVersion: "1", marker, owner: role, attempt }, null, 2)}\n`, "utf8");
  const receipt = await new ChangeRuntime(workspace).applyBytes({
    projectId,
    worktreeId,
    agentSessionId: sessionId,
    workItemId,
    intentId: intent.id,
    path: target,
    precondition,
    bytes,
    planDigest: createHash("sha256").update(`dogfood:${target}:${marker}:${attempt}`, "utf8").digest("hex"),
  });
  const recorded = await client.call("change_record", { receipt });
  const artifact = await client.call("coord_publish", { projectId, agentSessionId: sessionId, workItemId, kind: "task_result", contentDigest: `sha256:${receipt.outputVersions?.[0]?.fingerprint?.digest ?? "missing"}`, classification: "internal", retention: "until-superseded" });
  return { claim, intent, receipt: recorded, artifact };
}

let result;
if (action === "join") {
  result = await join();
} else if (action === "backend-start") {
  result = {
    claim: await client.call("coord_claim", { projectId: activeProjectId, agentSessionId: sessionId, workItemId, expectedVersion: Number(expectedVersion) }),
    intent: await client.call("coord_intent", { projectId: activeProjectId, agentSessionId: sessionId, workItemId, kind: "change_contract", summary: "coordinate the backend contract layer", targets: [{ type: "path", value: "packages/contracts" }] }),
    artifact: await client.call("coord_publish", { projectId: activeProjectId, agentSessionId: sessionId, workItemId, kind: "interface_contract", contentDigest: "sha256:dogfood1234", classification: "internal", retention: "until-superseded" }),
  };
} else if (action === "frontend-block") {
  try {
    result = { claim: await client.call("coord_claim", { projectId: activeProjectId, agentSessionId: sessionId, workItemId, expectedVersion: Number(expectedVersion) }) };
  } catch (error) {
    result = { blocked: true, code: error.code, message: error.message };
  }
} else if (action === "sync") {
  result = await client.call("coord_sync", { projectId: activeProjectId, agentSessionId: sessionId, sinceSequence: value("--since-sequence") ?? "0", maxEvents: 100, maxBytes: 128 * 1024 });
} else if (action === "claim") {
  if (!projectId || !sessionId || !workItemId || expectedVersion === undefined) throw new Error("claim requires project/session/work item/expected version IDs");
  result = await client.call("coord_claim", { projectId, agentSessionId: sessionId, workItemId, expectedVersion: Number(expectedVersion) });
} else if (action === "intent") {
  if (!projectId || !sessionId || !workItemId) throw new Error("intent requires project/session/work item IDs");
  const target = value("--target") ?? "dogfood/self-host-target.json";
  result = await client.call("coord_intent", { projectId, agentSessionId: sessionId, workItemId, kind: value("--kind") ?? "modify", summary: value("--summary") ?? `declare intent for ${target}`, targets: [{ type: "path", value: target }] });
} else if (action === "review") {
  if (!projectId || !sessionId || !workItemId || expectedVersion === undefined) throw new Error("review requires project/session/work item/expected version IDs");
  const claim = await client.call("coord_claim", { projectId, agentSessionId: sessionId, workItemId, expectedVersion: Number(expectedVersion) });
  const intent = await client.call("coord_intent", { projectId, agentSessionId: sessionId, workItemId, kind: "verify", summary: "review the accepted self-host change", targets: [{ type: "path", value: "dogfood/self-host-target.json" }] });
  const sync = await client.call("coord_sync", { projectId, agentSessionId: sessionId, sinceSequence: "0", maxEvents: 100, maxBytes: 128 * 1024 });
  const completed = await client.call("coord_complete", { projectId, agentSessionId: sessionId, workItemId });
  result = { claim, intent, sync, completed };
} else if (action === "complete") {
  result = await client.call("coord_complete", { projectId: activeProjectId, agentSessionId: sessionId, workItemId });
} else if (action === "change" || action === "retry-change") {
  result = await change();
} else if (action === "complete-gated") {
  if (!projectId || !sessionId || !workItemId) throw new Error("complete-gated requires project/session/work item IDs");
  result = await client.call("coord_complete", { projectId, agentSessionId: sessionId, workItemId, evaluationRunId: value("--evaluation-run-id") });
} else {
  throw new Error(`unsupported dogfood worker action: ${action}`);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
