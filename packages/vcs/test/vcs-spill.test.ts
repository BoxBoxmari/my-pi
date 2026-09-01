import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GitVcsBackend } from "@ccr/vcs";
import { isCcrError, type ArtifactRef } from "@ccr/contracts";

let dir: string;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-spill-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  // Commit a large file, then modify it heavily to produce a diff > 500 lines.
  const lines = Array.from({ length: 900 }, (_, i) => `original line ${i}`).join("\n");
  await fs.writeFile(path.join(dir, "big.txt"), lines);
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
  const modified = Array.from({ length: 900 }, (_, i) => `CHANGED line ${i}`).join("\n");
  await fs.writeFile(path.join(dir, "big.txt"), modified);
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("G2: vcs_diff truncates inline hunks and spills the full diff to an artifact", async () => {
  const backend = new GitVcsBackend();
  const artifacts: ArtifactRef[] = [];
  const res = await backend.diff(
    { path: dir },
    new AbortController().signal,
    {
      spillTo: async (data: string) => {
        const { LocalArtifactStore } = await import("@ccr/artifact-store");
        const store = new LocalArtifactStore(await import("node:os").then((m) => m.tmpdir()));
        const ref = await store.put("text/plain", new TextEncoder().encode(data));
        artifacts.push(ref);
        return ref;
      },
    },
  );
  // 900 changed lines => hunks exceed the 500-line inline cap.
  assert.equal(res.truncated, true, "diff over the inline limit must be marked truncated");
  assert.equal(res.hunks.length, 500, "inline hunks must be capped at 500");
  assert.equal(res.summary.additions, 900);
  assert.equal(res.summary.deletions, 900);
  // The overflow must be spilled, not dropped.
  assert.ok(res.diffArtifact, "diff over the inline limit must spill to an artifact");
  assert.equal(res.diffArtifact.mimeType, "text/plain");
  assert.ok(res.diffArtifact.sha256.length === 64, "spilled artifact must carry a sha256 digest");
  assert.ok(res.diffArtifact.bytes > 0);
  assert.ok(artifacts.length === 1);
});

test("G2: vcs_diff under the inline limit does NOT spill", async () => {
  const backend = new GitVcsBackend();
  const res = await backend.diff(
    { path: dir },
    new AbortController().signal,
    {
      spillTo: async (data: string) => {
        const { LocalArtifactStore } = await import("@ccr/artifact-store");
        const store = new LocalArtifactStore(await import("node:os").then((m) => m.tmpdir()));
        return store.put("text/plain", new TextEncoder().encode(data));
      },
      inlineLimit: 5000, // high enough to keep everything inline
    },
  );
  assert.equal(res.truncated, false);
  assert.equal(res.diffArtifact, undefined);
  assert.ok(res.hunks.length > 900, "full diff stays inline when under the limit");
});
