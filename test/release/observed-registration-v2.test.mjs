import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { verifyObservedRegistration } from "../../scripts/observed-registration-v2.mjs";

const execFileAsync = promisify(execFile);

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
}

function digest(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

async function git(cwd, args) {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return String(result.stdout ?? "").trim();
}

test("Git registration rejects a binding-only task rebind after registration", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "my-pi-registration-"));
  try {
    await git(repo, ["init", "-q"]);
    await git(repo, ["config", "user.email", "codex-test@example.invalid"]);
    await git(repo, ["config", "user.name", "my-pi test"]);
    await writeFile(path.join(repo, "anchor.txt"), "anchor\n", "utf8");
    await git(repo, ["add", "anchor.txt"]);
    await git(repo, ["commit", "-q", "-m", "anchor"]);
    const anchor = await git(repo, ["rev-parse", "HEAD"]);

    const task = {
      schemaVersion: "2",
      recordType: "observed-task-v2",
      taskId: "OT-901",
      taskDefinitionPath: "dogfood/observed-tasks/OT-901.json",
      taskDefinitionCommit: anchor,
      registration: { receiptPath: "dogfood/observed-registrations/OT-901.json" },
      registeredAt: "2026-09-14T00:00:00.000Z",
    };
    const taskPath = path.join(repo, task.taskDefinitionPath);
    const receiptPath = path.join(repo, task.registration.receiptPath);
    await mkdir(path.dirname(taskPath), { recursive: true });
    await mkdir(path.dirname(receiptPath), { recursive: true });
    await writeFile(taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
    await writeFile(receiptPath, JSON.stringify({ schemaVersion: "1", recordType: "observed-task-registration-v1", taskId: task.taskId, taskDefinitionPath: task.taskDefinitionPath, taskDigest: digest(task), registeredAt: task.registeredAt }, null, 2) + "\n", "utf8");
    await git(repo, ["add", task.taskDefinitionPath, task.registration.receiptPath]);
    await git(repo, ["commit", "-q", "-m", "register task"]);

    const valid = await verifyObservedRegistration(repo, task, { runStartedAt: "2999-01-01T00:00:00.000Z" });
    assert.equal(valid.ok, true, valid.errors.join("; "));

    const rebound = { ...task, taskDefinitionCommit: await git(repo, ["rev-parse", "HEAD"]) };
    await writeFile(taskPath, JSON.stringify(rebound, null, 2) + "\n", "utf8");
    const invalid = await verifyObservedRegistration(repo, rebound, { runStartedAt: "2999-01-01T00:00:00.000Z" });
    assert.equal(invalid.ok, false);
    assert.match(invalid.errors.join("\n"), /changed after Git registration/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
