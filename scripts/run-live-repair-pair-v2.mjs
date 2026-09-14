#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { validateObservedPair } from "./validate-observed-task-v2.mjs";
import { verifyObservedRegistration } from "./observed-registration-v2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_SHA = /^[0-9a-f]{40}$/i;

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
}

function git(root, args, allowFailure = false) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw new Error("git " + args.join(" ") + " failed: " + (error?.stderr?.toString?.() ?? error?.message ?? String(error)));
  }
}

function parseArgs(argv) {
  const values = { keepWorktrees: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--task", "--output", "--result", "--evidence"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(arg + " requires a value");
      values[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--keep-worktrees") values.keepWorktrees = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("node scripts/run-live-repair-pair-v2.mjs --task <task.json> [--output <manifest.json>] [--result <result.json>] [--evidence <evidence.json>] [--keep-worktrees]");
      return undefined;
    } else throw new Error("unknown argument: " + arg);
  }
  if (!values.task) throw new Error("--task is required");
  return values;
}

function unwrap(result) {
  if (result.isError) throw new Error(result.content?.map((item) => item.text ?? "").join("\n") || "my-pi tool failed");
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("my-pi tool returned no text content");
  const envelope = JSON.parse(text);
  if (envelope.error) throw new Error(envelope.error.message ?? "my-pi request failed");
  return envelope.data ?? envelope;
}

async function connectMyPi(workspaceRoot) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "apps", "my-pi-mcp", "dist", "main.js"), "--workspace", workspaceRoot, "--security-profile", "trusted"],
    cwd: ROOT,
    stderr: "pipe",
  });
  const client = new Client({ name: "my-pi-live-repair-v2", version: "1" });
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  return unwrap(await client.callTool({ name, arguments: args }));
}

function executeCommand(argv, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ status: timedOut ? "timed_out" : exitCode === 0 ? "passed" : "failed", exitCode: timedOut ? null : exitCode, stdout, stderr, stdoutDigest: sha256(stdout), stderrDigest: sha256(stderr) });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      const nextStderr = stderr + String(error);
      resolve({ status: "failed", exitCode: null, stdout, stderr: nextStderr, stdoutDigest: sha256(stdout), stderrDigest: sha256(nextStderr) });
    });
  });
}

function parseSummary(stdout, stderr) {
  const text = stdout + "\n" + stderr;
  const value = (name) => {
    const match = text.match(new RegExp("^(?:#|ℹ) " + name + "\\s+(\\d+)", "m"));
    return match ? Number(match[1]) : undefined;
  };
  return { tests: value("tests"), pass: value("pass"), fail: value("fail") };
}

function commandRecord(command, result, phase) {
  return { id: command.id, argv: [...command.argv], phase, status: result.status, exitCode: result.exitCode, stdoutDigest: result.stdoutDigest, stderrDigest: result.stderrDigest };
}

async function readSnapshot(client, relativePath) {
  return call(client, "fs_read", { path: relativePath, start_line: 1, end_line: 200_000 });
}

async function applyPatches(client, patches, phase) {
  const history = [];
  for (const patch of patches ?? []) {
    if (!patch || typeof patch.path !== "string" || typeof patch.old !== "string" || typeof patch.new !== "string") throw new Error(phase + " patch is incomplete");
    const before = await readSnapshot(client, patch.path);
    let oldText = patch.old;
    let newText = patch.new;
    let lineEndingMode = "lf";
    if (!before.content.includes(oldText) && before.content.includes(oldText.replaceAll("\n", "\r\n"))) {
      oldText = oldText.replaceAll("\n", "\r\n");
      newText = newText.replaceAll("\n", "\r\n");
      lineEndingMode = "crlf";
    }
    if (!before.content.includes(oldText)) throw new Error(phase + " patch anchor not found: " + (patch.id ?? patch.path));
    const patchResponse = await call(client, "fs_patch", { path: patch.path, expected_hash: before.content_hash, patch: { hunks: [{ old: oldText, new: newText }] } });
    const after = await readSnapshot(client, patch.path);
    if (patch.expectedAfterHash && after.content_hash !== patch.expectedAfterHash) throw new Error(phase + " patch produced an unexpected hash: " + (patch.id ?? patch.path));
    history.push({ id: patch.id ?? patch.path, path: patch.path, lineEndingMode, beforeHash: before.content_hash, afterHash: after.content_hash, patchResponseHash: patchResponse.content_hash, mutationTool: "official my-pi fs_patch", casExpectedHash: before.content_hash });
  }
  return history;
}

async function writeJson(client, relativePath, value) {
  const content = JSON.stringify(value, null, 2) + "\n";
  let expectedHash;
  try { expectedHash = (await readSnapshot(client, relativePath)).content_hash; } catch { expectedHash = undefined; }
  return call(client, "fs_write", { path: relativePath, content, ...(expectedHash ? { expected_hash: expectedHash } : {}) });
}

function declaredCommands(task, armId) {
  return [
    ...(task.arms?.[armId]?.setupCommands ?? []).map((command) => ({ ...command, phase: "arm_setup" })),
    ...(task.requiredTests ?? []).map((command) => ({ ...command, phase: "downstream" })),
  ];
}

function frozenStateDigest(root, task) {
  const tree = git(root, ["rev-parse", task.baseCommit + "^{tree}"]);
  return sha256(tree + "\0" + stableJson(task.workload?.evaluationSetupPatches ?? []));
}

async function executeSetup(task, armId, worktree) {
  const records = [];
  for (const command of declaredCommands(task, armId).filter((item) => item.phase === "arm_setup")) {
    const result = await executeCommand(command.argv, worktree, command.timeoutMs);
    records.push(commandRecord(command, result, "arm_setup"));
    if (result.status !== "passed") throw new Error(armId + " setup command failed: " + command.id);
  }
  return records;
}

async function executeTests(task, worktree) {
  const records = [];
  const raw = [];
  for (const command of task.requiredTests) {
    const result = await executeCommand(command.argv, worktree, command.timeoutMs);
    records.push(commandRecord({ ...command, phase: "downstream" }, result, "downstream"));
    raw.push({ id: command.id, status: result.status, exitCode: result.exitCode, summary: parseSummary(result.stdout, result.stderr), stdoutDigest: result.stdoutDigest, stderrDigest: result.stderrDigest });
  }
  return { records, raw, allPassed: raw.every((item) => item.status === "passed"), summary: raw.at(-1)?.summary ?? {} };
}

async function runArm(task, armId, runRoot, frozenDigest, runStartedAt) {
  const worktree = path.join(runRoot, armId);
  git(ROOT, ["worktree", "add", "--detach", worktree, task.baseCommit]);
  let client;
  try {
    const clean = git(worktree, ["status", "--porcelain=v1", "--untracked-files=all", "--"]);
    if (clean) throw new Error(armId + " worktree was not clean before evaluation setup: " + clean);
    client = await connectMyPi(worktree);
    const evaluationSetupHistory = await applyPatches(client, task.workload.evaluationSetupPatches, "evaluation_setup");
    const setupCommands = await executeSetup(task, armId, worktree);
    const initial = await executeTests(task, worktree);
    const initialFailureObserved = !initial.allPassed;
    if (!initialFailureObserved) throw new Error(armId + " did not reproduce the preregistered frozen failure");
    const failureCriterion = task.workload.initialFailureCriterion;
    const feedbackMode = armId === "control" ? "ordinary_log" : "structured_feedback_packet";
    const feedback = armId === "control"
      ? { mode: feedbackMode, source: "ordinary command log", failedCriteria: [failureCriterion], stdoutDigest: initial.raw.at(-1)?.stdoutDigest, stderrDigest: initial.raw.at(-1)?.stderrDigest }
      : { mode: feedbackMode, packet: task.workload.feedbackPacket, observedFailure: { failedCriteria: [failureCriterion], stdoutDigest: initial.raw.at(-1)?.stdoutDigest, stderrDigest: initial.raw.at(-1)?.stderrDigest } };
    const repairPatches = task.workload.repairPatches?.[armId] ?? task.workload.repairPatches?.shared;
    if (!Array.isArray(repairPatches) || repairPatches.length === 0) throw new Error(armId + " has no preregistered repair patch");
    const repairHistory = await applyPatches(client, repairPatches, "live_repair");
    const final = await executeTests(task, worktree);
    const priorPassesPreserved = Number.isInteger(initial.summary.pass) && Number.isInteger(final.summary.pass) && final.summary.pass >= initial.summary.pass;
    const accepted = final.allPassed && priorPassesPreserved;
    const sessionId = "session-" + sha256(task.taskId + "\0" + armId + "\0" + runStartedAt).slice(0, 16);
    const worktreeId = "worktree-" + sha256(task.taskId + "\0" + armId + "\0" + runStartedAt).slice(0, 16);
    return {
      armId,
      runId: "run-" + sha256(task.taskId + "\0" + armId + "\0" + task.baseCommit + "\0" + runStartedAt).slice(0, 16),
      sessionId,
      worktreeId,
      baseCommit: task.baseCommit,
      sourceStateDigest: frozenDigest,
      commands: [...setupCommands, ...final.records],
      contamination: { detected: false, reasons: [] },
      evaluationSetupHistory,
      initialAttempt: { commands: initial.raw, summary: initial.summary, accepted: false, failureCriterion },
      feedback,
      repairHistory,
      finalAttempt: { commands: final.raw, summary: final.summary, accepted },
      repairSession: { armId, sessionId, worktreeId, frozenStateDigest: frozenDigest, feedbackMode, attempts: 1, initialFailureObserved, accepted, priorPassesPreserved, regressions: accepted ? 0 : 1, falseAccepts: accepted && final.summary.fail === 0 ? 0 : 1, repairPatchIds: repairHistory.map((item) => item.id), evaluatorEvidence: "independent downstream command output after official my-pi repair" },
    };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) return 0;
  const taskPath = path.resolve(ROOT, args.task);
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  if (task.taskClass !== "PN8" || task.workload?.evidenceKind !== "live_repair") throw new Error("task must be a PN8 live_repair definition");
  if (!FULL_SHA.test(task.baseCommit)) throw new Error("task baseCommit must be a full SHA");
  const runStartedAt = new Date().toISOString();
  const registration = await verifyObservedRegistration(ROOT, task, { runStartedAt });
  if (!registration.ok) throw new Error("Git preregistration failed: " + registration.errors.join("; "));
  const frozenDigest = frozenStateDigest(ROOT, task);
  const runRoot = path.join(ROOT, ".my-pi", "observed-runs-live", task.taskId);
  const arms = [];
  try {
    for (const armId of ["control", "treatment"]) arms.push(await runArm(task, armId, runRoot, frozenDigest, runStartedAt));
    const runCompletedAt = new Date().toISOString();
    const evaluatorRunId = "eval-" + sha256(JSON.stringify(arms.map((arm) => ({ armId: arm.armId, finalAttempt: arm.finalAttempt, repairSession: arm.repairSession })))).slice(0, 16);
    const accepted = arms.every((arm) => arm.repairSession.accepted);
    const result = {
      schemaVersion: "2",
      recordType: "observed-result-v2",
      taskId: task.taskId,
      taskDefinition: task.taskDefinitionPath,
      taskDefinitionCommit: task.taskDefinitionCommit,
      runId: "run-" + sha256(task.taskId + "\0paired-live-repair\0" + task.baseCommit + "\0" + runStartedAt).slice(0, 16),
      status: accepted ? "COMPLETED" : "FAILED",
      baseCommit: task.baseCommit,
      runStartedAt,
      runCompletedAt,
      evidenceKind: "live_repair",
      observationSource: "live repair from preregistered frozen failing state",
      arms: arms.map(({ armId, runId, sessionId, worktreeId, baseCommit, sourceStateDigest, commands, contamination }) => ({ armId, runId, sessionId, worktreeId, baseCommit, sourceStateDigest, commands, contamination })),
      measurements: arms.flatMap((arm) => [
        { id: "repair_yield", armId: arm.armId, value: arm.repairSession.accepted ? 1 : 0, unit: "ratio", source: "independent downstream command output" },
        { id: "repair_attempts", armId: arm.armId, value: arm.repairSession.attempts, unit: "count", source: "official my-pi repair history" },
        { id: "prior_passes_preserved", armId: arm.armId, value: arm.repairSession.priorPassesPreserved ? 1 : 0, unit: "ratio", source: "independent downstream command output" },
        { id: "regressions", armId: arm.armId, value: arm.repairSession.regressions, unit: "count", source: "independent downstream command output" },
        { id: "false_accepts", armId: arm.armId, value: arm.repairSession.falseAccepts, unit: "count", source: "independent downstream command output" },
      ]),
      repairSessions: arms.map((arm) => arm.repairSession),
      adjudication: { independent: true, evaluatorRunId, recordedAt: runCompletedAt, outcome: accepted ? "accepted" : "inconclusive", evidenceRefs: ["frozen-state-digest", "initial-failure-command-output", "official-my-pi-repair-history", "identical-independent-downstream-command-output"] },
    };
    const validation = validateObservedPair(task, result);
    if (!validation.ok) throw new Error("live repair result failed validation: " + validation.errors.join("; "));
    const manifest = {
      schemaVersion: "my-pi/observed-live-repair-manifest/v1",
      taskId: task.taskId,
      taskDefinition: task.taskDefinitionPath,
      taskDefinitionCommit: task.taskDefinitionCommit,
      baseCommit: task.baseCommit,
      frozenStateId: task.workload.frozenStateId,
      frozenStateDigest: frozenDigest,
      runStartedAt,
      runCompletedAt,
      registration: { receiptPath: task.registration.receiptPath, registrationCommit: registration.registrationCommit, registrationTimestamp: registration.registrationTimestamp },
      arms: arms.map((arm) => ({ armId: arm.armId, runId: arm.runId, sessionId: arm.sessionId, worktreeId: arm.worktreeId, evaluationSetupHistory: arm.evaluationSetupHistory, initialAttempt: arm.initialAttempt, feedback: arm.feedback, repairHistory: arm.repairHistory, finalAttempt: arm.finalAttempt, repairSession: arm.repairSession })),
      evaluatorRunId,
      authority: "official my-pi MCP fs_read/fs_patch/fs_write; independent node test process for evaluation",
    };
    const evidence = {
      schemaVersion: "my-pi/track-a-pn8-live-repair-evidence/v1",
      measurementId: "track-a-pn8-live-repair-" + task.taskId + "-" + Date.now(),
      taskClass: task.taskClass,
      evidenceKind: "live_repair",
      observationSource: "naturally occurring frozen failure at the preregistered historical commit",
      promotionEligible: false,
      measuredAt: runCompletedAt,
      taskId: task.taskId,
      taskDefinition: task.taskDefinitionPath,
      taskDefinitionCommit: task.taskDefinitionCommit,
      baseCommit: task.baseCommit,
      frozenStateId: task.workload.frozenStateId,
      frozenStateDigest: frozenDigest,
      resultPath: "dogfood/observed-tasks/" + task.taskId + ".result.json",
      repairSessions: result.repairSessions,
      resultValidation: { pairValid: true, promotionEligible: false },
      writer: "official my-pi fs_write followed by fs_read",
    };
    const rootClient = await connectMyPi(ROOT);
    try {
      const manifestPath = args.output ?? "dogfood/observed-tasks/" + task.taskId + ".paired-manifest.json";
      const resultPath = args.result ?? "dogfood/observed-tasks/" + task.taskId + ".result.json";
      const evidencePath = args.evidence ?? "evidence/track-a-pn8-live-repair-" + task.taskId + ".json";
      await writeJson(rootClient, manifestPath, manifest);
      await writeJson(rootClient, resultPath, result);
      const resultRead = await readSnapshot(rootClient, resultPath);
      evidence.resultHash = resultRead.content_hash;
      await writeJson(rootClient, evidencePath, evidence);
      const evidenceRead = await readSnapshot(rootClient, evidencePath);
      console.log(JSON.stringify({ ok: true, taskId: task.taskId, resultHash: resultRead.content_hash, evidenceHash: evidenceRead.content_hash, frozenStateDigest: frozenDigest, evaluatorRunId, repairSessions: result.repairSessions }, null, 2));
    } finally {
      await rootClient.close();
    }
    return 0;
  } finally {
    if (!args.keepWorktrees) {
      for (const armId of ["treatment", "control"]) git(ROOT, ["worktree", "remove", "--force", path.join(runRoot, armId)], true);
      await rm(runRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
