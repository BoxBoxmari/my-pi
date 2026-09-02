import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { getReleaseIdentity, normalizeCommit } from "../../scripts/release-identity.mjs";

const ROOT_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

test("release identity: explicit RELEASE_COMMIT has priority", () => {
  const explicit = "1111111111111111111111111111111111111111";
  const github = "2222222222222222222222222222222222222222";
  assert.deepEqual(
    getReleaseIdentity({ env: { RELEASE_COMMIT: explicit, GITHUB_SHA: github }, cwd: process.cwd() }),
    { commit: explicit, source: "RELEASE_COMMIT" },
  );
});

test("release identity: GITHUB_SHA is used when RELEASE_COMMIT is absent", () => {
  assert.deepEqual(
    getReleaseIdentity({ env: { GITHUB_SHA: ROOT_COMMIT }, cwd: process.cwd() }),
    { commit: ROOT_COMMIT, source: "GITHUB_SHA" },
  );
});

test("release identity: short commits resolve to full SHAs", () => {
  assert.equal(normalizeCommit(ROOT_COMMIT.slice(0, 7), { cwd: process.cwd() }), ROOT_COMMIT);
});

test("release identity: malformed commits fail closed", () => {
  assert.throws(() => normalizeCommit("not-a-sha", { cwd: process.cwd() }), /malformed commit identifier/);
});
