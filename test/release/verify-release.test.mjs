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