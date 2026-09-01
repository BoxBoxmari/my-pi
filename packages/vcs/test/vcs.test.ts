import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GitVcsBackend } from "@ccr/vcs";

let dir: string;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-vcs-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  await fs.writeFile(path.join(dir, "f.txt"), "one\ntwo\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
  await fs.writeFile(path.join(dir, "f.txt"), "one\nTWO\n");
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("GitVcsBackend.status reports a modified file", async () => {
  const backend = new GitVcsBackend();
  const res = await backend.status({ path: dir }, new AbortController().signal);
  assert.equal(res.clean, false);
  assert.ok(res.entries.some((e) => e.path === "f.txt"));
});

test("GitVcsBackend.diff returns hunks and summary", async () => {
  const backend = new GitVcsBackend();
  const res = await backend.diff({ path: dir }, new AbortController().signal);
  assert.ok(res.summary.files >= 1);
  assert.ok(res.summary.additions >= 1);
  assert.ok(res.summary.deletions >= 1);
  assert.ok(res.hunks.some((h) => h.includes("TWO")));
});
