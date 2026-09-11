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
const RELEASE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

async function copyFixture(tmpDir) {
  await fs.cp(path.join(ROOT, "release"), path.join(tmpDir, "release"), { recursive: true });
  await fs.cp(path.join(ROOT, "evidence"), path.join(tmpDir, "evidence"), { recursive: true });
  await fs.copyFile(path.join(ROOT, "package.json"), path.join(tmpDir, "package.json"));
  await fs.copyFile(path.join(ROOT, "server.json"), path.join(tmpDir, "server.json"));

  await fs.mkdir(path.join(tmpDir, "apps", "my-pi-mcp"), { recursive: true });
  await fs.copyFile(
    path.join(ROOT, "apps", "my-pi-mcp", "package.json"),
    path.join(tmpDir, "apps", "my-pi-mcp", "package.json"),
  );

  await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
  for (const file of ["verify-release.mjs", "release-identity.mjs", "bind-release-evidence.mjs"]) {
    await fs.copyFile(path.join(ROOT, "scripts", file), path.join(tmpDir, "scripts", file));
  }
}

function testEnv() {
  return { ...process.env, RELEASE_COMMIT };
}

async function bindEvidence(tmpDir) {
  await execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "bind-release-evidence.mjs")], {
    cwd: tmpDir,
    env: testEnv(),
  });
}

test("server.json: declares an installable local workspace contract", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "server.json"), "utf8"));
  const appPkg = JSON.parse(await fs.readFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), "utf8"));
  const registryPackage = manifest.packages?.find(
    (pkg) => pkg?.registryType === "npm" && pkg?.identifier === appPkg.name,
  );

  assert.ok(registryPackage, "server.json must expose the public npm package");
  assert.equal(registryPackage.runtimeHint, "npx", "npm registry clients should receive an npx runtime hint");
  assert.equal(registryPackage.transport?.type, "stdio");

  const workspaceArg = registryPackage.packageArguments?.find(
    (arg) => arg?.type === "named" && arg?.name === "--workspace",
  );
  assert.ok(workspaceArg, "Registry execution must declare the required --workspace argument");
  assert.equal(workspaceArg.isRequired, true, "workspace input must be required because the CLI fails closed without it");
  assert.equal(workspaceArg.format, "filepath", "workspace input must be presented as a filesystem path");
});

test("verify-release: accepts a synchronized MCP Registry manifest", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-registry-sync-"));
  try {
    await copyFixture(tmpDir);
    await bindEvidence(tmpDir);

    const { stdout } = await execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], {
      cwd: tmpDir,
      env: testEnv(),
    });

    assert.match(stdout, /MCP Registry manifest version matches policy/);
    assert.match(stdout, /MCP Registry npm package version matches policy/);
    assert.match(stdout, /ADMISSION ADMITTED/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: rejects stale server.json versions", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-registry-stale-"));
  try {
    await copyFixture(tmpDir);
    await bindEvidence(tmpDir);

    const manifestPath = path.join(tmpDir, "server.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.version = "0.0.0-stale";
    manifest.packages[0].version = "0.0.0-stale";
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], {
        cwd: tmpDir,
        env: testEnv(),
      }),
      (err) => {
        assert.equal(err.code, 1);
        const output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
        assert.match(output, /MCP Registry manifest version .* does not match policy version/);
        assert.match(output, /MCP Registry npm package version .* does not match policy version/);
        assert.match(output, /ADMISSION WITHHELD/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-release: rejects an npm mcpName that diverges from server.json", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-registry-name-"));
  try {
    await copyFixture(tmpDir);
    await bindEvidence(tmpDir);

    const appPath = path.join(tmpDir, "apps", "my-pi-mcp", "package.json");
    const appPkg = JSON.parse(await fs.readFile(appPath, "utf8"));
    appPkg.mcpName = "io.github.BoxBoxmari/not-my-pi";
    await fs.writeFile(appPath, `${JSON.stringify(appPkg, null, 2)}\n`, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [path.join(tmpDir, "scripts", "verify-release.mjs")], {
        cwd: tmpDir,
        env: testEnv(),
      }),
      (err) => {
        assert.equal(err.code, 1);
        const output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
        assert.match(output, /MCP Registry name .* does not match npm mcpName/);
        assert.match(output, /ADMISSION WITHHELD/);
        return true;
      },
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
