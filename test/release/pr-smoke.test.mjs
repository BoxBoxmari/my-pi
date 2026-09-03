import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "pr-smoke.mjs");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function quoteWindowsArg(value) {
  const text = String(value);
  if (/[&|<>^()%!`"\r\n]/.test(text)) throw new Error("unsafe Windows command argument");
  return `"${text}"`;
}

function execPackageManager(command, args, options) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const quote = String.fromCharCode(34);
    const commandLine = `${quote}${quote}${command}${quote}${args.length > 0 ? ` ${args.map(quoteWindowsArg).join(" ")}` : ""}${quote}`;
    return execFileAsync(process.env.ComSpec ?? process.env.comspec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], {
      ...options,
      shell: false,
      windowsVerbatimArguments: true,
    });
  }
  return execFileAsync(command, args, { ...options, shell: false });
}

async function packCurrentArtifact(destination) {
  await execPackageManager(pnpmCommand, ["--filter", "@koonwang03/my-pi", "pack", "--pack-destination", destination], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
  });
  const tarballs = (await fs.readdir(destination)).filter((file) => file.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  return path.join(destination, tarballs[0]);
}

test("pr-smoke: --artifact tests the supplied TGZ without repacking", { skip: process.env.RELEASE_QUALIFICATION === "true" }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-smoke-artifact-"));
  try {
    const artifact = await packCurrentArtifact(tempDir);
    const result = await execFileAsync(process.execPath, [SCRIPT, "--artifact", artifact], { cwd: ROOT });
    assert.match(result.stdout, /Using supplied release artifact without repacking/);
    assert.doesNotMatch(result.stdout, /Packing @koonwang03\/my-pi into/);
    assert.match(result.stdout, /PR SMOKE TEST: ALL PASSED/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pr-smoke: rejects an artifact with the wrong package identity", { skip: process.env.RELEASE_QUALIFICATION === "true" }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-smoke-identity-"));
  try {
    const sourceDir = path.join(tempDir, "source");
    const outputDir = path.join(tempDir, "output");
    await fs.mkdir(path.join(sourceDir, "dist"), { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "package.json"),
      JSON.stringify({ name: "not-my-pi", version: "0.1.0-alpha.1", files: ["dist"] }, null, 2),
      "utf8",
    );
    await fs.writeFile(path.join(sourceDir, "dist", "main.js"), "#!/usr/bin/env node\n", "utf8");
    await fs.writeFile(path.join(sourceDir, "dist", "main.js.map"), JSON.stringify({ version: 3, sources: ["main.ts"] }), "utf8");
    await fs.writeFile(path.join(sourceDir, "README.md"), "test\n", "utf8");
    await fs.writeFile(path.join(sourceDir, "LICENSE"), "test\n", "utf8");
    await execPackageManager(npmCommand, ["pack", "--pack-destination", outputDir], { cwd: sourceDir, encoding: "utf8" });
    const artifact = path.join(outputDir, (await fs.readdir(outputDir)).find((file) => file.endsWith(".tgz")));

    await assert.rejects(
      execFileAsync(process.execPath, [SCRIPT, "--artifact", artifact], { cwd: ROOT }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr || err.stdout, /artifact package identity/);
        return true;
      },
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
