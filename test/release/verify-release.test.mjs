import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "verify-release.mjs");
const IDENTITY_SCRIPT = path.join(ROOT, "scripts", "release-identity.mjs");
const RELEASE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

async function copyReleaseFixture(tmpDir) {
  await fs.cp(path.join(ROOT, "release"), path.join(tmpDir, "release"), { recursive: true });
  await fs.cp(path.join(ROOT, "evidence"), path.join(tmpDir, "evidence"), { recursive: true });
  await fs.copyFile(path.join(ROOT, "package.json"), path.join(tmpDir, "package.json"));
  await fs.mkdir(path.join(tmpDir, "apps", "my-pi-mcp"), { recursive: true });
  await fs.copyFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), path.join(tmpDir, "apps", "my-pi-mcp", "package.json"));
  await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
  await fs.copyFile(SCRIPT, path.join(tmpDir, "scripts", "verify-release.mjs"));
  await fs.copyFile(IDENTITY_SCRIPT, path.join(tmpDir, "scripts", "release-identity.mjs"));
  await fs.copyFile(path.join(ROOT, "scripts", "bind-release-evidence.mjs"), path.join(tmpDir, "scripts", "bind-release-evidence.mjs"));
}

function testEnv() {
  return { ...process.env, RELEASE_COMMIT };
}

test("verify-release: baseline passes with clean exit code 0", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-baseline-"));
  try {
    await copyReleaseFixture(tmpDir);
    await execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "bind-release-evidence.mjs")], {
      cwd: tmpDir,
      env: testEnv(),
    });
    const { stdout } = await execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], {
      cwd: tmpDir,
      env: testEnv(),
    });
    assert.match(stdout, /ADMISSION ADMITTED/);
    assert.match(stdout, /"status": "PASS"/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed when a required criterion is BLOCKED", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test-"));
  try {
    await copyReleaseFixture(tmpDir);

    // Corrupt one required criterion in G1.json
    const g1Path = path.join(tmpDir, "evidence", "G1.json");
    const g1 = JSON.parse(await fs.readFile(g1Path, "utf8"));
    g1.criteria[0].status = "BLOCKED";
    await fs.writeFile(g1Path, JSON.stringify(g1, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /ADMISSION WITHHELD/);
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed when a required criterion is missing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test2-"));
  try {
    await copyReleaseFixture(tmpDir);

    // Remove one required criterion from G4.json
    const g4Path = path.join(tmpDir, "evidence", "G4.json");
    const g4 = JSON.parse(await fs.readFile(g4Path, "utf8"));
    g4.criteria = g4.criteria.filter(c => c.id !== "ast-search");
    await fs.writeFile(g4Path, JSON.stringify(g4, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /Missing required criterion/);
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed on package version mismatch", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test3-"));
  try {
    await copyReleaseFixture(tmpDir);

    // Corrupt app package version
    const appPkgPath = path.join(tmpDir, "apps", "my-pi-mcp", "package.json");
    const appPkg = JSON.parse(await fs.readFile(appPkgPath, "utf8"));
    appPkg.version = "0.2.0-beta.0";
    await fs.writeFile(appPkgPath, JSON.stringify(appPkg, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /does not match policy version/);
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed on release tag mismatch", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, RELEASE_TAG: "v9.9.9" },
    }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr || err.stdout, /does not match expected release version/);
      return true;
    }
  );
});

test("verify-release: fails closed on duplicate required criteria", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test4-"));
  try {
    await copyReleaseFixture(tmpDir);

    // Add duplicate criterion to release-policy.json
    const policyPath = path.join(tmpDir, "release", "release-policy.json");
    const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
    policy.requiredCriteria.push(policy.requiredCriteria[0]);
    await fs.writeFile(policyPath, JSON.stringify(policy, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /Duplicate required criterion/);
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed when an evidence filename and id disagree", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-duplicate-evidence-"));
  try {
    await copyReleaseFixture(tmpDir);
    const g1 = await fs.readFile(path.join(tmpDir, "evidence", "G1.json"), "utf8");
    await fs.writeFile(path.join(tmpDir, "evidence", "duplicate.json"), g1, "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /unexpected gate id/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed on missing commit identifier in evidence", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test5-"));
  try {
    await copyReleaseFixture(tmpDir);

    // Remove commit from G1.json
    const g1Path = path.join(tmpDir, "evidence", "G1.json");
    const g1 = JSON.parse(await fs.readFile(g1Path, "utf8"));
    delete g1.commit;
    await fs.writeFile(g1Path, JSON.stringify(g1, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /missing commit identifier/);
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed on malformed evidence commit", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-malformed-"));
  try {
    await copyReleaseFixture(tmpDir);
    const g1Path = path.join(tmpDir, "evidence", "G1.json");
    const g1 = JSON.parse(await fs.readFile(g1Path, "utf8"));
    g1.commit = "not-a-commit";
    await fs.writeFile(g1Path, JSON.stringify(g1, null, 2), "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /invalid commit|malformed commit identifier/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed on a valid but stale evidence commit", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-stale-"));
  try {
    await copyReleaseFixture(tmpDir);
    const g1Path = path.join(tmpDir, "evidence", "G1.json");
    const g1 = JSON.parse(await fs.readFile(g1Path, "utf8"));
    g1.commit = "0000000000000000000000000000000000000000";
    await fs.writeFile(g1Path, JSON.stringify(g1, null, 2), "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /is stale/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed on an unrelated abbreviated evidence commit", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-unrelated-"));
  try {
    await copyReleaseFixture(tmpDir);
    const g1Path = path.join(tmpDir, "evidence", "G1.json");
    const g1 = JSON.parse(await fs.readFile(g1Path, "utf8"));
    g1.commit = "deadbee";
    await fs.writeFile(g1Path, JSON.stringify(g1, null, 2), "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /invalid commit|unable to resolve/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: fails closed on benchmark observed count below target", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test6-"));
  try {
    await copyReleaseFixture(tmpDir);
    await fs.mkdir(path.join(tmpDir, "benchmarks", "results"), { recursive: true });

    // Create invalid benchmark result where observed < target
    const benchData = {
      profile: "smoke",
      targetFileCount: 5000,
      observedFileCount: 42,
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(tmpDir, "benchmarks", "results", "traversal-smoke.json"),
      JSON.stringify(benchData, null, 2),
      "utf8"
    );

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /observed file count.*< target count/);
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: strict mode requires candidate-bound release benchmark evidence", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-release-benchmark-missing-"));
  try {
    await copyReleaseFixture(tmpDir);
    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs"), "--strict"], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /Missing required release benchmark evidence/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: strict mode requires spawned-server runtime performance evidence", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-runtime-evidence-missing-"));
  try {
    await copyReleaseFixture(tmpDir);
    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs"), "--strict"], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /Missing required runtime performance evidence/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: strict mode rejects an undersized release benchmark", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-release-benchmark-small-"));
  try {
    await copyReleaseFixture(tmpDir);
    const resultDir = path.join(tmpDir, "benchmarks", "results");
    await fs.mkdir(resultDir, { recursive: true });
    await fs.writeFile(
      path.join(resultDir, "traversal-release.json"),
      JSON.stringify({
        profile: "release",
        releaseVersion: "0.1.0-alpha.1",
        commit: RELEASE_COMMIT,
        targetFileCount: 100000,
        observedFileCount: 5000,
        platform: "win32",
        nodeVersion: "v24.0.0",
        timestamp: new Date().toISOString(),
      }, null, 2),
      "utf8",
    );
    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs"), "--strict"], { cwd: tmpDir, env: testEnv() }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /observed file count.*required minimum/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
