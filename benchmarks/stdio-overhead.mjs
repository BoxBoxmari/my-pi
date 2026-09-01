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
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ITER = Number(process.argv[2] ?? 150);
const WARMUP = 25;

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-bench-"));
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
    args: ["--experimental-strip-types", "apps/ccr-mcp/dist/main.js", "--workspace", dir],
    cwd: repoRoot,
  });
  const client = new Client({ name: "bench", version: "0.0.1" });
  await client.connect(transport);

  const mcpTimes = [];
  for (let i = 0; i < WARMUP; i++) {
    await client.callTool({ name: "fs_read", arguments: { path: "bench.txt" } });
  }
  const rssBefore = process.memoryUsage.rss();
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    await client.callTool({ name: "fs_read", arguments: { path: "bench.txt" } });
    mcpTimes.push(performance.now() - t0);
  }
  const rssAfter = process.memoryUsage.rss();

  const result = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    iterations: ITER,
    warmup: WARMUP,
    directCapabilityC: stats(directTimes),
    mcpStdioD: stats(mcpTimes),
    rssDeltaBytes: rssAfter - rssBefore,
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
  console.log(`RSS delta:            ${result.rssDeltaBytes} bytes over ${ITER} calls`);
  console.log(`written: ${out}`);

  await client.close();
  await fs.rm(dir, { recursive: true, force: true });
}

await main();
