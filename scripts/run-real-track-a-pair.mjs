#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";
import { validateObservedPair } from "./validate-observed-task-v2.mjs";

const ROOT = process.cwd();

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--task") {
      const value = argv[index + 1];
      if (!value) throw new Error("--task requires a value");
      values.task = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("node scripts/run-real-track-a-pair.mjs --task <task.json>");
      return undefined;
    } else throw new Error("unknown argument: " + arg);
  }
  if (!values.task) throw new Error("--task is required");
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function git(root, args, allowFailure = false) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw new Error("git " + args.join(" ") + " failed: " + (error?.stderr?.toString?.() ?? error?.message ?? String(error)));
  }
}

function unwrap(result) {
  if (result.isError) throw new Error(result.content?.map((item) => item.text ?? "").join("\\n") || "my-pi tool failed");
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("my-pi tool returned no text content");
  const envelope = JSON.parse(text);
  if (envelope.error) throw new Error(envelope.error.message ?? "my-pi request failed");
  return envelope.data ?? envelope;
}

async function connectMyPi() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "apps", "my-pi-mcp", "dist", "main.js"), "--workspace", ROOT, "--security-profile", "trusted"],
    cwd: ROOT,
    stderr: "pipe",
  });
  const client = new Client({ name: "my-pi-real-track-a-pair", version: "1" });
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  return unwrap(await client.callTool({ name, arguments: args }));
}

async function writeJsonWithCas(client, relativePath, value) {
  const content = JSON.stringify(value, null, 2) + "\n";
  let expectedHash;
  try {
    expectedHash = (await call(client, "fs_read", { path: relativePath })).content_hash;
  } catch {
    expectedHash = undefined;
  }
  return call(client, "fs_write", {
    path: relativePath,
    content,
    ...(expectedHash ? { expected_hash: expectedHash } : {}),
  });
}

function runDogfood(taskPath, manifestPath, rawResultPath) {
  return execFileSync(process.execPath, [
    path.join(ROOT, "scripts", "dogfood-observed-paired-v2.mjs"),
    "--root", ROOT,
    "--task", taskPath,
    "--output", manifestPath,
    "--result", rawResultPath,
    "--execute",
    "--keep-worktrees",
  ], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}

function evaluateArm(worktree, taskDefinition) {
  const stdout = execFileSync(process.execPath, [path.join(worktree, "scripts", "evaluate-track-a-arm.mjs"), "--task", taskDefinition], {
    cwd: worktree,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

async function cleanupRun(taskId, manifest) {
  const paths = manifest?.arms?.map((arm) => arm.worktreePath).filter(Boolean) ?? [".my-pi/observed-runs/" + taskId + "/control", ".my-pi/observed-runs/" + taskId + "/treatment"];
  for (const relativePath of paths.reverse()) git(ROOT, ["worktree", "remove", "--force", path.resolve(ROOT, relativePath)], true);
  await rm(path.join(ROOT, ".my-pi", "observed-runs", taskId), { recursive: true, force: true }).catch(() => undefined);
}

function buildMeasurements(task, reports) {
  const measurements = [];
  for (const report of reports) {
    for (const metric of task.metrics) {
      const value = report.metrics?.[metric.id];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("independent evaluator omitted metric " + metric.id + " for " + report.arm);
      measurements.push({
        id: metric.id,
        armId: report.arm,
        value,
        unit: metric.id.includes("recall") || metric.id.includes("precision") || metric.id.includes("pass") ? "ratio" : "count",
        source: "independent evaluator stdout for " + task.taskId,
      });
    }
  }
  return measurements;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) return 0;
  const taskPath = path.resolve(ROOT, args.task);
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  const taskDefinition = task.taskDefinitionPath;
  const manifestPath = "dogfood/observed-tasks/" + task.taskId + ".paired-manifest.json";
  const rawResultPath = "dogfood/observed-tasks/" + task.taskId + ".raw-result.json";
  let manifest;
  let myPi;
  try {
    runDogfood(taskDefinition, manifestPath, rawResultPath);
    manifest = JSON.parse(await readFile(path.join(ROOT, manifestPath), "utf8"));
    const rawResult = JSON.parse(await readFile(path.join(ROOT, rawResultPath), "utf8"));
    const reports = manifest.arms.map((arm) => evaluateArm(path.resolve(ROOT, arm.worktreePath), taskDefinition));
    const allCommandsPassed = rawResult.arms.every((arm) => arm.commands.every((command) => command.status === "passed"));
    const allReportsAccepted = reports.every((report) => report.accepted);
    const evaluatorRunId = "eval-" + sha256(JSON.stringify(reports)).slice(0, 16);
    const result = {
      ...rawResult,
      taskClass: task.taskClass,
      evidenceKind,
      observationSource: task.taskClass === "PN8" ? "controlled_replay_of_recorded_legacy_failure" : "real_source_change",
      status: allCommandsPassed && allReportsAccepted ? "COMPLETED" : "FAILED",
      runCompletedAt: new Date().toISOString(),
      measurements: buildMeasurements(task, reports),
      adjudication: {
        independent: true,
        evaluatorRunId,
        recordedAt: new Date().toISOString(),
        outcome: allCommandsPassed && allReportsAccepted ? "accepted" : "inconclusive",
        evidenceRefs: ["paired-run-manifest", "predeclared-command-results", "independent-evaluator-stdout"],
      },
    };
    const validation = validateObservedPair(task, result);
    if (!validation.ok) throw new Error("final observed pair failed validation: " + validation.errors.join("; "));
    myPi = await connectMyPi();
    const resultWrite = await writeJsonWithCas(myPi, "dogfood/observed-tasks/" + task.taskId + ".result.json", result);
    const resultRead = await call(myPi, "fs_read", { path: "dogfood/observed-tasks/" + task.taskId + ".result.json", start_line: 1, end_line: 200_000 });
    const evidenceKind = task.taskClass === "PN8" ? "controlled_replay" : "observed_source_change";
    const evidenceSchema = task.taskClass === "PN8" ? "my-pi/track-a-pn8-controlled-replay-evidence/v1" : "my-pi/track-a-real-pn6-evidence/v1";
    const evidencePrefix = task.taskClass === "PN8" ? "track-a-pn8-controlled-replay-" : "track-a-real-pn6-";
    const evidence = {
      schemaVersion: evidenceSchema,
      measurementId: evidencePrefix + task.taskId + "-" + Date.now(),
      taskClass: task.taskClass,
      evidenceKind,
      observationSource: task.taskClass === "PN8" ? "replay of a recorded legacy real failure; not live product-value evidence" : "paired source-change workload",
      promotionEligible: false,
      measuredAt: new Date().toISOString(),
      sourceSetup: task.taskClass === "PN8" ? "official my-pi fs_patch with CAS expected_hash for failure replay and repair in isolated arm worktrees" : "official my-pi fs_patch with CAS expected_hash in isolated arm worktrees",
      evidenceWriter: "official my-pi fs_write followed by fs_read",
      taskId: task.taskId,
      taskDefinition: task.taskDefinitionPath,
      taskDefinitionCommit: task.taskDefinitionCommit,
      baseCommit: task.baseCommit,
      resultPath: "dogfood/observed-tasks/" + task.taskId + ".result.json",
      resultHash: resultRead.content_hash,
      commandStatus: rawResult.arms.map((arm) => ({ armId: arm.armId, commands: arm.commands.map((command) => ({ id: command.id, status: command.status, exitCode: command.exitCode, stdoutDigest: command.stdoutDigest, stderrDigest: command.stderrDigest })) })),
      independentReports: reports,
      validation: { pairValid: validation.ok, promotionEligible: false },
      interpretation: task.taskClass === "PN8" ? "Controlled replay of three recorded legacy failures. It measures replay fidelity and repair bookkeeping; it does not establish a live ordinary-versus-structured feedback product effect." : "This is a real source-change workload with one declared impact-routing variable; qualification is separate from promotion.",
    };
    const evidencePath = "evidence/" + evidencePrefix + task.taskId + ".json";
    await writeJsonWithCas(myPi, evidencePath, evidence);
    const evidenceRead = await call(myPi, "fs_read", { path: evidencePath, start_line: 1, end_line: 200_000 });
    console.log(JSON.stringify({ ok: true, taskId: task.taskId, resultHash: resultRead.content_hash, evidencePath, evidenceHash: evidenceRead.content_hash, evaluatorRunId, reports }, null, 2));
    return 0;
  } finally {
    if (myPi) await myPi.close();
    await cleanupRun(task.taskId, manifest);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
