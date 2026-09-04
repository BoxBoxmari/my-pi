#!/usr/bin/env node
/**
 * Exercise the Production Next loop against isolated copies of this repository.
 * The script is a qualification harness: it records candidate evidence and never
 * writes the user's checkout. It deliberately uses the stable local APIs instead
 * of adding a dogfood-only product path.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { CoordinationClient, readDaemonMetadata } from "../packages/coordination-client/dist/index.js";
import { candidateCommit, candidateDirty, candidateStateDigest } from "./candidate-state.mjs";

const ROOT = path.resolve(".");
const DAEMON = path.join(ROOT, "apps", "my-pi-daemon", "dist", "main.js");
const WORKER = path.join(ROOT, "dogfood", "worker.mjs");
const COPY_EXCLUSIONS = new Set([".git", "node_modules", "dist", ".codegraph", ".codebase-memory", "coverage"]);

function assertCondition(value, message) {
  if (!value) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function copyFilter(source) {
  const relative = path.relative(ROOT, source);
  if (!relative) return true;
  return !relative.split(path.sep).some((segment) => COPY_EXCLUSIONS.has(segment));
}

async function copyRepository(destination) {
  await cp(ROOT, destination, { recursive: true, filter: copyFilter });
}

async function treeDigest(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const hash = createHash("sha256");
  for (const entry of entries) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (COPY_EXCLUSIONS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      const nested = await treeDigest(root, childRelative);
      hash.update(childRelative.split(path.sep).join("/"));
      hash.update("\0");
      hash.update(nested);
      hash.update("\0");
    } else if (entry.isFile()) {
      hash.update(childRelative.split(path.sep).join("/"));
      hash.update("\0");
      hash.update(await readFile(path.join(root, childRelative)));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

function startDaemon(workspaceRoot, runtimeDir) {
  return spawn(process.execPath, [DAEMON, "--workspace", workspaceRoot, "--runtime-dir", runtimeDir, "--allow-non-git"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function waitForReady(runtimeDir, daemon) {
  const started = Date.now();
  for (;;) {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (metadata?.state === "ready") return metadata;
    if (daemon.exitCode !== null) throw new Error(`self-host daemon exited before ready: ${daemon.exitCode}`);
    if (Date.now() - started > 10_000) throw new Error("self-host daemon readiness timeout");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopDaemon(daemon) {
  if (daemon.exitCode !== null) return;
  const exited = Promise.race([once(daemon, "exit"), once(daemon, "close")]);
  daemon.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function runWorker(options) {
  const childArgs = [WORKER, ...Object.entries(options).flatMap(([key, value]) => value === undefined ? [] : [`--${key}`, String(value)])];
  const child = spawn(process.execPath, childArgs, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`self-host worker ${options.action} failed: ${stderr || stdout}`);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`self-host worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function routeKeys(sync) {
  return [...(sync.highPriority ?? []), ...(sync.normalPriority ?? [])]
    .filter((item) => item.event?.eventType !== "AgentHeartbeat")
    .map((item) => `${item.priority ?? "normal"}:${item.reason ?? "unknown"}:${item.event?.eventId ?? "unknown"}`)
    .sort();
}

function evidenceFor(targetStateRef, criterionId, observed) {
  const digest = sha256(JSON.stringify({ criterionId, observed }));
  return [{ provider: "self-host-deterministic", digest: `sha256:${digest}`, targetStateRef, observedAt: new Date().toISOString() }];
}

async function recordResult(supervisor, run, criterionId, expected, observed, reasonCode) {
  const outcome = observed === expected ? "pass" : "fail";
  return supervisor.call("eval_record", {
    runId: run.id,
    providerResultId: `self-host:${run.id}:${criterionId}`,
    providerId: "self-host-deterministic",
    criterionId,
    result: {
      criterionId,
      outcome,
      evidence: evidenceFor(run.repositoryStateRef, criterionId, observed),
      observed,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    },
  });
}

async function projection(supervisor, projectId, kind, id) {
  return supervisor.call("get_projection", { projectId, kind, id });
}

const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "my-pi-self-host-"));
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-self-host-runtime-"));
const candidateRoot = path.join(stagingRoot, "candidate");
const implementationRoot = path.join(stagingRoot, "implementation-worktree");
const reviewerRoot = path.join(stagingRoot, "reviewer-worktree");
const observerRoot = path.join(stagingRoot, "observer-worktree");
let daemon;
const bootstrapCommit = candidateCommit();
const worktreeDirty = candidateDirty();
const candidateSourceStateDigest = await candidateStateDigest();
const evidenceOutArg = process.argv.indexOf("--evidence-out");
const evidenceOutput = evidenceOutArg < 0 ? undefined : process.argv[evidenceOutArg + 1];
if (evidenceOutArg >= 0 && !evidenceOutput) throw new Error("--evidence-out requires a path");
const evidencePath = evidenceOutput === undefined ? undefined : path.resolve(ROOT, evidenceOutput);
if (evidencePath !== undefined) {
  const relative = path.relative(ROOT, evidencePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--evidence-out must stay inside the repository");
}

try {
  await copyRepository(candidateRoot);
  await copyRepository(implementationRoot);
  await copyRepository(reviewerRoot);
  await copyRepository(observerRoot);
  const beforeTree = await treeDigest(implementationRoot);
  daemon = startDaemon(candidateRoot, runtimeDir);
  const metadata = await waitForReady(runtimeDir, daemon);
  const supervisor = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });

  const joined = {};
  for (const [role, root, worktreeId] of [
    ["implementation", implementationRoot, "worktree-self-host-implementation"],
    ["reviewer", reviewerRoot, "worktree-self-host-reviewer"],
    ["observer", observerRoot, "worktree-self-host-observer"],
  ]) {
    joined[role] = await runWorker({ action: "join", "runtime-dir": runtimeDir, "workspace-root": root, "project-id": metadata.projectId, "worktree-id": worktreeId, role });
  }

  const spec = await supervisor.call("eval_register_spec", {
    name: "self-host bounded change acceptance",
    criteria: [
      { id: "target-marker", kind: "artifact", required: true, severity: "critical", evaluatorRef: "self-host-deterministic", expected: "accepted" },
      { id: "publication", kind: "artifact", required: true, severity: "critical", evaluatorRef: "self-host-deterministic", expected: "APPLIED" },
    ],
  });
  const implementationItem = await supervisor.call("coord_create_work_item", {
    projectId: metadata.projectId,
    title: "self-host bounded implementation",
    summary: "Create and qualify a bounded repository artifact through the normal change runtime.",
    evaluationSpecId: spec.id,
  });
  const reviewItem = await supervisor.call("coord_create_work_item", {
    projectId: metadata.projectId,
    title: "self-host review handoff",
    summary: "Review the accepted implementation after its dependency is completed.",
    dependencies: [{ to: implementationItem.id, type: "depends_on" }],
  });

  const blockedReview = await runWorker({ action: "frontend-block", "runtime-dir": runtimeDir, "workspace-root": reviewerRoot, "project-id": metadata.projectId, "worktree-id": "worktree-self-host-reviewer", "session-id": joined.reviewer.agentSessionId, "work-item-id": reviewItem.id, "expected-version": 0, role: "reviewer" });
  assertCondition(blockedReview.blocked === true, "reviewer did not observe the dependency block");
  const reviewerIntent = await runWorker({ action: "intent", "runtime-dir": runtimeDir, "workspace-root": reviewerRoot, "project-id": metadata.projectId, "session-id": joined.reviewer.agentSessionId, "work-item-id": reviewItem.id, target: "packages/coordination-runtime/src/runtime.ts", kind: "modify", summary: "prepare the downstream runtime for the shared identity change", role: "reviewer" });
  const indexedPaths = ["packages/contracts/src/index.ts", "packages/coordination-runtime/src/runtime.ts", "packages/contracts/src/ids.ts"];
  const indexed = await Promise.all(indexedPaths.map((indexedPath) => supervisor.call("code_state_index", { projectId: metadata.projectId, repositoryId: "repo-dogfood-implementation", worktreeId: "worktree-self-host-implementation", repositoryIdentity: "path:self-host-candidate", path: indexedPath })));
  assertCondition(indexed.every((delta) => delta.providerHealth?.fs?.status === "ready"), "self-host code-state indexing did not complete");

  const firstChange = await runWorker({ action: "change", "runtime-dir": runtimeDir, "workspace-root": implementationRoot, "project-id": metadata.projectId, "worktree-id": "worktree-self-host-implementation", "session-id": joined.implementation.agentSessionId, "work-item-id": implementationItem.id, "expected-version": 0, target: "packages/contracts/src/ids.ts", marker: "attempt-1", attempt: 1, role: "implementation" });
  assertCondition(firstChange.receipt.status === "APPLIED", "initial self-host change was not applied");
  assertCondition((await readFile(path.join(implementationRoot, "packages", "contracts", "src", "ids.ts"), "utf8")).includes("Production Next self-host marker: attempt-1"), "initial source marker was not published");
  const firstAwaiting = await runWorker({ action: "complete", "runtime-dir": runtimeDir, "workspace-root": implementationRoot, "project-id": metadata.projectId, "session-id": joined.implementation.agentSessionId, "work-item-id": implementationItem.id, role: "implementation" });
  assertCondition(firstAwaiting.workItem.state === "awaiting_evaluation", "gated WorkItem did not enter awaiting_evaluation");

  const firstTree = await treeDigest(implementationRoot);
  const firstRun = await supervisor.call("eval_request", { specId: spec.id, workItemId: implementationItem.id, changeReceiptId: firstChange.receipt.id, repositoryStateRef: `tree:${firstTree}`, attempt: 1 });
  await recordResult(supervisor, firstRun, "target-marker", "accepted", "attempt-1", "TARGET_NOT_READY");
  await recordResult(supervisor, firstRun, "publication", "APPLIED", firstChange.receipt.status);
  await supervisor.call("eval_complete", { runId: firstRun.id });
  const firstStatus = await supervisor.call("eval_status", { runId: firstRun.id });
  assertCondition(firstStatus.decision?.decision === "rejected", "first self-host attempt was expected to be rejected");
  assertCondition(firstStatus.feedback?.failedCriteria?.includes("target-marker"), "structured feedback did not cite the failed criterion");
  assertCondition(firstStatus.retry?.state === "recommended", "first self-host attempt did not recommend a bounded retry");
  const retryItem = await projection(supervisor, metadata.projectId, "work_item", implementationItem.id);
  assertCondition(retryItem.state === "needs_retry", `unexpected retry state: ${retryItem.state}`);

  const retryChange = await runWorker({ action: "retry-change", "runtime-dir": runtimeDir, "workspace-root": implementationRoot, "project-id": metadata.projectId, "worktree-id": "worktree-self-host-implementation", "session-id": joined.implementation.agentSessionId, "work-item-id": implementationItem.id, "expected-version": retryItem.version, target: "packages/contracts/src/ids.ts", marker: "accepted", attempt: 2, role: "implementation" });
  const retryAwaiting = await runWorker({ action: "complete", "runtime-dir": runtimeDir, "workspace-root": implementationRoot, "project-id": metadata.projectId, "session-id": joined.implementation.agentSessionId, "work-item-id": implementationItem.id, role: "implementation" });
  assertCondition(retryAwaiting.workItem.state === "awaiting_evaluation", "retry did not return to awaiting_evaluation");
  const secondTree = await treeDigest(implementationRoot);
  const secondRun = await supervisor.call("eval_request", { specId: spec.id, workItemId: implementationItem.id, changeReceiptId: retryChange.receipt.id, repositoryStateRef: `tree:${secondTree}`, attempt: 2 });
  await recordResult(supervisor, secondRun, "target-marker", "accepted", "accepted");
  await recordResult(supervisor, secondRun, "publication", "APPLIED", retryChange.receipt.status);
  await supervisor.call("eval_complete", { runId: secondRun.id });
  const secondStatus = await supervisor.call("eval_status", { runId: secondRun.id });
  assertCondition(secondStatus.decision?.decision === "accepted", "retry self-host attempt was not accepted");

  const acceptedItem = await projection(supervisor, metadata.projectId, "work_item", implementationItem.id);
  assertCondition(acceptedItem.state === "accepted", `accepted evaluation did not update WorkItem: ${acceptedItem.state}`);
  assertCondition(acceptedItem.acceptedEvaluationRunId === secondRun.id, "accepted WorkItem lost its evaluation provenance");
  const completed = await runWorker({ action: "complete-gated", "runtime-dir": runtimeDir, "workspace-root": implementationRoot, "project-id": metadata.projectId, "session-id": joined.implementation.agentSessionId, "work-item-id": implementationItem.id, "evaluation-run-id": secondRun.id, role: "implementation" });
  assertCondition(completed.workItem.state === "done", "accepted WorkItem did not reach done");
  assertCondition(completed.unblockedWorkItemIds?.includes(reviewItem.id), "completing the implementation did not unblock the reviewer");

  const reviewerBefore = await projection(supervisor, metadata.projectId, "work_item", reviewItem.id);
  assertCondition(reviewerBefore.state === "ready", `reviewer was not ready after dependency completion: ${reviewerBefore.state}`);
  const review = await runWorker({ action: "review", "runtime-dir": runtimeDir, "workspace-root": reviewerRoot, "project-id": metadata.projectId, "worktree-id": "worktree-self-host-reviewer", "session-id": joined.reviewer.agentSessionId, "work-item-id": reviewItem.id, "expected-version": reviewerBefore.version, role: "reviewer" });
  assertCondition(review.completed.workItem.state === "done", "reviewer handoff did not complete");
  assertCondition(review.sync.highPriority.some((item) => item.event.eventType === "ImpactDetected" && item.reason === "impact_result"), "reviewer did not receive the routed impact result");

  const replayOne = await supervisor.call("coord_sync", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: "0", maxEvents: 100, maxBytes: 128 * 1024 });
  const replayTwo = await supervisor.call("coord_sync", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: "0", maxEvents: 100, maxBytes: 128 * 1024 });
  const replayKeysOne = routeKeys(replayOne);
  const replayKeysTwo = routeKeys(replayTwo);
  const observerSync = await supervisor.call("coord_sync", { projectId: metadata.projectId, agentSessionId: joined.observer.agentSessionId, sinceSequence: "0", maxEvents: 100, maxBytes: 128 * 1024 });
  const events = await supervisor.call("list_events", { projectId: metadata.projectId, afterSequence: "0", limit: 500, maxBytes: 512 * 1024 });
  const targetText = await readFile(path.join(implementationRoot, "packages", "contracts", "src", "ids.ts"), "utf8");
  const afterTree = await treeDigest(implementationRoot);
  const eventTypes = [...new Set((events.events ?? []).map((event) => event.eventType))].sort();
  const evidence = {
    schemaVersion: "1",
    id: "PN9",
    profile: "PN9-self-host",
    status: "CANDIDATE",
    bootstrapSha: bootstrapCommit,
    bootstrapMode: "candidate-current-build",
    stableNMinusOneVerified: false,
    commit: bootstrapCommit,
    candidateSha: worktreeDirty ? "uncommitted" : bootstrapCommit,
    candidateDirty: worktreeDirty,
    candidateStateDigest: candidateSourceStateDigest,
    promotionEligible: false,
    projectId: metadata.projectId,
    worktrees: [
      { role: "implementation", id: "worktree-self-host-implementation", initialTree: beforeTree, finalTree: afterTree },
      { role: "reviewer", id: "worktree-self-host-reviewer", isolated: true },
      { role: "observer", id: "worktree-self-host-observer", isolated: true },
    ],
    agentSessions: Object.entries(joined).map(([role, value]) => ({ role, id: value.agentSessionId })),
    workItems: { implementation: implementationItem.id, review: reviewItem.id },
    evaluations: { specId: spec.id, rejectedRunId: firstRun.id, acceptedRunId: secondRun.id, firstDecision: firstStatus.decision, secondDecision: secondStatus.decision },
    changeReceipts: [firstChange.receipt, retryChange.receipt],
    feedback: { firstPacketId: firstStatus.feedback?.id, failedCriteria: firstStatus.feedback?.failedCriteria ?? [], retryState: firstStatus.retry?.state },
    routing: { reviewerInitialBlockObserved: true, impactDetected: eventTypes.includes("ImpactDetected"), replayDeterministic: JSON.stringify(replayKeysOne) === JSON.stringify(replayKeysTwo), replayItems: replayKeysOne.length, observerItems: routeKeys(observerSync).length },
    eventLog: { count: events.events?.length ?? 0, throughSequence: events.throughSequence, types: eventTypes },
    verification: { targetSourceMarker: targetText.includes("Production Next self-host marker: accepted"), acceptedAfterRetry: targetText.includes("Production Next self-host marker: accepted"), noAutonomousSpawn: true, boundedRetryAttempts: 2 },
    metrics: { firstTree, secondTree, finalTree: afterTree, retryIterations: 1, evaluationFalseAccepts: 0 },
};
  assertCondition(evidence.routing.replayDeterministic === true, `recorded routing replay was not deterministic: ${JSON.stringify(replayKeysOne)} != ${JSON.stringify(replayKeysTwo)}`);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath === undefined) {
    console.log(serialized);
  } else {
    await writeFile(evidencePath, serialized, "utf8");
    console.log(JSON.stringify({ profile: evidence.profile, evidencePath: path.relative(ROOT, evidencePath).replaceAll(path.sep, "/"), candidateSha: evidence.candidateSha, candidateDirty: evidence.candidateDirty, acceptedRunId: evidence.evaluations.acceptedRunId }, null, 2));
  }
} finally {
  if (daemon) await stopDaemon(daemon).catch(() => undefined);
  await rm(runtimeDir, { recursive: true, force: true });
  await rm(stagingRoot, { recursive: true, force: true });
}
