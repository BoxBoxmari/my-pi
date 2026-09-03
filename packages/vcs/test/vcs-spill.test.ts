import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GitVcsBackend } from "@my-pi/vcs";

let dir: string;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-spill-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  // Commit a large file, then modify it heavily to produce a multi-chunk diff.
  const lines = Array.from({ length: 5000 }, (_, i) => `original line ${i}`).join("\n");
  await fs.writeFile(path.join(dir, "big.txt"), lines);
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
  const modified = Array.from({ length: 5000 }, (_, i) => `CHANGED line ${i}`).join("\n");
  await fs.writeFile(path.join(dir, "big.txt"), modified);
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("G2: vcs_diff truncates inline hunks and spills the full diff to an artifact", async () => {
  const backend = new GitVcsBackend();
  const { LocalArtifactStore } = await import("@my-pi/artifact-store");
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-stream-artifact-"));
  const store = new LocalArtifactStore(artifactDir);
  const res = await backend.diff(
    { path: dir },
    new AbortController().signal,
    {
      beginSpill: (mimeType) => store.createWriter(mimeType),
    },
  );
  // 5000 changed lines => hunks exceed the 500-line inline cap.
  assert.equal(res.truncated, true, "diff over the inline limit must be marked truncated");
  assert.equal(res.hunks.length, 500, "inline hunks must be capped at 500");
  assert.equal(res.summary.additions, 5000);
  assert.equal(res.summary.deletions, 5000);
  // The overflow must be spilled, not dropped.
  assert.ok(res.diffArtifact, "diff over the inline limit must spill to an artifact");
  assert.equal(res.diffArtifact.mimeType, "text/plain");
  assert.ok(res.diffArtifact.sha256.length === 64, "spilled artifact must carry a sha256 digest");
  assert.ok(res.diffArtifact.bytes > 0);
  const spilled = await store.read(res.diffArtifact);
  assert.ok(spilled && new TextDecoder().decode(spilled).includes("CHANGED line 4999"));
  await fs.rm(artifactDir, { recursive: true, force: true });
});

test("G2: vcs_diff under the inline limit does NOT spill", async () => {
  const backend = new GitVcsBackend();
  const res = await backend.diff(
    { path: dir },
    new AbortController().signal,
    {
      beginSpill: async () => {
        throw new Error("spill must not be requested under the inline limit");
      },
      inlineLimit: 12000, // high enough to keep everything inline
    },
  );
  assert.equal(res.truncated, false);
  assert.equal(res.diffArtifact, undefined);
  assert.ok(res.hunks.length > 5000, "full diff stays inline when under the limit");
});

test("vcs_diff cancellation while streaming closes the artifact writer", async () => {
  const backend = new GitVcsBackend();
  const controller = new AbortController();
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-stream-cancel-"));
  const { LocalArtifactStore } = await import("@my-pi/artifact-store");
  const store = new LocalArtifactStore(artifactDir);
  await assert.rejects(
    backend.diff({ path: dir }, controller.signal, {
      beginSpill: async (mimeType) => {
        const writer = await store.createWriter(mimeType);
        controller.abort();
        return writer;
      },
    }),
    (error: unknown) => (error as { code?: string }).code === "ERR_ABORTED",
  );
  assert.equal((await fs.readdir(artifactDir)).length, 0);
  await fs.rm(artifactDir, { recursive: true, force: true });
});
