import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

test("admission seal CLI honors dashed key options and signs with the loaded private key", async () => {
  const root = process.cwd();
  const fixture = await mkdtemp(path.join(os.tmpdir(), "my-pi-admission-cli-"));
  const keyPath = path.join(os.tmpdir(), "my-pi-admission-cli-" + process.pid + "-" + Date.now() + ".pem");
  try {
    await mkdir(path.join(fixture, "src"), { recursive: true });
    git(fixture, ["init", "-b", "main"]);
    git(fixture, ["config", "user.email", "my-pi-test@example.invalid"]);
    git(fixture, ["config", "user.name", "my-pi test"]);
    await writeFile(path.join(fixture, "src", "feature.txt"), "base\n", "utf8");
    git(fixture, ["add", "src/feature.txt"]);
    git(fixture, ["commit", "-m", "base"]);
    const base = git(fixture, ["rev-parse", "HEAD"]);
    await writeFile(path.join(fixture, "src", "feature.txt"), "candidate\n", "utf8");
    git(fixture, ["add", "src/feature.txt"]);
    git(fixture, ["commit", "-m", "candidate"]);
    const head = git(fixture, ["rev-parse", "HEAD"]);

    const coveragePath = path.join(fixture, "coverage.json");
    await writeFile(
      coveragePath,
      JSON.stringify([{ path: "src/feature.txt", receiptDigest: "sha256:" + "1".repeat(64) }]),
      "utf8",
    );
    const output = execFileSync(
      process.execPath,
      [
        path.join(root, "scripts", "seal-my-pi-admission.mjs"),
        "--root", fixture,
        "--base", base,
        "--head", head,
        "--coverage", coveragePath,
        "--key-id", "cli-regression",
        "--key-path", keyPath,
      ],
      { cwd: root, encoding: "utf8" },
    );
    const sealed = JSON.parse(output);
    assert.equal(sealed.status, "SEALED");
    assert.equal(path.resolve(sealed.privateKeyPath), path.resolve(keyPath));
    const authority = JSON.parse(await readFile(path.join(fixture, ".my-pi", "provenance", "authority.json"), "utf8"));
    assert.equal(authority.keyId, "cli-regression");
  } finally {
    await rm(fixture, { recursive: true, force: true });
    await rm(keyPath, { force: true });
  }
});
