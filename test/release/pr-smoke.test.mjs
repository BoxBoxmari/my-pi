import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
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

function resolveWindowsCommand(command) {
  if (process.platform !== "win32") return command;
  const base = command.replace(/\.(cmd|bat|exe)$/i, "");
  const candidates = [];
  if (process.env.PNPM_HOME) {
    candidates.push(path.join(process.env.PNPM_HOME, command));
    candidates.push(path.join(process.env.PNPM_HOME, `${base}.exe`));
    candidates.push(path.join(process.env.PNPM_HOME, `${base}.cmd`));
  }
  candidates.push(path.join(path.dirname(process.execPath), command));
  candidates.push(path.join(path.dirname(process.execPath), `${base}.exe`));
  candidates.push(path.join(path.dirname(process.execPath), `${base}.cmd`));
  const candidate = candidates.find((cand) => existsSync(cand));
  if (candidate) return candidate;
  try {
    const out = execFileSync("where.exe", [command, `${base}.exe`, `${base}.cmd`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const firstLine = out.trim().split(/\r?\n/).find(Boolean);
    if (firstLine && existsSync(firstLine.trim())) return firstLine.trim();
  } catch {}
  return command;
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (/[&|<>^()%!`"\r\n]/.test(text)) throw new Error("unsafe Windows command argument");
  if (text.length === 0) return "\"\"";
  return /\s/.test(text) ? `"${text}"` : text;
}

function execPackageManager(command, args, options) {
  const executable = resolveWindowsCommand(command);
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    const commandLine = `call ${quoteWindowsArg(executable)}${args.length > 0 ? ` ${args.map(quoteWindowsArg).join(" ")}` : ""}`;
    return execFileAsync(process.env.ComSpec ?? process.env.comspec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], {
      ...options,
      shell: false,
      windowsVerbatimArguments: true,
    });
  }
  return execFileAsync(executable, args, { ...options, shell: false });
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
