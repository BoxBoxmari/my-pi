/**
 * Performance gate: stdio MCP overhead benchmark.
 *
 * Measures D (MCP stdio -> capability) against C (direct capability call)
 * on the same workspace fixture. Protocol per Plan §27:
 *   - warm up before steady-state
 *   - >=100 measured iterations
 *   - report median / p95 / p99
 *   - report RSS delta
 *
 * Usage: node benchmarks/stdio-overhead.mjs [iterations]
 * Writes: benchmarks/results/stdio-overhead.json
 */
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolveReleaseCommit } from "../scripts/release-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ITER = Number(process.argv[2] ?? 150);
const WARMUP = 25;
const execFileAsync = promisify(execFile);

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

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    medianMs: +pct(50).toFixed(3),
    p95Ms: +pct(95).toFixed(3),
    p99Ms: +pct(99).toFixed(3),
    minMs: +s[0].toFixed(3),
    maxMs: +s[s.length - 1].toFixed(3),
    samples: s.length,
  };
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-bench-"));
  await fs.writeFile(path.join(dir, "bench.txt"), "needle here\nplain line\nneedle again\n");

  // ---- Direct capability (Layer C) ----
  const { WorkspaceRuntime } = await import(pathToFileURL(path.join(repoRoot, "packages", "workspace-runtime", "dist", "index.js")).href);
  const { createFsCapabilities } = await import(pathToFileURL(path.join(repoRoot, "packages", "fs", "dist", "index.js")).href);
  const rt = new WorkspaceRuntime();
  await rt.open({ root: dir });
  const caps = createFsCapabilities(rt);
  const readCap = caps.get("fs_read");

  const directTimes = [];
  for (let i = 0; i < WARMUP; i++) {
    await readCap.execute({ path: "bench.txt" }, { requestId: "w" , workspace: rt.workspaceOrThrow, signal: new AbortController().signal });
  }
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    await readCap.execute({ path: "bench.txt" }, { requestId: `${i}`, workspace: rt.workspaceOrThrow, signal: new AbortController().signal });
    directTimes.push(performance.now() - t0);
  }

  // ---- MCP stdio (Layer D) ----
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/my-pi-mcp/dist/main.js", "--workspace", dir],
    cwd: repoRoot,
  });
  const client = new Client({ name: "bench", version: "0.0.1" });
  await client.connect(transport);

  const mcpTimes = [];
  for (let i = 0; i < WARMUP; i++) {
    await client.callTool({ name: "fs_read", arguments: { path: "bench.txt" } });
  }
  const serverPid = transport.pid;
  const serverRssSamples = [];
  const sampleEvery = Math.max(1, Math.floor(ITER / 10));
  const parentRssBefore = process.memoryUsage.rss();
  const beforeServerRss = await processRssBytes(serverPid);
  if (beforeServerRss !== undefined) serverRssSamples.push(beforeServerRss);
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    await client.callTool({ name: "fs_read", arguments: { path: "bench.txt" } });
    mcpTimes.push(performance.now() - t0);
    if ((i + 1) % sampleEvery === 0 || i === ITER - 1) {
      const rss = await processRssBytes(serverPid);
      if (rss !== undefined) serverRssSamples.push(rss);
    }
  }
  const afterServerRss = await processRssBytes(serverPid);
  if (afterServerRss !== undefined && serverRssSamples[serverRssSamples.length - 1] !== afterServerRss) serverRssSamples.push(afterServerRss);
  const parentRssAfter = process.memoryUsage.rss();

  const result = {
    generatedAt: new Date().toISOString(),
    commit: resolveReleaseCommit({ cwd: repoRoot }),
    node: process.version,
    platform: process.platform,
    iterations: ITER,
    warmup: WARMUP,
    directCapabilityC: stats(directTimes),
    mcpStdioD: stats(mcpTimes),
    serverPid,
    serverRssMeasurement: "child-working-set-sampled",
    serverRssBeforeBytes: beforeServerRss,
    serverRssAfterBytes: afterServerRss,
    serverRssPeakBytes: serverRssSamples.length > 0 ? Math.max(...serverRssSamples) : undefined,
    serverRssSamples: serverRssSamples.length,
    parentRssDeltaBytes: parentRssAfter - parentRssBefore,
    targets: { stdioP50MaxMs: 5, stdioP95MaxMs: 15 },
  };
  // Overhead = D - C (approximation of pure MCP/transport cost).
  result.mcpOverheadP50Ms = +(result.mcpStdioD.medianMs - result.directCapabilityC.medianMs).toFixed(3);
  result.mcpOverheadP95Ms = +(result.mcpStdioD.p95Ms - result.directCapabilityC.medianMs).toFixed(3);

  const outDir = path.join(repoRoot, "benchmarks", "results");
  await fs.mkdir(outDir, { recursive: true });
  const out = path.join(outDir, "stdio-overhead.json");
  await fs.writeFile(out, JSON.stringify(result, null, 2), "utf8");

  console.log(`direct capability (C): median=${result.directCapabilityC.medianMs}ms p95=${result.directCapabilityC.p95Ms}ms`);
  console.log(`MCP stdio (D):        median=${result.mcpStdioD.medianMs}ms p95=${result.mcpStdioD.p95Ms}ms p99=${result.mcpStdioD.p99Ms}ms`);
  console.log(`overhead (D-C):       p50≈${result.mcpOverheadP50Ms}ms`);
  console.log(`Server RSS samples:   pid=${result.serverPid} before=${result.serverRssBeforeBytes ?? "unavailable"} after=${result.serverRssAfterBytes ?? "unavailable"} peak=${result.serverRssPeakBytes ?? "unavailable"} bytes`);
  console.log(`written: ${out}`);

  await client.close();
  await fs.rm(dir, { recursive: true, force: true });
}

await main();
