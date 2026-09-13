import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateObservedTask } from "./validate-observed-task-v2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEX = /^[0-9a-f]{40}$/i;
const ALLOWED_COMMANDS = new Set(["node", "node.exe", "npm", "npm.cmd", "pnpm", "pnpm.cmd", "go", "go.exe", "cargo", "cargo.exe", "python", "python.exe"]);

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function runGit(root, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return undefined;
    const detail = error?.stderr?.toString?.() ?? error?.message ?? String(error);
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function commitExists(root, commit, label) {
  if (!HEX.test(commit)) throw new Error(`${label} must be a full commit SHA`);
  runGit(root, ["cat-file", "-e", `${commit}^{commit}`]);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function runId(taskId, armId, baseCommit, runAt) {
  return `run-${sha256(`${taskId}\0${armId}\0${baseCommit}\0${runAt}`).slice(0, 16)}`;
}

function parseArgs(argv) {
  const values = { root: ROOT, execute: false, keepWorktrees: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--task", "--output", "--result", "--root", "--run-at", "--stable-authority-sha"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      values[arg.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (arg === "--execute") values.execute = true;
    else if (arg === "--keep-worktrees") values.keepWorktrees = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("node scripts/dogfood-observed-paired-v2.mjs --task <task.json> [--output <manifest.json>] [--result <result.json>] [--run-at <iso>] [--stable-authority-sha <sha>] [--execute]");
      return undefined;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!values.task) throw new Error("--task is required");
  return values;
}

function validatePredeclaredCommands(task) {
  const commands = [
    ...["control", "treatment"].flatMap((armId) => task.arms?.[armId]?.setupCommands ?? []),
    ...task.requiredTests,
  ];
  for (const command of commands) {
    const executable = path.basename(command.argv[0]).toLowerCase();
    if (!ALLOWED_COMMANDS.has(executable)) throw new Error(`test command ${command.id} is not allowed: ${command.argv[0]}`);
  }
}

function declaredCommands(task, armId) {
  const setup = task.arms?.[armId]?.setupCommands ?? [];
  return [
    ...setup.map((command) => ({ ...command, phase: "arm_setup" })),
    ...task.requiredTests.map((command) => ({ ...command, phase: "downstream" })),
  ];
}

function assertTaskPreRegistered(root, task) {
  if (!HEX.test(task.taskDefinitionCommit)) throw new Error("taskDefinitionCommit is not a full commit SHA");
  commitExists(root, task.baseCommit, "baseCommit");
  const current = runGit(root, ["rev-parse", "HEAD"]);
  runGit(root, ["cat-file", "-e", `${task.taskDefinitionCommit}^{commit}`]);
  const ancestorCheck = runGit(root, ["merge-base", "--is-ancestor", task.taskDefinitionCommit, current], { allowFailure: true });
  if (ancestorCheck !== "") {
    // `git merge-base --is-ancestor` has no stdout; a non-empty result is not
    // expected, but the command's exit status is the authoritative check.
    throw new Error("task definition commit is not an ancestor of the current checkout");
  }
  const relative = task.taskDefinitionPath.replaceAll("\\", "/");
  if (relative.startsWith("/") || relative.split("/").includes("..")) throw new Error("taskDefinitionPath must remain inside the repository");
  const committed = runGit(root, ["show", `${task.taskDefinitionCommit}:${relative}`]);
  const committedValue = JSON.parse(committed);
  const selfBound = task.taskDefinitionCommit.toLowerCase() === current.toLowerCase()
    && (committedValue.taskDefinitionCommit !== task.taskDefinitionCommit || committedValue.baseCommit !== task.baseCommit);
  if (selfBound) {
    for (const [label, commit] of [["committed task definition commit", committedValue.taskDefinitionCommit], ["committed base commit", committedValue.baseCommit]]) {
      commitExists(root, commit, label);
      const registrationAncestor = runGit(root, ["merge-base", "--is-ancestor", commit, current], { allowFailure: true });
      if (registrationAncestor !== "") throw new Error("self-bound task definition must retain ancestor binding commits");
    }
    const committedWithoutBinding = { ...committedValue };
    const taskWithoutBinding = { ...task };
    delete committedWithoutBinding.taskDefinitionCommit;
    delete taskWithoutBinding.taskDefinitionCommit;
    delete committedWithoutBinding.baseCommit;
    delete taskWithoutBinding.baseCommit;
    if (stableJson(committedWithoutBinding) !== stableJson(taskWithoutBinding)) throw new Error("task definition changed after preregistration");
  } else if (stableJson(committedValue) !== stableJson(task)) {
    throw new Error("task definition changed after preregistration");
  }
  return current;
}

export function buildPairedManifest(task, { currentCommit = task.taskDefinitionCommit, runAt = "2026-09-13T00:00:00.000Z", execute = false, stableAuthorityCommit } = {}) {
  const validation = validateObservedTask(task);
  if (!validation.ok) throw new Error(`invalid ObservedTask v2: ${validation.errors.join("; ")}`);
  if (Date.parse(runAt) < Date.parse(task.registeredAt)) throw new Error("runAt must not precede task preregistration");
  validatePredeclaredCommands(task);
  if (!HEX.test(currentCommit)) throw new Error("currentCommit must be a full commit SHA");
  const arms = ["control", "treatment"].map((armId) => {
    const arm = task.arms[armId];
    return {
      armId,
      profileId: arm.profileId,
      runId: runId(task.taskId, armId, task.baseCommit, runAt),
      sessionId: `session-${sha256(`${task.taskId}\0${arm.sessionKey}\0${runAt}`).slice(0, 16)}`,
      worktreeId: `worktree-${sha256(`${task.taskId}\0${arm.worktreeKey}\0${runAt}`).slice(0, 16)}`,
      baseCommit: task.baseCommit,
      commands: declaredCommands(task, armId).map((command) => ({ id: command.id, argv: [...command.argv], timeoutMs: command.timeoutMs, phase: command.phase, status: execute ? "pending" : "planned" })),
    };
  });
  return {
    schemaVersion: "2",
    recordType: "paired-run-manifest-v2",
    taskId: task.taskId,
    taskDefinition: task.taskDefinitionPath,
    taskDefinitionCommit: task.taskDefinitionCommit,
    currentCommit,
    baseCommit: task.baseCommit,
    runAt,
    execute,
    arms,
    independentAdjudication: task.adjudication,
    contaminationControls: task.contaminationControls,
    authority: {
      stableRequired: task.contaminationControls.stableAuthorityRequired === true,
      stableCommit: stableAuthorityCommit ?? null,
    },
  };
}

export function buildObservedResult(task, manifest, {
  runStartedAt = manifest.runAt,
  runCompletedAt = manifest.runAt,
  adjudication,
  measurements = [],
  contaminationByArm = {},
} = {}) {
  const armResults = manifest.arms.map((arm) => ({
    armId: arm.armId,
    runId: arm.runId,
    sessionId: arm.sessionId,
    worktreeId: arm.worktreeId,
    baseCommit: arm.baseCommit,
    sourceStateDigest: arm.sourceStateDigest ?? sha256(`${arm.baseCommit}\0source-tree`),
    commands: arm.commands.map((command) => ({
      id: command.id,
      argv: [...command.argv],
      ...(command.phase ? { phase: command.phase } : {}),
      status: ["passed", "failed", "timed_out", "not_run"].includes(command.status) ? command.status : "not_run",
      exitCode: command.exitCode ?? null,
      ...(command.stdoutDigest ? { stdoutDigest: command.stdoutDigest } : {}),
      ...(command.stderrDigest ? { stderrDigest: command.stderrDigest } : {}),
    })),
    contamination: contaminationByArm[arm.armId] ?? { detected: false, reasons: [] },
  }));
  const contaminated = armResults.some((arm) => arm.contamination.detected);
  const commandsPassed = armResults.every((arm) => arm.commands.every((command) => command.status === "passed"));
  return {
    schemaVersion: "2",
    recordType: "observed-result-v2",
    taskId: task.taskId,
    taskDefinition: task.taskDefinitionPath,
    taskDefinitionCommit: task.taskDefinitionCommit,
    runId: `run-${sha256(`${task.taskId}\0paired\0${task.baseCommit}\0${manifest.runAt}`).slice(0, 16)}`,
    status: contaminated ? "CONTAMINATED" : commandsPassed ? "COMPLETED" : "FAILED",
    baseCommit: task.baseCommit,
    runStartedAt,
    runCompletedAt,
    arms: armResults,
    ...(measurements.length > 0 ? { measurements } : {}),
    adjudication: {
      independent: adjudication?.independent === true,
      evaluatorRunId: adjudication?.evaluatorRunId ?? `eval-${sha256(`${task.taskId}\0${manifest.runAt}`).slice(0, 16)}`,
      recordedAt: adjudication?.recordedAt ?? runCompletedAt,
      outcome: commandsPassed && !contaminated && adjudication?.independent === true && adjudication?.outcome === "accepted" ? "accepted" : "inconclusive",
      evidenceRefs: adjudication?.evidenceRefs ?? ["paired-run-manifest", "predeclared-command-results"],
    },
  };
}

function parsePorcelainPaths(output) {
  return output.split("\0").filter(Boolean).map((entry) => entry.length > 3 ? entry.slice(3) : entry).map((entry) => entry.includes(" -> ") ? entry.slice(entry.lastIndexOf(" -> ") + 4) : entry);
}

function forbiddenPathMatch(relativePath, pattern) {
  const pathValue = relativePath.replaceAll("\\", "/");
  const patternValue = String(pattern).replaceAll("\\", "/");
  return patternValue.endsWith("/**")
    ? pathValue === patternValue.slice(0, -3) || pathValue.startsWith(`${patternValue.slice(0, -3)}/`)
    : pathValue === patternValue;
}

function inspectFreshWorktree(worktree, forbiddenPaths) {
  const output = runGit(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"]);
  const changedPaths = parsePorcelainPaths(output);
  const reasons = changedPaths.length > 0 ? [`worktree was not clean before arm execution: ${changedPaths.join(", ")}`] : [];
  const forbidden = changedPaths.filter((relativePath) => forbiddenPaths.some((pattern) => forbiddenPathMatch(relativePath, pattern)));
  if (forbidden.length > 0) reasons.push(`forbidden cross-arm artifact paths present: ${forbidden.join(", ")}`);
  return { detected: reasons.length > 0, reasons };
}

function execCommand(argv, cwd, timeoutMs) {
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
      resolve({ status: timedOut ? "timed_out" : exitCode === 0 ? "passed" : "failed", exitCode: timedOut ? null : exitCode, stdoutDigest: sha256(stdout), stderrDigest: sha256(stderr) });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ status: "failed", exitCode: null, stdoutDigest: sha256(stdout), stderrDigest: sha256(stderr) });
    });
  });
}

async function executeManifest(manifest, task, root, keepWorktrees) {
  const runRoot = path.join(root, ".my-pi", "observed-runs", task.taskId);
  await mkdir(runRoot, { recursive: true });
  const created = [];
  try {
    for (const arm of manifest.arms) {
      const worktree = path.join(runRoot, arm.armId);
      runGit(root, ["worktree", "add", "--detach", worktree, task.baseCommit]);
      created.push(worktree);
      arm.worktreePath = path.relative(root, worktree).replaceAll(path.sep, "/");
      arm.sourceStateDigest = sha256(`${runGit(root, ["rev-parse", `${task.baseCommit}^{tree}`])}\0source-tree`);
      arm.contamination = inspectFreshWorktree(worktree, task.contaminationControls.forbiddenPaths);
      for (const command of arm.commands) {
        if (arm.contamination.detected) {
          command.status = "not_run";
          command.exitCode = null;
          command.stdoutDigest = sha256("");
          command.stderrDigest = sha256("");
          continue;
        }
        const result = await execCommand(command.argv, worktree, command.timeoutMs);
        Object.assign(command, result);
      }
    }
    manifest.status = "EXECUTED";
    manifest.result = buildObservedResult(task, manifest, {
      runCompletedAt: new Date().toISOString(),
      contaminationByArm: Object.fromEntries(manifest.arms.map((arm) => [arm.armId, arm.contamination ?? { detected: false, reasons: [] }])),
    });
    return manifest;
  } finally {
    if (!keepWorktrees) {
      for (const worktree of created.reverse()) runGit(root, ["worktree", "remove", "--force", worktree], { allowFailure: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) return 0;
  const root = path.resolve(args.root);
  const taskPath = path.resolve(root, args.task);
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  const currentCommit = assertTaskPreRegistered(root, task);
  if (task.contaminationControls?.stableAuthorityRequired === true) {
    if (!args.stable_authority_sha || !HEX.test(args.stable_authority_sha)) throw new Error("--stable-authority-sha is required when stableAuthorityRequired is true");
    commitExists(root, args.stable_authority_sha, "stable authority commit");
    if (args.stable_authority_sha.toLowerCase() === currentCommit.toLowerCase()) throw new Error("stable authority commit must differ from the current candidate commit");
  }
  const runAt = args.run_at ?? new Date().toISOString();
  const manifest = buildPairedManifest(task, { currentCommit, runAt, execute: args.execute, stableAuthorityCommit: args.stable_authority_sha });
  if (args.execute) await executeManifest(manifest, task, root, args.keepWorktrees);
  const output = path.resolve(root, args.output ?? path.join("dogfood", "observed-tasks", `${task.taskId}.paired-manifest.json`));
  const relative = path.relative(root, output);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--output must stay inside the repository");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (args.execute && manifest.result) {
    const resultOutput = path.resolve(root, args.result ?? path.join("dogfood", "observed-tasks", `${task.taskId}.result.json`));
    const resultRelative = path.relative(root, resultOutput);
    if (resultRelative.startsWith("..") || path.isAbsolute(resultRelative)) throw new Error("--result must stay inside the repository");
    await mkdir(path.dirname(resultOutput), { recursive: true });
    await writeFile(resultOutput, `${JSON.stringify(manifest.result, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ ok: true, output, taskId: task.taskId, status: manifest.status ?? "PLANNED" }, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
