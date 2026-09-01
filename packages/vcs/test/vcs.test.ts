import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GitVcsBackend } from "@ccr/vcs";
import { isCcrError } from "@ccr/contracts";

let dir: string;
let siblingRepo: string; // P0.1: a DIFFERENT git repo, sibling of the workspace

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-vcs-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  await fs.writeFile(path.join(dir, "f.txt"), "one\ntwo\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
  await fs.writeFile(path.join(dir, "f.txt"), "one\nTWO\n");

  siblingRepo = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-vcs-sibling-"));
  execFileSync("git", ["init", "-q"], { cwd: siblingRepo });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: siblingRepo });
  execFileSync("git", ["config", "user.name", "t"], { cwd: siblingRepo });
  await fs.writeFile(path.join(siblingRepo, "SIBLING.txt"), "sibling-only");
  execFileSync("git", ["add", "."], { cwd: siblingRepo });
  execFileSync("git", ["commit", "-qm", "sibling"], { cwd: siblingRepo });
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(siblingRepo, { recursive: true, force: true });
});

test("P0.1: status uses the RESOLVED workspace path, not process cwd", async () => {
  const backend = new GitVcsBackend();
  // Even though process cwd is the my-pi repo (a different repository),
  // passing the resolved workspace dir must report THAT repo.
  const res = await backend.status({ path: dir }, new AbortController().signal);
  assert.equal(res.clean, false);
  assert.ok(res.entries.some((e) => e.path === "f.txt"));
  // The sibling repo's file must NOT leak into this workspace's status.
  assert.ok(!res.entries.some((e) => e.path === "SIBLING.txt"));
});

test("P0.1: status of the sibling repo is isolated the other way", async () => {
  const backend = new GitVcsBackend();
  const res = await backend.status({ path: siblingRepo }, new AbortController().signal);
  assert.equal(res.clean, true); // committed, unmodified
  assert.ok(!res.entries.some((e) => e.path === "f.txt"));
});

test("P0.1: '.' is rejected as an implicit authority root", async () => {
  const backend = new GitVcsBackend();
  await assert.rejects(
    backend.status({ path: "." }, new AbortController().signal),
    (e: unknown) => isCcrError(e) && e.code === "ERR_INVALID_ARGUMENT",
  );
  await assert.rejects(
    backend.status({}, new AbortController().signal),
    (e: unknown) => isCcrError(e) && e.code === "ERR_INVALID_ARGUMENT",
  );
});

test("P0.1: non-Git workspace is a typed error, never fake clean=false/empty", async () => {
  const backend = new GitVcsBackend();
  const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-nongit-"));
  try {
    await assert.rejects(
      backend.status({ path: nonGit }, new AbortController().signal),
      (e: unknown) => isCcrError(e) && e.code === "ERR_UNSUPPORTED_CAPABILITY",
    );
    await assert.rejects(
      backend.diff({ path: nonGit }, new AbortController().signal),
      (e: unknown) => isCcrError(e) && e.code === "ERR_UNSUPPORTED_CAPABILITY",
    );
  } finally {
    await fs.rm(nonGit, { recursive: true, force: true });
  }
});

test("P0.1: diff returns hunks and summary for the resolved repo", async () => {
  const backend = new GitVcsBackend();
  const res = await backend.diff({ path: dir }, new AbortController().signal);
  assert.ok(res.summary.files >= 1);
  assert.ok(res.summary.additions >= 1);
  assert.ok(res.summary.deletions >= 1);
  assert.ok(res.hunks.some((h) => h.includes("TWO")));
  // sibling content must never appear in this workspace's diff
  assert.ok(!res.hunks.some((h) => h.includes("SIBLING")));
});

test("P0.4: cancellation aborts a git subprocess", async () => {
  const backend = new GitVcsBackend();
  const ac = new AbortController();
  ac.abort(); // pre-aborted: must return typed ERR_ABORTED, no zombie
  await assert.rejects(
    backend.status({ path: dir }, ac.signal),
    (e: unknown) => isCcrError(e) && e.code === "ERR_ABORTED",
  );
});
