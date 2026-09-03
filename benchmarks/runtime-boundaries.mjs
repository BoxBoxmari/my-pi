#!/usr/bin/env node
/**
 * Candidate-bound runtime boundary measurements.
 *
 * Unlike the historical benchmark, RSS is sampled from the spawned MCP server
 * process using its transport PID. This is evidence, not a universal gate:
 * runner variance and platform-specific RSS semantics are recorded explicitly.
 */
import { promises as fs } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolveReleaseCommit } from "../scripts/release-identity.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function processRssBytes(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`,
      ], { encoding: "utf8", windowsHide: true });
      const value = Number(stdout.trim());
      return Number.isFinite(value) && value > 0 ? value : undefined;
    }
    if (process.platform === "linux") {
      const status = await fs.readFile(`/proc/${pid}/status`, "utf8");
      const kb = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
      return Number.isFinite(kb) && kb > 0 ? kb * 1024 : undefined;
    }
    const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
    const kb = Number(stdout.trim());
    return Number.isFinite(kb) && kb > 0 ? kb * 1024 : undefined;
  } catch {
    return undefined;
  }
}

async function timed(label, fn) {
  const started = performance.now();
  const value = await fn();
  return { label, durationMs: +(performance.now() - started).toFixed(3), value };
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-runtime-boundaries-"));
  let client;
  try {
    const appPackage = JSON.parse(await fs.readFile(path.join(repoRoot, "apps", "my-pi-mcp", "package.json"), "utf8"));
    await fs.writeFile(path.join(dir, "large.txt"), `${"0123456789abcdef".repeat(512 * 1024)}\n`, "utf8");
    await fs.mkdir(path.join(dir, "scan"));
    await Promise.all(Array.from({ length: 1000 }, (_, i) => fs.writeFile(path.join(dir, "scan", `file-${i}.txt`), `line ${i}\n`, "utf8")));

    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "benchmark@example.invalid"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "benchmark"], { cwd: dir });
    await fs.writeFile(path.join(dir, "diff.txt"), Array.from({ length: 1200 }, (_, i) => `before ${i}`).join("\n"), "utf8");
    execFileSync("git", ["-c", "core.autocrlf=false", "add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "benchmark"], { cwd: dir });
    await fs.writeFile(path.join(dir, "diff.txt"), Array.from({ length: 1200 }, (_, i) => `after ${i}`).join("\n"), "utf8");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "apps", "my-pi-mcp", "dist", "main.js"), "--workspace", dir],
      cwd: repoRoot,
      stderr: "inherit",
      maxBufferSize: 16 * 1024 * 1024,
    });
    client = new Client({ name: "runtime-boundaries", version: "1.0.0" });
    await client.connect(transport);
    const pid = transport.pid;
    const rssSamples = [];
    const sample = async () => {
      const rss = await processRssBytes(pid);
      if (rss !== undefined) rssSamples.push(rss);
    };
    await sample();

    const largeRead = await timed("large_fs_read", () => client.callTool({
      name: "fs_read",
      arguments: { path: "large.txt", offset: 0, max_bytes: 1024 },
    }));
    await sample();

    const largeDiff = await timed("large_vcs_diff", () => client.callTool({
      name: "vcs_diff",
      arguments: {},
    }));
    await sample();

    const controller = new AbortController();
    const cancellation = await timed("cancellation_under_load", async () => {
      const pending = client.callTool({
        name: "search",
        arguments: { mode: "grep", pattern: "never-match-this-marker" },
      }, { signal: controller.signal, timeout: 30_000 });
      setImmediate(() => controller.abort());
      try {
        await pending;
        return "completed";
      } catch (error) {
        return error?.name === "AbortError" || /abort/i.test(error?.message ?? "") ? "aborted" : `error:${error?.message}`;
      }
    });
    await sample();

    const readData = JSON.parse(largeRead.value.content[0].text).data;
    const diffData = JSON.parse(largeDiff.value.content[0].text).data;
    const result = {
      generatedAt: new Date().toISOString(),
      commit: resolveReleaseCommit({ cwd: repoRoot }),
      releaseVersion: appPackage.version,
      node: process.version,
      platform: process.platform,
      measurementProcess: "spawned MCP server",
      serverPid: pid,
      serverRssBeforeBytes: rssSamples[0],
      serverRssPeakBytes: rssSamples.length > 0 ? Math.max(...rssSamples) : undefined,
      serverRssSamples: rssSamples.length,
      largeFsRead: { durationMs: largeRead.durationMs, contentBytes: readData.content_bytes, maxBytes: readData.max_bytes },
      largeVcsDiff: { durationMs: largeDiff.durationMs, truncated: diffData.truncated, hasArtifact: Boolean(diffData.diffArtifact) },
      cancellation: { durationMs: cancellation.durationMs, outcome: cancellation.value },
    };
    const outDir = path.join(repoRoot, "benchmarks", "results");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "runtime-boundaries.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client?.close().catch(() => undefined);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Runtime boundary benchmark failed:", error);
  process.exitCode = 1;
});
