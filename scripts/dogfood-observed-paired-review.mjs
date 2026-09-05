#!/usr/bin/env node
/**
 * Run one real downstream review with an executed no-route baseline and an
 * intent-aware route under a distinct stable predecessor runtime.
 *
 * This runner does not mutate candidate source files. It records the actual
 * coordination route and downstream test result for a pre-registered task.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CoordinationClient, discoverProjectIdentity, readDaemonMetadata } from "../packages/coordination-client/dist/index.js";
import { candidateCommit, candidateDirty, candidateDirtyPaths, candidateStateDigest } from "./candidate-state.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".");
const DEFAULT_BOOTSTRAP_SHA = "fe671aec2b31c8d71e7a95e7e15a37073e0c4d39";
const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_EVENT_PAGES = 32;
const REQUIRED_REMOTE_CHECKS = [
  "quality (windows-latest, node 24)",
  "quality (ubuntu-latest, node 22)",
  "quality (ubuntu-latest, node 24)",
  "quality (macos-latest, node 24)",
  "CodeQL Analysis (javascript-typescript)",
];
const TEST_PROFILES = {
  platform: [
    "packages/code-state/test/code-state.test.ts",
    "apps/my-pi-daemon/test/code-state-lifecycle.test.ts",
    "apps/my-pi-daemon/test/daemon.test.ts",
  ],
  contract: [
    "packages/coordination-runtime/test/runtime.test.ts",
    "packages/evaluation-runtime/test/evaluation.test.ts",
  ],
};

function assertCondition(value, message) {
  if (!value) throw new Error(message);
}

function parseArgs(argv) {
  const values = { bootstrapSha: DEFAULT_BOOTSTRAP_SHA, targets: [] };
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--task-id") values.taskId = args[++index];
    else if (arg === "--evidence-out") values.evidenceOutput = args[++index];
    else if (arg === "--bootstrap-sha") values.bootstrapSha = args[++index];
    else if (arg === "--test-profile") values.testProfile = args[++index];
    else if (arg === "--target") values.targets.push(args[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  assertCondition(/^OT-[0-9]{3}$/.test(values.taskId ?? ""), "--task-id must look like OT-000");
  assertCondition(FULL_SHA.test(values.bootstrapSha ?? ""), "--bootstrap-sha must be a full commit SHA");
  assertCondition(values.targets.length > 0 && values.targets.every((value) => typeof value === "string" && value.length > 0), "at least one --target is required");
  assertCondition(TEST_PROFILES[values.testProfile ?? "platform"], `unknown --test-profile: ${values.testProfile}`);
  if (values.evidenceOutput !== undefined) {
    const absolute = path.resolve(ROOT, values.evidenceOutput);
    const relative = path.relative(ROOT, absolute);
    assertCondition(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "--evidence-out must stay inside the repository");
    values.evidenceOutput = absolute;
  }
  values.bootstrapSha = values.bootstrapSha.toLowerCase();
  values.testProfile ??= "platform";
  return values;
}

async function runCommand(command, args, cwd) {
  const shell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
  const result = await execFileAsync(command, args, { cwd, encoding: "utf8", maxBuffer: 24 * 1024 * 1024, shell });
  return { command, args, stdout: result.stdout, stderr: result.stderr };
}

async function git(args, cwd = ROOT) {
  return (await runCommand("git", args, cwd)).stdout.trim();
}

async function resolvePnpm() {
  if (process.platform !== "win32") return { command: "pnpm", args: [] };
  const candidates = [];
  if (process.env.PNPM_HOME) candidates.push(path.join(process.env.PNPM_HOME, "pnpm.cmd"));
  candidates.push(path.join(path.dirname(process.execPath), "pnpm.cmd"));
  try {
    const found = await execFileAsync("where.exe", ["pnpm.cmd"], { encoding: "utf8", maxBuffer: 4096 });
    candidates.push(...found.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
  } catch {
    // Fall through to the known command below.
  }
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const entry = path.join(path.dirname(candidate), "node_modules", "pnpm", "bin", "pnpm.mjs");
      try {
        await access(entry);
        return { command: process.execPath, args: [entry] };
      } catch {
        return { command: candidate, args: [] };
      }
    } catch {
      // Try the next known location.
    }
  }
  return { command: "pnpm.cmd", args: [] };
}

async function buildWorktree(worktreeRoot, label) {
  const pnpm = await resolvePnpm();
  await runCommand(pnpm.command, [...pnpm.args, "install", "--frozen-lockfile"], worktreeRoot);
  await runCommand(pnpm.command, [...pnpm.args, "build"], worktreeRoot);
  return { label, passed: true, installCommand: [pnpm.command, ...pnpm.args, "install", "--frozen-lockfile"], buildCommand: [pnpm.command, ...pnpm.args, "build"] };
}

async function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function verifyRemoteQualification(sha) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "my-pi-observed-paired-review" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/BoxBoxmari/my-pi/commits/${sha}/check-runs?per_page=100`, { headers });
  if (!response.ok) throw new Error(`cannot read GitHub checks for ${sha}: HTTP ${response.status}`);
  const payload = await response.json();
  const checks = new Map((payload.check_runs ?? []).map((check) => [check.name, check]));
  const missing = REQUIRED_REMOTE_CHECKS.filter((name) => !checks.has(name));
  const failed = REQUIRED_REMOTE_CHECKS.filter((name) => checks.get(name)?.conclusion !== "success");
  assertCondition(missing.length === 0 && failed.length === 0, `remote qualification is incomplete; missing=${missing.join(",")} failed=${failed.join(",")}`);
  return {
    provider: "github-check-runs",
    commit: sha,
    status: "success",
    checks: REQUIRED_REMOTE_CHECKS.map((name) => ({ name, conclusion: checks.get(name).conclusion, detailsUrl: checks.get(name).details_url ?? checks.get(name).html_url })),
  };
}

async function addWorktree(worktreeRoot, sha) {
  await runCommand("git", ["worktree", "add", "--detach", worktreeRoot, sha], ROOT);
}

async function removeWorktree(worktreeRoot) {
  await runCommand("git", ["worktree", "remove", "--force", worktreeRoot], ROOT);
}

function startDaemon(daemonPath, workspaceRoot, runtimeDir, databasePath, cwd) {
  const daemon = spawn(process.execPath, [daemonPath, "--workspace", workspaceRoot, "--runtime-dir", runtimeDir, "--database", databasePath], { cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  daemon.stderr?.on("data", () => undefined);
  return daemon;
}

async function waitForReady(runtimeDir, daemon) {
  const started = Date.now();
  for (;;) {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (metadata?.state === "ready") return metadata;
    if (daemon.exitCode !== null) throw new Error(`stable predecessor daemon exited before ready: ${daemon.exitCode}`);
    if (Date.now() - started > 15_000) throw new Error("stable predecessor daemon readiness timeout");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  const exited = Promise.race([once(processHandle, "exit"), once(processHandle, "close")]);
  processHandle.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

function routeKeys(sync) {
  return [...(sync.highPriority ?? []), ...(sync.normalPriority ?? [])]
    .filter((item) => item.event?.eventType !== "AgentHeartbeat")
    .map((item) => `${item.priority ?? "normal"}:${item.reason ?? "unknown"}:${item.event?.eventId ?? item.event?.payload?.id ?? "unknown"}`)
    .sort();
}

async function listAllEvents(client, projectId) {
  const events = [];
  let afterSequence = "0";
  for (let pageNumber = 0; pageNumber < MAX_EVENT_PAGES; pageNumber++) {
    const page = await client.call("list_events", { projectId, afterSequence, limit: 500, maxBytes: 512 * 1024 });
    events.push(...(page.events ?? []));
    if (page.hasMore !== true) return events;
    assertCondition(typeof page.throughSequence === "string" && page.throughSequence !== afterSequence, "observed review event pagination made no progress");
    afterSequence = page.throughSequence;
  }
  throw new Error("observed review event pagination exceeded its bounded page limit");
}

async function waitForCodeState(client, projectId, worktreeId) {
  const started = Date.now();
  for (;;) {
    const snapshot = await client.call("code_state_snapshot", { projectId, worktreeId });
    if (Array.isArray(snapshot?.entities) && snapshot.entities.length > 0) {
      return { entities: snapshot.entities.length, edges: Array.isArray(snapshot.edges) ? snapshot.edges.length : 0 };
    }
    if (Date.now() - started > 30_000) throw new Error(`code-state snapshot did not become ready for ${worktreeId}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function join(client, projectId, root, role, candidateSha) {
  const identity = await discoverProjectIdentity(root);
  const repositoryId = `repo-observed-${role}`;
  const worktreeId = `worktree-observed-${role}`;
  const result = await client.call("coord_join", {
    project: { displayName: "my-pi observed downstream review" },
    repository: { id: repositoryId, projectId, vcs: "git", canonicalIdentity: identity.canonicalIdentity },
    worktree: { id: worktreeId, repositoryId, root, head: candidateSha, branch: `observed/${role}`, observedAt: new Date().toISOString() },
    host: `observed-${role}`,
    clientInstance: `observed-review-${process.pid}`,
    role,
  });
  return { ...result, repositoryId, worktreeId, root };
}

async function runReviewTests(worktreeRoot, testProfile) {
  const args = ["--test", "--experimental-strip-types", ...TEST_PROFILES[testProfile]];
  const started = Date.now();
  try {
    const result = await execFileAsync(process.execPath, args, { cwd: worktreeRoot, encoding: "utf8", maxBuffer: 24 * 1024 * 1024 });
    return { command: [process.execPath, ...args], exitCode: 0, durationMs: Date.now() - started, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { command: [process.execPath, ...args], exitCode: typeof error.code === "number" ? error.code : 1, durationMs: Date.now() - started, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message ?? error) };
  }
}

const options = parseArgs(process.argv);
const candidateSha = candidateCommit().toLowerCase();
const candidateSourceStateDigest = await candidateStateDigest();
const candidateDirtyState = candidateDirty();
assertCondition(candidateDirtyPaths().length === 0 && !candidateDirtyState, `observed review requires a clean candidate source state; dirtyPaths=${candidateDirtyPaths().join(",")}`);
assertCondition(candidateSha !== options.bootstrapSha, "stable predecessor SHA must be distinct from candidate HEAD");
await runCommand("git", ["cat-file", "-e", `${options.bootstrapSha}^{commit}`], ROOT);
await runCommand("git", ["merge-base", "--is-ancestor", options.bootstrapSha, candidateSha], ROOT);

const [stableRemote, candidateRemote] = await Promise.all([verifyRemoteQualification(options.bootstrapSha), verifyRemoteQualification(candidateSha)]);
const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "my-pi-observed-review-"));
const stableRoot = path.join(stagingRoot, "stable-predecessor");
const candidateRoot = path.join(stagingRoot, "candidate");
const reviewerRoot = path.join(stagingRoot, "reviewer");
const observerRoot = path.join(stagingRoot, "observer");
const runtimeDir = path.join(stagingRoot, "runtime");
const databasePath = path.join(runtimeDir, "coordination.sqlite");
const stableDaemonPath = path.join(stableRoot, "apps", "my-pi-daemon", "dist", "main.js");
let stableAdded = false;
let candidateAdded = false;
let reviewerAdded = false;
let observerAdded = false;
let daemon;

try {
  await addWorktree(stableRoot, options.bootstrapSha);
  stableAdded = true;
  await addWorktree(candidateRoot, candidateSha);
  candidateAdded = true;
  await addWorktree(reviewerRoot, candidateSha);
  reviewerAdded = true;
  await addWorktree(observerRoot, candidateSha);
  observerAdded = true;

  const stableBuild = await buildWorktree(stableRoot, "stable-predecessor");
  const candidateBuild = await buildWorktree(candidateRoot, "candidate");
  const reviewerBuild = await buildWorktree(reviewerRoot, "reviewer");
  const stableHead = (await git(["rev-parse", "HEAD"], stableRoot)).toLowerCase();
  const candidateWorktreeHead = (await git(["rev-parse", "HEAD"], candidateRoot)).toLowerCase();
  const reviewerWorktreeHead = (await git(["rev-parse", "HEAD"], reviewerRoot)).toLowerCase();
  const stableClean = (await git(["status", "--porcelain", "--untracked-files=no"], stableRoot)) === "";
  const candidateClean = (await git(["status", "--porcelain", "--untracked-files=no"], candidateRoot)) === "";
  const reviewerClean = (await git(["status", "--porcelain", "--untracked-files=no"], reviewerRoot)) === "";
  assertCondition(stableHead === options.bootstrapSha, "stable worktree HEAD does not match the claimed predecessor");
  assertCondition(candidateWorktreeHead === candidateSha && reviewerWorktreeHead === candidateSha, "review worktrees do not match candidate HEAD");

  daemon = startDaemon(stableDaemonPath, candidateRoot, runtimeDir, databasePath, stableRoot);
  const metadata = await waitForReady(runtimeDir, daemon);
  const stableClient = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });
  const projectId = metadata.projectId;
  const joined = {
    implementation: await join(stableClient, projectId, candidateRoot, "implementation", candidateSha),
    reviewer: await join(stableClient, projectId, reviewerRoot, "reviewer", candidateSha),
    observer: await join(stableClient, projectId, observerRoot, "observer", candidateSha),
  };
  const codeStateReady = {
    implementation: await waitForCodeState(stableClient, projectId, joined.implementation.worktreeId),
    reviewer: await waitForCodeState(stableClient, projectId, joined.reviewer.worktreeId),
    observer: await waitForCodeState(stableClient, projectId, joined.observer.worktreeId),
  };

  const sourceItem = await stableClient.call("coord_create_work_item", {
    projectId,
    title: `${options.taskId}: review committed platform hardening`,
    summary: "Review the committed watcher and asynchronous daemon changes as a real downstream consumer.",
  });
  const reviewerItem = await stableClient.call("coord_create_work_item", {
    projectId,
    title: `${options.taskId}: independent downstream verification`,
    summary: "Run the real platform review suites with and without intent-aware coordination context.",
  });
  await stableClient.call("coord_claim", { projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: sourceItem.id, expectedVersion: sourceItem.version });
  await stableClient.call("coord_claim", { projectId, agentSessionId: joined.reviewer.agentSessionId, workItemId: reviewerItem.id, expectedVersion: reviewerItem.version });
  const setupSync = await stableClient.call("coord_sync", { projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: String(joined.reviewer.currentSequence ?? "0"), maxEvents: 100, maxBytes: 128 * 1024 });
  const reviewerCursorBeforeIntent = String(setupSync.throughSequence ?? joined.reviewer.currentSequence ?? "0");
  const sourceIntent = await stableClient.call("coord_intent", {
    projectId,
    agentSessionId: joined.implementation.agentSessionId,
    workItemId: sourceItem.id,
    kind: "modify",
    summary: "review the committed watcher and daemon platform changes",
    targets: options.targets.map((value) => ({ type: "path", value })),
  });
  const baseline = await stableClient.call("coord_sync", { projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: reviewerCursorBeforeIntent, maxEvents: 100, maxBytes: 128 * 1024 });
  const baselineKeys = routeKeys(baseline);

  const reviewerIntent = await stableClient.call("coord_intent", {
    projectId,
    agentSessionId: joined.reviewer.agentSessionId,
    workItemId: reviewerItem.id,
    kind: "verify",
    summary: "verify the same committed platform changes as an independent downstream reviewer",
    targets: options.targets.map((value) => ({ type: "path", value })),
  });
  const intentAwareCursor = String(baseline.throughSequence ?? reviewerCursorBeforeIntent);
  const routed = await stableClient.call("coord_sync", { projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: intentAwareCursor, maxEvents: 100, maxBytes: 128 * 1024 });
  const replayOne = await stableClient.call("coord_sync", { projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: intentAwareCursor, maxEvents: 100, maxBytes: 128 * 1024 });
  const replayTwo = await stableClient.call("coord_sync", { projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: intentAwareCursor, maxEvents: 100, maxBytes: 128 * 1024 });
  const observerCursor = String(joined.observer.currentSequence ?? "0");
  const observer = await stableClient.call("coord_sync", { projectId, agentSessionId: joined.observer.agentSessionId, sinceSequence: observerCursor, maxEvents: 100, maxBytes: 128 * 1024 });
  const routedKeys = routeKeys(routed);
  const replayKeysOne = routeKeys(replayOne);
  const replayKeysTwo = routeKeys(replayTwo);
  const observerKeys = routeKeys(observer);
  assertCondition(baselineKeys.length === 0, `executed baseline unexpectedly received routed items: ${JSON.stringify(baselineKeys)}`);
  assertCondition(routedKeys.some((key) => key.includes(":impact_result:")), `intent-aware reviewer did not receive an impact_result route: ${JSON.stringify(routedKeys)}`);
  assertCondition(observerKeys.length === 0, `unrelated observer received routed items: ${JSON.stringify(observerKeys)}`);
  assertCondition(JSON.stringify(replayKeysOne) === JSON.stringify(replayKeysTwo), "intent-aware route replay was not deterministic");

  const testResult = await runReviewTests(reviewerRoot, options.testProfile);
  const context = await stableClient.call("coord_publish", {
    projectId,
    agentSessionId: joined.reviewer.agentSessionId,
    workItemId: reviewerItem.id,
    kind: "review_result",
    contentDigest: `sha256:${await sha256Text(JSON.stringify(testResult))}`,
    classification: "internal",
    retention: "until-superseded",
  });
  const sourceCompleted = await stableClient.call("coord_complete", { projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: sourceItem.id });
  const reviewerCompleted = await stableClient.call("coord_complete", { projectId, agentSessionId: joined.reviewer.agentSessionId, workItemId: reviewerItem.id });
  const events = await listAllEvents(stableClient, projectId);
  const relevantEvents = events
    .filter((event) => ["IntentDeclared", "ImpactDetected", "ContextPublished", "WorkItemCompleted"].includes(event.eventType))
    .map((event) => ({ sequence: event.sequence, eventType: event.eventType, eventId: event.eventId ?? event.payload?.id, payload: event.payload ?? null }));
  const impactEvents = relevantEvents.filter((event) => event.eventType === "ImpactDetected");
  const evidence = {
    schemaVersion: "1",
    recordType: "observed-engineering-task",
    taskId: options.taskId,
    taskDefinition: `dogfood/observed-tasks/${options.taskId}.json`,
    taskDefinitionCommit: await git(["log", "-1", "--format=%H", "--", `dogfood/observed-tasks/${options.taskId}.json`]),
    status: testResult.exitCode === 0 ? "RECORDED" : "PARTIAL_OBSERVATION",
    outcome: testResult.exitCode === 0 ? "accepted_by_executed_paired_route_and_downstream_tests" : "downstream_tests_failed_after_executed_paired_route",
    reviewedCandidateSha: candidateSha,
    candidateSourceStateDigestBeforeRecord: candidateSourceStateDigest,
    filesChanged: [],
    stableAuthority: {
      bootstrapSha: options.bootstrapSha,
      runtime: "stable predecessor daemon controls coordination against candidate worktrees",
      processId: daemon.pid,
      projectId,
      candidateDaemonStarted: false,
      stableWorktreeHead: stableHead,
      stableClean,
      candidateWorktreeHead,
      candidateClean,
      reviewerWorktreeHead,
      reviewerClean,
      builds: { stable: stableBuild, candidate: candidateBuild, reviewer: reviewerBuild },
      codeStateReady,
      remote: { stable: stableRemote, candidate: candidateRemote },
    },
    coordination: {
      sourceWorkItemId: sourceItem.id,
      reviewWorkItemId: reviewerItem.id,
      agentSessions: [
        { id: joined.implementation.agentSessionId, role: "implementation" },
        { id: joined.reviewer.agentSessionId, role: "reviewer" },
        { id: joined.observer.agentSessionId, role: "observer" },
      ],
      implementationIntentId: sourceIntent.id,
      reviewerIntentId: reviewerIntent.id,
      explicitDependenciesBetweenReviewAndSource: [],
      baselineArm: { sinceSequence: reviewerCursorBeforeIntent, throughSequence: baseline.throughSequence, routeKeys: baselineKeys, routeCount: baselineKeys.length },
      intentAwareArm: { sinceSequence: intentAwareCursor, throughSequence: routed.throughSequence, routeKeys: routedKeys, routeCount: routedKeys.length },
      replay: { first: replayKeysOne, second: replayKeysTwo, deterministic: JSON.stringify(replayKeysOne) === JSON.stringify(replayKeysTwo) },
      observer: { sinceSequence: observerCursor, routeKeys: observerKeys, routeCount: observerKeys.length },
      relevantEvents,
      impactEvents,
      contextArtifactId: context.id,
      workItemsDone: sourceCompleted.workItem?.state === "done" && reviewerCompleted.workItem?.state === "done",
    },
    impactObservation: {
      executedBaselineRouteCount: baselineKeys.length,
      intentAwareRouteCount: routedKeys.length,
      impactDetected: impactEvents.length > 0,
      explainableReasons: impactEvents.flatMap((event) => event.payload?.reasonCodes ?? event.payload?.reasons ?? []),
      missedDependencies: "not assessed beyond the declared paired review scope",
      falsePositives: observerKeys.length === 0 ? 0 : "observed; unrelated observer received a route",
      downstreamReworkIterations: "not assessed; this run did not invent a repair cycle",
      promotionVerdict: "contributes an executed route baseline and downstream review result; no PN6 rework-improvement claim is made from this task alone",
    },
    reviewObservation: {
      testProfile: options.testProfile,
      testResult,
      reviewerWorktree: reviewerRoot,
      contextArtifactId: context.id,
      humanInterventions: 0,
    },
    correctness: {
      candidateRemote,
      stableRemote,
      downstreamTestsPassed: testResult.exitCode === 0,
    },
    metrics: {
      baselineRouteCount: baselineKeys.length,
      intentAwareRouteCount: routedKeys.length,
      replayRouteCount: replayKeysOne.length,
      observerRouteCount: observerKeys.length,
      repairIterations: "not_assessed",
      humanInterventions: 0,
    },
    observedEvidenceBoundary: "OT-008 is a real paired downstream review over committed my-pi platform code. It records both executed route arms and the independent test outcome. It is observed evidence, but it does not by itself establish improved integration rework, precision/recall across heterogeneous tasks, or PN6 promotion eligibility.",
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (options.evidenceOutput) await writeFile(options.evidenceOutput, serialized, "utf8");
  else process.stdout.write(serialized);
} finally {
  await stopProcess(daemon);
  for (const [root, added] of [[observerRoot, observerAdded], [reviewerRoot, reviewerAdded], [candidateRoot, candidateAdded], [stableRoot, stableAdded]]) {
    if (added) await removeWorktree(root).catch(() => undefined);
  }
  await rm(stagingRoot, { recursive: true, force: true });
}
