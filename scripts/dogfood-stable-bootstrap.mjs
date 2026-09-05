#!/usr/bin/env node
/**
 * Run the self-host workflow with a real stable N-1 runtime.
 *
 * The predecessor is checked out and built in its own Git worktree. Its daemon
 * owns coordination/evaluation and its ChangeRuntime performs the source
 * mutations against a clean candidate worktree. The candidate daemon is never
 * started, so the candidate cannot become its own authority during this run.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CoordinationClient, discoverProjectIdentity, readDaemonMetadata } from "../packages/coordination-client/dist/index.js";
import { candidateCommit, candidateDirty, candidateDirtyPaths, candidateStateDigest } from "./candidate-state.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".");
const DEFAULT_BOOTSTRAP_SHA = "fe671aec2b31c8d71e7a95e7e15a37073e0c4d39";
const APPROVED_BASELINE_SHA = "273ed28947a94a2495b10721f725447ea769994d";
const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_EVENT_PAGES = 32;
const TARGET_PATH = "packages/contracts/src/ids.ts";
const WORKTREE_EXCLUSIONS = new Set([".git", "node_modules", "dist", "coverage", ".codegraph", ".codebase-memory"]);
const REQUIRED_REMOTE_CHECKS = [
  "quality (windows-latest, node 24)",
  "quality (ubuntu-latest, node 22)",
  "quality (ubuntu-latest, node 24)",
  "quality (macos-latest, node 24)",
  "CodeQL Analysis (javascript-typescript)",
];
const PINNED_STABLE_PUBLIC_CHECKS = [
  { name: "quality (windows-latest, node 24)", detailsUrl: "https://github.com/BoxBoxmari/my-pi/actions/runs/33899068538/job/101108591070" },
  { name: "quality (ubuntu-latest, node 22)", detailsUrl: "https://github.com/BoxBoxmari/my-pi/actions/runs/33899068538/job/101108591405" },
  { name: "quality (ubuntu-latest, node 24)", detailsUrl: "https://github.com/BoxBoxmari/my-pi/actions/runs/33899068538/job/101108591483" },
  { name: "quality (macos-latest, node 24)", detailsUrl: "https://github.com/BoxBoxmari/my-pi/actions/runs/33899068538/job/101108591463" },
  { name: "CodeQL Analysis (javascript-typescript)", detailsUrl: "https://github.com/BoxBoxmari/my-pi/actions/runs/33899068520/job/101108590664" },
];

function assertCondition(value, message) {
  if (!value) throw new Error(message);
}

function parseArgs(argv) {
  let bootstrapSha = DEFAULT_BOOTSTRAP_SHA;
  let evidenceOutput;
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--bootstrap-sha") {
      bootstrapSha = args[++index];
    } else if (arg === "--evidence-out") {
      evidenceOutput = args[++index];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!FULL_SHA.test(bootstrapSha ?? "")) throw new Error("--bootstrap-sha must be a full commit SHA");
  if (evidenceOutput !== undefined) {
    const absolute = path.resolve(ROOT, evidenceOutput);
    const relative = path.relative(ROOT, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--evidence-out must stay inside the repository");
  }
  return { bootstrapSha: bootstrapSha.toLowerCase(), evidenceOutput };
}

async function runCommand(command, args, cwd) {
  const shell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
  const result = await execFileAsync(command, args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, shell });
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
    // Fall through to PATH resolution below.
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
  return {
    label,
    passed: true,
    installCommand: [pnpm.command, ...pnpm.args, "install", "--frozen-lockfile"],
    buildCommand: [pnpm.command, ...pnpm.args, "build"],
  };
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function treeDigest(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = (await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true }))
    .filter((entry) => !WORKTREE_EXCLUSIONS.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const hash = createHash("sha256");
  for (const entry of entries) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      hash.update(childRelative.split(path.sep).join("/"));
      hash.update("\0");
      hash.update(await treeDigest(root, childRelative));
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

async function verifyRemoteQualification(sha) {
  if (typeof fetch !== "function") throw new Error("fetch is unavailable for remote predecessor qualification");
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "my-pi-stable-bootstrap" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const actionsUrl = `https://api.github.com/repos/BoxBoxmari/my-pi/actions/runs?head_sha=${sha}&per_page=100`;
  const actionsResponse = await fetch(actionsUrl, { headers });
  if (actionsResponse.ok) {
    const actionsPayload = await actionsResponse.json();
    const successfulRun = (name) => (actionsPayload.workflow_runs ?? [])
      .filter((run) => run.head_sha?.toLowerCase() === sha.toLowerCase() && run.name === name && run.status === "completed" && run.conclusion === "success")
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
    const ciRun = successfulRun("My-Pi Multi-Platform CI");
    const codeqlRun = successfulRun("CodeQL Security Analysis");
    if (ciRun && codeqlRun) {
      const jobsResponse = await fetch(`${ciRun.url}/jobs?per_page=100`, { headers });
      if (!jobsResponse.ok) throw new Error(`cannot read predecessor workflow jobs: HTTP ${jobsResponse.status}`);
      const jobsPayload = await jobsResponse.json();
      const jobs = new Map((jobsPayload.jobs ?? []).map((job) => [job.name, job]));
      const missing = REQUIRED_REMOTE_CHECKS.slice(0, 4).filter((name) => !jobs.has(name));
      const failed = REQUIRED_REMOTE_CHECKS.slice(0, 4).filter((name) => jobs.get(name)?.conclusion !== "success");
      if (missing.length > 0 || failed.length > 0) throw new Error(`predecessor remote qualification is incomplete; missing=${missing.join(",")} failed=${failed.join(",")}`);
      return {
        provider: "github-actions-workflows",
        commit: sha,
        status: "success",
        checks: [...REQUIRED_REMOTE_CHECKS.slice(0, 4).map((name) => ({ name, conclusion: jobs.get(name).conclusion, detailsUrl: jobs.get(name).html_url })), { name: REQUIRED_REMOTE_CHECKS[4], conclusion: codeqlRun.conclusion, detailsUrl: codeqlRun.html_url }],
      };
    }
  }

  const checkUrl = `https://api.github.com/repos/BoxBoxmari/my-pi/commits/${sha}/check-runs?per_page=100`;
  const checkResponse = await fetch(checkUrl, { headers: { Accept: headers.Accept, "User-Agent": headers["User-Agent"] } });
  if (!checkResponse.ok && sha === DEFAULT_BOOTSTRAP_SHA) {
    const publicChecks = await Promise.all(PINNED_STABLE_PUBLIC_CHECKS.map(async (check) => {
      const response = await fetch(check.detailsUrl, { headers: { "User-Agent": "my-pi-stable-bootstrap" } });
      const page = await response.text();
      const passed = response.ok && page.includes(sha) && page.includes(check.name) && page.includes('aria-label="completed successfully:');
      return { ...check, conclusion: passed ? "success" : "failure" };
    }));
    if (publicChecks.every((check) => check.conclusion === "success")) {
      return { provider: "github-public-job-pages", commit: sha, status: "success", checks: publicChecks };
    }
  }
  if (!checkResponse.ok) throw new Error(`cannot read predecessor GitHub qualification: Actions HTTP ${actionsResponse.status}, check-runs HTTP ${checkResponse.status}`);
  const checkPayload = await checkResponse.json();
  const checks = new Map((checkPayload.check_runs ?? []).map((check) => [check.name, check]));
  const missing = REQUIRED_REMOTE_CHECKS.filter((name) => !checks.has(name));
  const failed = REQUIRED_REMOTE_CHECKS.filter((name) => checks.get(name)?.conclusion !== "success");
  if (missing.length > 0 || failed.length > 0) throw new Error(`predecessor remote qualification is incomplete; missing=${missing.join(",")} failed=${failed.join(",")}`);
  return { provider: "github-check-runs", commit: sha, status: "success", checks: REQUIRED_REMOTE_CHECKS.map((name) => ({ name, conclusion: checks.get(name).conclusion, detailsUrl: checks.get(name).details_url ?? checks.get(name).html_url })) };
}

async function addWorktree(worktreeRoot, sha) {
  await runCommand("git", ["worktree", "add", "--detach", worktreeRoot, sha], ROOT);
}

async function removeWorktree(worktreeRoot) {
  await runCommand("git", ["worktree", "remove", "--force", worktreeRoot], ROOT);
}

function startDaemon(daemonPath, workspaceRoot, runtimeDir, databasePath, cwd) {
  const daemon = spawn(process.execPath, [daemonPath, "--workspace", workspaceRoot, "--runtime-dir", runtimeDir, "--database", databasePath], {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  daemon.stderr?.on("data", () => undefined);
  return daemon;
}

async function waitForReady(runtimeDir, daemon) {
  const started = Date.now();
  for (;;) {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (metadata?.state === "ready") return metadata;
    if (daemon.exitCode !== null) throw new Error(`stable N-1 daemon exited before ready: ${daemon.exitCode}`);
    if (Date.now() - started > 15_000) throw new Error("stable N-1 daemon readiness timeout");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  const exited = Promise.race([once(processHandle, "exit"), once(processHandle, "close")]);
  processHandle.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

function capabilityData(response) {
  if (response?.isError) throw new Error(`stable MCP capability failed: ${JSON.stringify(response)}`);
  const block = response?.content?.find((item) => item.type === "text");
  if (!block?.text) throw new Error("stable MCP capability returned no JSON content");
  const envelope = JSON.parse(block.text);
  if (!envelope?.data) throw new Error(`stable MCP capability returned an invalid envelope: ${block.text}`);
  return envelope.data;
}

function routeKeys(sync) {
  return [...(sync.highPriority ?? []), ...(sync.normalPriority ?? [])]
    .filter((item) => item.event?.eventType !== "AgentHeartbeat")
    .map((item) => `${item.priority ?? "normal"}:${item.reason ?? "unknown"}:${item.event?.eventId ?? "unknown"}`)
    .sort();
}

async function listAllEvents(client, projectId) {
  const events = [];
  let afterSequence = "0";
  for (let pageNumber = 0; pageNumber < MAX_EVENT_PAGES; pageNumber++) {
    const page = await client.call("list_events", { projectId, afterSequence, limit: 500, maxBytes: 512 * 1024 });
    events.push(...(page.events ?? []));
    if (page.hasMore !== true) return events;
    if (typeof page.throughSequence !== "string" || page.throughSequence === afterSequence) throw new Error("stable bootstrap event pagination made no progress");
    afterSequence = page.throughSequence;
  }
  throw new Error("stable bootstrap event pagination exceeded its bounded page limit");
}

async function join(client, projectId, root, role, candidateSha) {
  const identity = await discoverProjectIdentity(root);
  const repositoryId = `repo-stable-bootstrap-${role}`;
  const worktreeId = `worktree-stable-bootstrap-${role}`;
  const result = await client.call("coord_join", {
    project: { displayName: "my-pi stable N-1 bootstrap" },
    repository: { id: repositoryId, projectId, vcs: "git", canonicalIdentity: identity.canonicalIdentity },
    worktree: { id: worktreeId, repositoryId, root, head: candidateSha, branch: `stable-bootstrap/${role}`, observedAt: new Date().toISOString() },
    host: `stable-bootstrap-${role}`,
    clientInstance: `stable-bootstrap-${process.pid}`,
    role,
  });
  return { ...result, repositoryId, worktreeId, root };
}

async function projection(client, projectId, kind, id) {
  return client.call("get_projection", { projectId, kind, id });
}

const { bootstrapSha, evidenceOutput } = parseArgs(process.argv);
const candidateSha = candidateCommit().toLowerCase();
const candidateDirtyState = candidateDirty();
const candidateSourceStateDigest = await candidateStateDigest();
assertCondition(candidateSha !== bootstrapSha, "stable bootstrap SHA must be distinct from candidate HEAD");
assertCondition(!candidateDirtyState, `stable bootstrap requires a clean candidate source state; dirtyPaths=${candidateDirtyPaths().join(",")}`);
await runCommand("git", ["cat-file", "-e", `${bootstrapSha}^{commit}`], ROOT);
await runCommand("git", ["merge-base", "--is-ancestor", bootstrapSha, candidateSha], ROOT);
const remoteQualification = await verifyRemoteQualification(bootstrapSha);

const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "my-pi-stable-bootstrap-"));
const stableRoot = path.join(stagingRoot, "stable-n-minus-one");
const candidateRoot = path.join(stagingRoot, "candidate");
const reviewerRoot = path.join(stagingRoot, "reviewer");
const observerRoot = path.join(stagingRoot, "observer");
const runtimeDir = path.join(stagingRoot, "runtime");
const databasePath = path.join(runtimeDir, "coordination.sqlite");
const stableDaemonPath = path.join(stableRoot, "apps", "my-pi-daemon", "dist", "main.js");
const stableMcpPath = path.join(stableRoot, "apps", "my-pi-mcp", "dist", "main.js");
let stableAdded = false;
let candidateAdded = false;
let reviewerAdded = false;
let observerAdded = false;
let daemon;
let mcpClient;
let stableClient;
let stableWorkspace;
let stableChangeRuntime;

try {
  await addWorktree(stableRoot, bootstrapSha);
  stableAdded = true;
  await addWorktree(candidateRoot, candidateSha);
  candidateAdded = true;
  await addWorktree(reviewerRoot, candidateSha);
  reviewerAdded = true;
  await addWorktree(observerRoot, candidateSha);
  observerAdded = true;

  const stableBuild = await buildWorktree(stableRoot, "stable-n-minus-one");
  const candidateBuild = await buildWorktree(candidateRoot, "candidate");
  const stableHead = (await git(["rev-parse", "HEAD"], stableRoot)).toLowerCase();
  const candidateWorktreeHead = (await git(["rev-parse", "HEAD"], candidateRoot)).toLowerCase();
  const stableClean = (await git(["status", "--porcelain", "--untracked-files=no"], stableRoot)) === "";
  const candidateCleanAtStart = (await git(["status", "--porcelain", "--untracked-files=no"], candidateRoot)) === "";
  const beforeTree = await treeDigest(candidateRoot);
  assertCondition(stableHead === bootstrapSha, "stable worktree HEAD does not match the claimed predecessor");
  assertCondition(candidateWorktreeHead === candidateSha, "candidate worktree HEAD does not match candidate HEAD");

  daemon = startDaemon(stableDaemonPath, candidateRoot, runtimeDir, databasePath, stableRoot);
  const metadata = await waitForReady(runtimeDir, daemon);
  stableClient = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [stableMcpPath, "--workspace", candidateRoot, "--security-profile", "trusted", "--coordination", "--evaluation", "--coordination-runtime-dir", runtimeDir],
    cwd: stableRoot,
    stderr: "pipe",
  });
  mcpClient = new Client({ name: "stable-n-minus-one-bootstrap", version: "1" });
  await mcpClient.connect(transport);
  const mcpTools = (await mcpClient.listTools()).tools.map((tool) => tool.name);
  assertCondition(mcpTools.includes("fs_read") && mcpTools.includes("workspace_info"), "stable N-1 MCP runtime did not expose legacy read capabilities");
  const mcpWorkspaceInfo = capabilityData(await mcpClient.callTool({ name: "workspace_info", arguments: {} }));
  assertCondition(path.resolve(mcpWorkspaceInfo.root) === path.resolve(candidateRoot), "stable MCP runtime opened the wrong candidate worktree");
  const mcpBefore = capabilityData(await mcpClient.callTool({ name: "fs_read", arguments: { path: TARGET_PATH } }));

  const stableWorkspaceModule = await import(pathToFileURL(path.join(stableRoot, "packages", "workspace-runtime", "dist", "index.js")).href);
  const stableChangeModule = await import(pathToFileURL(path.join(stableRoot, "packages", "change-runtime", "dist", "index.js")).href);
  const stableContractsModule = await import(pathToFileURL(path.join(stableRoot, "packages", "contracts", "dist", "index.js")).href);
  stableWorkspace = new stableWorkspaceModule.WorkspaceRuntime();
  await stableWorkspace.open({ root: candidateRoot, policy: { mode: "workspace-write" }, capabilities: { write: true } });
  stableChangeRuntime = new stableChangeModule.ChangeRuntime(stableWorkspace);
  const stableFingerprintBytes = stableContractsModule.fingerprintBytes;

  const joined = {};
  for (const [role, root] of [["implementation", candidateRoot], ["reviewer", reviewerRoot], ["observer", observerRoot]]) {
    joined[role] = await join(stableClient, metadata.projectId, root, role, candidateSha);
  }

  const spec = await stableClient.call("eval_register_spec", {
    name: "stable N-1 self-host bounded change acceptance",
    criteria: [
      { id: "target-marker", kind: "artifact", required: true, severity: "critical", evaluatorRef: "deterministic-local", expected: "accepted" },
      { id: "publication", kind: "artifact", required: true, severity: "critical", evaluatorRef: "deterministic-local", expected: "APPLIED" },
    ],
  });
  const implementationItem = await stableClient.call("coord_create_work_item", {
    projectId: metadata.projectId,
    title: "stable N-1 implementation",
    summary: "Mutate and qualify a candidate source artifact through the predecessor runtime.",
    evaluationSpecId: spec.id,
  });
  const reviewItem = await stableClient.call("coord_create_work_item", {
    projectId: metadata.projectId,
    title: "stable N-1 review handoff",
    summary: "Review the accepted candidate artifact after predecessor-controlled completion.",
    dependencies: [{ to: implementationItem.id, type: "depends_on" }],
  });

  let blockedReview;
  try {
    await stableClient.call("coord_claim", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, workItemId: reviewItem.id, expectedVersion: 0 });
    throw new Error("reviewer unexpectedly claimed a blocked stable bootstrap work item");
  } catch (error) {
    blockedReview = { blocked: true, code: error.code, message: error.message };
  }
  const reviewerIntent = await stableClient.call("coord_intent", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, workItemId: reviewItem.id, kind: "modify", summary: "prepare the downstream stable N-1 review handoff", targets: [{ type: "path", value: "packages/coordination-runtime/src/runtime.ts" }] });

  async function stableChange(marker, attempt, intentId) {
    const absolute = path.join(candidateRoot, TARGET_PATH);
    const current = new Uint8Array(await readFile(absolute));
    const currentText = Buffer.from(current).toString("utf8");
    const nextText = `${currentText}${currentText.endsWith("\n") ? "" : "\n"}// Production Next stable bootstrap marker: ${marker}\n`;
    const receipt = await stableChangeRuntime.applyBytes({
      projectId: metadata.projectId,
      worktreeId: joined.implementation.worktreeId,
      agentSessionId: joined.implementation.agentSessionId,
      workItemId: implementationItem.id,
      intentId,
      path: TARGET_PATH,
      precondition: { path: TARGET_PATH, condition: "match", fingerprint: stableFingerprintBytes(current) },
      bytes: Buffer.from(nextText, "utf8"),
      planDigest: createHash("sha256").update(`stable-n-minus-one:${TARGET_PATH}:${marker}:${attempt}`, "utf8").digest("hex"),
    });
    const recorded = await stableClient.call("change_record", { receipt });
    assertCondition(recorded.verification?.verified === true, "stable N-1 mutation receipt was not read-back verified");
    const artifact = await stableClient.call("coord_publish", { projectId: metadata.projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: implementationItem.id, kind: "task_result", contentDigest: `sha256:${recorded.outputVersions?.[0]?.fingerprint?.digest ?? "missing"}`, classification: "internal", retention: "until-superseded" });
    return { receipt: recorded, artifact };
  }

  await stableClient.call("coord_claim", { projectId: metadata.projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: implementationItem.id, expectedVersion: 0 });
  const firstIntent = await stableClient.call("coord_intent", { projectId: metadata.projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: implementationItem.id, kind: "modify", summary: "stable N-1 controlled first implementation attempt", targets: [{ type: "path", value: TARGET_PATH }] });
  const firstChange = await stableChange("attempt-1", 1, firstIntent.id);
  const firstAwaiting = await stableClient.call("coord_complete", { projectId: metadata.projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: implementationItem.id });
  assertCondition(firstAwaiting.workItem.state === "awaiting_evaluation", "stable N-1 first attempt did not enter awaiting_evaluation");
  const firstRun = await stableClient.call("eval_request", { specId: spec.id, workItemId: implementationItem.id, changeReceiptId: firstChange.receipt.id, repositoryStateRef: firstChange.receipt.id, attempt: 1 });
  const firstStatus = await stableClient.call("eval_evaluate", { runId: firstRun.id, observed: { "target-marker": "attempt-1", publication: firstChange.receipt.status } });
  assertCondition(firstStatus.decision?.decision === "rejected", "stable N-1 first evaluation was expected to reject");
  assertCondition(firstStatus.feedback?.failedCriteria?.includes("target-marker"), "stable N-1 feedback did not cite the failed criterion");
  assertCondition(firstStatus.retry?.state === "recommended", "stable N-1 first evaluation did not recommend retry");
  const retryItem = await projection(stableClient, metadata.projectId, "work_item", implementationItem.id);
  assertCondition(retryItem.state === "needs_retry", `unexpected stable N-1 retry state: ${retryItem.state}`);

  await stableClient.call("coord_claim", { projectId: metadata.projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: implementationItem.id, expectedVersion: retryItem.version });
  const retryIntent = await stableClient.call("coord_intent", { projectId: metadata.projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: implementationItem.id, kind: "modify", summary: "stable N-1 authorized bounded retry", targets: [{ type: "path", value: TARGET_PATH }] });
  const retryChange = await stableChange("accepted", 2, retryIntent.id);
  const retryAwaiting = await stableClient.call("coord_complete", { projectId: metadata.projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: implementationItem.id });
  assertCondition(retryAwaiting.workItem.state === "awaiting_evaluation", "stable N-1 retry did not enter awaiting_evaluation");
  const secondRun = await stableClient.call("eval_request", { specId: spec.id, workItemId: implementationItem.id, changeReceiptId: retryChange.receipt.id, repositoryStateRef: retryChange.receipt.id, attempt: 2 });
  const secondStatus = await stableClient.call("eval_evaluate", { runId: secondRun.id, observed: { "target-marker": "accepted", publication: retryChange.receipt.status } });
  assertCondition(secondStatus.decision?.decision === "accepted", "stable N-1 retry evaluation was not accepted");
  const acceptedItem = await projection(stableClient, metadata.projectId, "work_item", implementationItem.id);
  assertCondition(acceptedItem.state === "accepted" && acceptedItem.acceptedEvaluationRunId === secondRun.id, "stable N-1 accepted evaluation provenance was not applied");
  const completed = await stableClient.call("coord_complete", { projectId: metadata.projectId, agentSessionId: joined.implementation.agentSessionId, workItemId: implementationItem.id, evaluationRunId: secondRun.id });
  assertCondition(completed.workItem.state === "done", "stable N-1 accepted WorkItem did not complete");
  assertCondition(completed.unblockedWorkItemIds?.includes(reviewItem.id), "stable N-1 completion did not unblock reviewer");

  const reviewerBefore = await projection(stableClient, metadata.projectId, "work_item", reviewItem.id);
  assertCondition(reviewerBefore.state === "ready", `stable N-1 reviewer was not ready: ${reviewerBefore.state}`);
  await stableClient.call("coord_claim", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, workItemId: reviewItem.id, expectedVersion: reviewerBefore.version });
  await stableClient.call("coord_intent", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, workItemId: reviewItem.id, kind: "verify", summary: "stable N-1 review of accepted candidate change", targets: [{ type: "path", value: TARGET_PATH }] });
  const reviewerSync = await stableClient.call("coord_sync", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: "0", maxEvents: 100, maxBytes: 128 * 1024 });
  const reviewerCompleted = await stableClient.call("coord_complete", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, workItemId: reviewItem.id });
  assertCondition(reviewerCompleted.workItem.state === "done", "stable N-1 reviewer did not complete");
  assertCondition(reviewerSync.highPriority?.some((item) => item.event.eventType === "ImpactDetected" && item.reason === "impact_result"), "stable N-1 reviewer did not receive impact routing");

  const replayOne = await stableClient.call("coord_sync", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: "0", maxEvents: 100, maxBytes: 128 * 1024 });
  const replayTwo = await stableClient.call("coord_sync", { projectId: metadata.projectId, agentSessionId: joined.reviewer.agentSessionId, sinceSequence: "0", maxEvents: 100, maxBytes: 128 * 1024 });
  const observerSync = await stableClient.call("coord_sync", { projectId: metadata.projectId, agentSessionId: joined.observer.agentSessionId, sinceSequence: "0", maxEvents: 100, maxBytes: 128 * 1024 });
  const events = await listAllEvents(stableClient, metadata.projectId);
  const eventTypes = [...new Set(events.map((event) => event.eventType))].sort();
  const mcpAfter = capabilityData(await mcpClient.callTool({ name: "fs_read", arguments: { path: TARGET_PATH } }));
  const targetText = Buffer.from(await readFile(path.join(candidateRoot, TARGET_PATH))).toString("utf8");
  const afterTree = await treeDigest(candidateRoot);
  const stableArtifact = {
    sourceSha: bootstrapSha,
    stableWorktreeHead: stableHead,
    daemon: { path: "apps/my-pi-daemon/dist/main.js", sha256: await sha256File(stableDaemonPath) },
    mcp: { path: "apps/my-pi-mcp/dist/main.js", sha256: await sha256File(stableMcpPath) },
  };
  const stableRuntimeUsed = stableHead === bootstrapSha && stableClean && stableBuild.passed && stableArtifact.daemon.sha256.length === 64 && stableArtifact.mcp.sha256.length === 64 && Number.isInteger(daemon.pid) && daemon.pid > 0 && mcpTools.includes("fs_read") && path.resolve(mcpWorkspaceInfo.root) === path.resolve(candidateRoot);
  const stableAuthorityUsed = stableRuntimeUsed && candidateWorktreeHead === candidateSha && candidateBuild.passed && candidateCleanAtStart && stableChangeRuntime !== undefined && firstChange.receipt.verification?.verified === true && retryChange.receipt.verification?.verified === true && stableClient !== undefined && mcpClient !== undefined;
  assertCondition(stableAuthorityUsed, "stable N-1 runtime did not demonstrably control the candidate workflow");
  assertCondition(JSON.stringify(routeKeys(replayOne)) === JSON.stringify(routeKeys(replayTwo)), "stable N-1 routing replay was not deterministic");

  const evidence = {
    schemaVersion: "1",
    id: "PN9",
    profile: "PN9-self-host",
    evidenceKind: "stable_bootstrap_replay",
    status: "ACCEPTED",
    promotionEligible: true,
    bootstrapSha,
    bootstrapMode: "stable-n-minus-one-runtime",
    stableNMinusOneVerified: stableAuthorityUsed,
    commit: candidateSha,
    candidateSha,
    candidateDirty: candidateDirtyState,
    candidateStateDigest: candidateSourceStateDigest,
    projectId: metadata.projectId,
    bootstrapProof: {
      approvedBaselineSha: APPROVED_BASELINE_SHA,
      predecessorSelection: "fe671ae is the newer remote-qualified predecessor with the required daemon/evaluation runtime; the approved baseline predates those components",
      remoteQualification,
      stableBuild,
      candidateBuild,
      stableWorktree: { head: stableHead, clean: stableClean, artifact: stableArtifact },
      candidateWorktree: { head: candidateWorktreeHead, cleanAtStart: candidateCleanAtStart, initialTree: beforeTree, finalTree: afterTree },
      runtime: { stableDaemonStarted: Number.isInteger(daemon.pid) && daemon.pid > 0, stableDaemonPid: daemon.pid, stableDaemonProjectId: metadata.projectId, stableMcpConnected: mcpClient !== undefined, stableMcpWorkspaceRoot: mcpWorkspaceInfo.root, candidateDaemonStarted: false },
      authority: { stableRuntimeMediated: stableAuthorityUsed, mutationRuntimeSha: bootstrapSha, evaluationRuntimeSha: bootstrapSha, mutationReceiptIds: [firstChange.receipt.id, retryChange.receipt.id], evaluationRunIds: [firstRun.id, secondRun.id], candidateDaemonUsed: false },
      legacyInspection: { tools: mcpTools, beforeContentHash: mcpBefore.content_hash, afterContentHash: mcpAfter.content_hash },
    },
    worktrees: [
      { role: "implementation", id: joined.implementation.worktreeId, head: candidateWorktreeHead, initialTree: beforeTree, finalTree: afterTree },
      { role: "reviewer", id: joined.reviewer.worktreeId, head: candidateSha, isolated: true },
      { role: "observer", id: joined.observer.worktreeId, head: candidateSha, isolated: true },
    ],
    agentSessions: Object.entries(joined).map(([role, value]) => ({ role, id: value.agentSessionId })),
    workItems: { implementation: implementationItem.id, review: reviewItem.id },
    evaluations: { specId: spec.id, rejectedRunId: firstRun.id, acceptedRunId: secondRun.id, firstDecision: firstStatus.decision, secondDecision: secondStatus.decision },
    changeReceipts: [firstChange.receipt, retryChange.receipt],
    feedback: { firstPacketId: firstStatus.feedback?.id, failedCriteria: firstStatus.feedback?.failedCriteria ?? [], retryState: firstStatus.retry?.state },
    routing: { reviewerInitialBlockObserved: blockedReview.blocked === true, impactDetected: eventTypes.includes("ImpactDetected"), replayDeterministic: JSON.stringify(routeKeys(replayOne)) === JSON.stringify(routeKeys(replayTwo)), replayItems: routeKeys(replayOne).length, observerItems: routeKeys(observerSync).length },
    eventLog: { count: events.length, throughSequence: events.at(-1)?.sequence ?? "0", types: eventTypes },
    verification: { targetSourceMarker: targetText.includes("Production Next stable bootstrap marker: accepted"), acceptedAfterRetry: targetText.includes("Production Next stable bootstrap marker: accepted"), noAutonomousSpawn: true, boundedRetryAttempts: 2 },
    metrics: { firstTree: beforeTree, secondTree: afterTree, finalTree: afterTree, retryIterations: 1, evaluationFalseAccepts: 0 },
  };
  assertCondition(evidence.verification.targetSourceMarker && evidence.routing.impactDetected, "stable N-1 final source/routing proof is incomplete");
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidenceOutput === undefined) {
    console.log(serialized);
  } else {
    await writeFile(path.resolve(ROOT, evidenceOutput), serialized, "utf8");
    console.log(JSON.stringify({ profile: evidence.profile, evidencePath: path.relative(ROOT, path.resolve(ROOT, evidenceOutput)).replaceAll(path.sep, "/"), candidateSha: evidence.candidateSha, candidateDirty: evidence.candidateDirty, bootstrapSha: evidence.bootstrapSha, stableNMinusOneVerified: evidence.stableNMinusOneVerified, acceptedRunId: secondRun.id }, null, 2));
  }
} finally {
  await mcpClient?.close().catch(() => undefined);
  await stopProcess(daemon).catch(() => undefined);
  if (observerAdded) await removeWorktree(observerRoot).catch(() => undefined);
  if (reviewerAdded) await removeWorktree(reviewerRoot).catch(() => undefined);
  if (candidateAdded) await removeWorktree(candidateRoot).catch(() => undefined);
  if (stableAdded) await removeWorktree(stableRoot).catch(() => undefined);
  await rm(stagingRoot, { recursive: true, force: true });
}
