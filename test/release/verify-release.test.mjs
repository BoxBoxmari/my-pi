import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "verify-release.mjs");

test("verify-release: baseline passes with clean exit code 0", async () => {
  const { stdout } = await execFileAsync(process.execPath, [SCRIPT], { cwd: ROOT });
  assert.match(stdout, /ADMISSION ADMITTED/);
  assert.match(stdout, /"status": "PASS"/);
});

test("verify-release: fails closed when a required criterion is BLOCKED", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test-"));
  try {
    // Copy necessary files
    await fs.cp(path.join(ROOT, "release"), path.join(tmpDir, "release"), { recursive: true });
    await fs.cp(path.join(ROOT, "evidence"), path.join(tmpDir, "evidence"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "package.json"), path.join(tmpDir, "package.json"));
    await fs.mkdir(path.join(tmpDir, "apps", "my-pi-mcp"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), path.join(tmpDir, "apps", "my-pi-mcp", "package.json"));
    await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
    await fs.copyFile(SCRIPT, path.join(tmpDir, "scripts", "verify-release.mjs"));

    // Corrupt one required criterion in G1.json
    const g1Path = path.join(tmpDir, "evidence", "G1.json");
    const g1 = JSON.parse(await fs.readFile(g1Path, "utf8"));
    g1.criteria[0].status = "BLOCKED";
    await fs.writeFile(g1Path, JSON.stringify(g1, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir }),
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
    await fs.cp(path.join(ROOT, "release"), path.join(tmpDir, "release"), { recursive: true });
    await fs.cp(path.join(ROOT, "evidence"), path.join(tmpDir, "evidence"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "package.json"), path.join(tmpDir, "package.json"));
    await fs.mkdir(path.join(tmpDir, "apps", "my-pi-mcp"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), path.join(tmpDir, "apps", "my-pi-mcp", "package.json"));
    await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
    await fs.copyFile(SCRIPT, path.join(tmpDir, "scripts", "verify-release.mjs"));

    // Remove one required criterion from G4.json
    const g4Path = path.join(tmpDir, "evidence", "G4.json");
    const g4 = JSON.parse(await fs.readFile(g4Path, "utf8"));
    g4.criteria = g4.criteria.filter(c => c.id !== "ast-search");
    await fs.writeFile(g4Path, JSON.stringify(g4, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir }),
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
    await fs.cp(path.join(ROOT, "release"), path.join(tmpDir, "release"), { recursive: true });
    await fs.cp(path.join(ROOT, "evidence"), path.join(tmpDir, "evidence"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "package.json"), path.join(tmpDir, "package.json"));
    await fs.mkdir(path.join(tmpDir, "apps", "my-pi-mcp"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), path.join(tmpDir, "apps", "my-pi-mcp", "package.json"));
    await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
    await fs.copyFile(SCRIPT, path.join(tmpDir, "scripts", "verify-release.mjs"));

    // Corrupt app package version
    const appPkgPath = path.join(tmpDir, "apps", "my-pi-mcp", "package.json");
    const appPkg = JSON.parse(await fs.readFile(appPkgPath, "utf8"));
    appPkg.version = "0.2.0-beta.0";
    await fs.writeFile(appPkgPath, JSON.stringify(appPkg, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir }),
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
    await fs.cp(path.join(ROOT, "release"), path.join(tmpDir, "release"), { recursive: true });
    await fs.cp(path.join(ROOT, "evidence"), path.join(tmpDir, "evidence"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "package.json"), path.join(tmpDir, "package.json"));
    await fs.mkdir(path.join(tmpDir, "apps", "my-pi-mcp"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), path.join(tmpDir, "apps", "my-pi-mcp", "package.json"));
    await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
    await fs.copyFile(SCRIPT, path.join(tmpDir, "scripts", "verify-release.mjs"));

    // Add duplicate criterion to release-policy.json
    const policyPath = path.join(tmpDir, "release", "release-policy.json");
    const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
    policy.requiredCriteria.push(policy.requiredCriteria[0]);
    await fs.writeFile(policyPath, JSON.stringify(policy, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir }),
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

test("verify-release: fails closed on missing commit identifier in evidence", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test5-"));
  try {
    await fs.cp(path.join(ROOT, "release"), path.join(tmpDir, "release"), { recursive: true });
    await fs.cp(path.join(ROOT, "evidence"), path.join(tmpDir, "evidence"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "package.json"), path.join(tmpDir, "package.json"));
    await fs.mkdir(path.join(tmpDir, "apps", "my-pi-mcp"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), path.join(tmpDir, "apps", "my-pi-mcp", "package.json"));
    await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
    await fs.copyFile(SCRIPT, path.join(tmpDir, "scripts", "verify-release.mjs"));

    // Remove commit from G1.json
    const g1Path = path.join(tmpDir, "evidence", "G1.json");
    const g1 = JSON.parse(await fs.readFile(g1Path, "utf8"));
    delete g1.commit;
    await fs.writeFile(g1Path, JSON.stringify(g1, null, 2), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir }),
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

test("verify-release: fails closed on benchmark observed count below target", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-rel-test6-"));
  try {
    await fs.cp(path.join(ROOT, "release"), path.join(tmpDir, "release"), { recursive: true });
    await fs.cp(path.join(ROOT, "evidence"), path.join(tmpDir, "evidence"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "package.json"), path.join(tmpDir, "package.json"));
    await fs.mkdir(path.join(tmpDir, "apps", "my-pi-mcp"), { recursive: true });
    await fs.copyFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), path.join(tmpDir, "apps", "my-pi-mcp", "package.json"));
    await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
    await fs.copyFile(SCRIPT, path.join(tmpDir, "scripts", "verify-release.mjs"));
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
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], { cwd: tmpDir }),
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