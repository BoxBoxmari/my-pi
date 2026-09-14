import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const FULL_SHA = /^[0-9a-f]{40}$/i;

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
}

function digest(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function repoRelative(root, value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(label + " must be a non-empty path");
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) throw new Error(label + " must be repository-relative");
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(label + " must remain inside the repository");
  return relative;
}

async function git(root, args, { allowFailure = false } = {}) {
  try {
    const result = await execFileAsync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return String(result.stdout ?? "").trim();
  } catch (error) {
    if (allowFailure) return undefined;
    const detail = String(error?.stderr ?? error?.message ?? error);
    throw new Error("git " + args.join(" ") + " failed: " + detail);
  }
}

async function isAncestor(root, ancestor, descendant) {
  try {
    await git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

async function committedJson(root, commit, relativePath, label) {
  const raw = await git(root, ["show", commit + ":" + relativePath]);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(label + " at " + commit + " is not valid JSON: " + error.message);
  }
}

async function committedBlob(root, commit, relativePath, label) {
  const blob = await git(root, ["rev-parse", commit + ":" + relativePath], { allowFailure: true });
  if (!FULL_SHA.test(blob ?? "")) throw new Error(label + " blob is not present in the registration commit");
  return blob.toLowerCase();
}

async function workingTreeBlob(root, relativePath, label) {
  const blob = await git(root, ["hash-object", "--", relativePath], { allowFailure: true });
  if (!FULL_SHA.test(blob ?? "")) throw new Error(label + " blob cannot be read from the working tree");
  return blob.toLowerCase();
}

/**
 * Verify that the current task is exactly the task recorded by an immutable
 * Git receipt. The receipt is a separate file so the registration identity is
 * not self-referential: its commit is derived from Git history, not declared
 * by the task itself. Any post-registration task edit, including binding-only
 * edits, is rejected.
 */
export async function verifyObservedRegistration(root, task, { runStartedAt } = {}) {
  const errors = [];
  let currentCommit;
  let registrationCommit;
  let registrationTimestamp;
  let taskDigest;
  let taskDefinitionBlob;
  let registrationReceiptBlob;
  let receiptPath;
  try {
    currentCommit = await git(root, ["rev-parse", "HEAD"]);
    if (!FULL_SHA.test(currentCommit)) errors.push("current HEAD is not a full commit SHA");
    if (!FULL_SHA.test(task?.taskDefinitionCommit ?? "")) errors.push("taskDefinitionCommit is not a full commit SHA");
    if (!task?.registration?.receiptPath) errors.push("Git registration receipt is required");
    const taskPath = repoRelative(root, task?.taskDefinitionPath, "taskDefinitionPath");
    receiptPath = repoRelative(root, task?.registration?.receiptPath, "registration.receiptPath");
    if (receiptPath === taskPath) errors.push("registration receipt must be a separate file");
    if (errors.length > 0) return { ok: false, errors, currentCommit, receiptPath };

    const receiptLog = await git(root, ["log", "-1", "--format=%H", "--", receiptPath], { allowFailure: true });
    if (!receiptLog || !FULL_SHA.test(receiptLog)) {
      errors.push("registration receipt is not committed in Git");
      return { ok: false, errors, currentCommit, receiptPath };
    }
    registrationCommit = receiptLog;
    registrationTimestamp = await git(root, ["show", "-s", "--format=%cI", registrationCommit]);
    const runTimestamp = runStartedAt ? Date.parse(runStartedAt) : undefined;
    if (runStartedAt && !Number.isFinite(runTimestamp)) errors.push("runStartedAt must be a valid ISO-8601 timestamp");
    const definitionTimestamp = await git(root, ["show", "-s", "--format=%cI", task.taskDefinitionCommit], { allowFailure: true });
    if (!definitionTimestamp) errors.push("taskDefinitionCommit does not resolve to a Git commit");
    else if (runTimestamp !== undefined && Date.parse(definitionTimestamp) > runTimestamp) errors.push("taskDefinitionCommit commit time must precede runStartedAt");
    if (!FULL_SHA.test(task?.baseCommit ?? "")) {
      errors.push("baseCommit is not a full commit SHA");
    } else {
      const baseTimestamp = await git(root, ["show", "-s", "--format=%cI", task.baseCommit], { allowFailure: true });
      if (!baseTimestamp) errors.push("baseCommit does not resolve to a Git commit");
      else if (runTimestamp !== undefined && Date.parse(baseTimestamp) > runTimestamp) errors.push("baseCommit commit time must precede runStartedAt");
    }
    if (!(await isAncestor(root, registrationCommit, currentCommit))) errors.push("registration receipt commit is not an ancestor of current HEAD");
    if (!(await isAncestor(root, task.taskDefinitionCommit, registrationCommit))) errors.push("taskDefinitionCommit must be an ancestor of the registration receipt commit");
    if (runTimestamp !== undefined && Date.parse(registrationTimestamp) > runTimestamp) errors.push("registration receipt commit must precede runStartedAt");
    if (task.registeredAt && runTimestamp !== undefined && Date.parse(task.registeredAt) > runTimestamp) errors.push("task registeredAt must not follow runStartedAt");

    const committedTask = await committedJson(root, registrationCommit, taskPath, "task definition");
    const committedReceipt = await committedJson(root, registrationCommit, receiptPath, "registration receipt");
    taskDefinitionBlob = await committedBlob(root, registrationCommit, taskPath, "task definition");
    registrationReceiptBlob = await committedBlob(root, registrationCommit, receiptPath, "registration receipt");
    const currentTaskBlob = await workingTreeBlob(root, taskPath, "current task definition");
    if (currentTaskBlob !== taskDefinitionBlob) errors.push("working task definition blob differs from the registered Git blob");
    taskDigest = digest(committedTask);
    if (stableJson(committedTask) !== stableJson(task)) errors.push("task definition changed after Git registration");
    if (committedReceipt.schemaVersion !== "1" || committedReceipt.recordType !== "observed-task-registration-v1") errors.push("registration receipt schema is invalid");
    if (committedReceipt.taskId !== task.taskId) errors.push("registration receipt taskId does not match task");
    if (committedReceipt.taskDefinitionPath !== taskPath) errors.push("registration receipt taskDefinitionPath does not match task");
    if (committedReceipt.taskDigest !== taskDigest) errors.push("registration receipt taskDigest does not match the committed task definition");
    if (committedReceipt.registeredAt !== task.registeredAt) errors.push("registration receipt registeredAt does not match task");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: errors.length === 0, errors, currentCommit, registrationCommit, registrationTimestamp, receiptPath, taskDigest, taskDefinitionBlob, registrationReceiptBlob };
}

export async function verifyObservedPairRegistration(root, task, result) {
  const registration = await verifyObservedRegistration(root, task, { runStartedAt: result?.runStartedAt });
  const errors = [...registration.errors];
  if (result?.taskDefinitionCommit !== task?.taskDefinitionCommit) errors.push("result.taskDefinitionCommit must match the registered task binding");
  if (result?.taskDefinition !== task?.taskDefinitionPath) errors.push("result.taskDefinition must match the registered task path");
  if (result?.registrationCommit !== registration.registrationCommit) errors.push("result.registrationCommit must match the Git registration commit observed before the run");
  if (result?.registrationTimestamp !== registration.registrationTimestamp) errors.push("result.registrationTimestamp must match the Git registration timestamp observed before the run");
  if (String(result?.taskDefinitionBlob ?? "").toLowerCase() !== registration.taskDefinitionBlob) errors.push("result.taskDefinitionBlob must match the committed task-definition blob");
  if (String(result?.registrationReceiptBlob ?? "").toLowerCase() !== registration.registrationReceiptBlob) errors.push("result.registrationReceiptBlob must match the committed registration-receipt blob");
  return { ...registration, ok: errors.length === 0, errors };
}
