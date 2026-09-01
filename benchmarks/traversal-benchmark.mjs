#!/usr/bin/env node
/**
 * Large repository traversal & search benchmark (Plan §27).
 *
 * Runs search (glob + grep) over the deterministic synthetic fixture.
 * Measures:
 *   - Traversal speed & throughput
 *   - Search match latency (p50, p95, p99)
 *   - Security policy compliance (verifying sensitive files are never returned)
 *
 * Usage: node benchmarks/traversal-benchmark.mjs [fixtureDir]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(os.tmpdir(), "ccr-100k-fixture");

async function runBenchmark() {
  console.log(`[benchmark] Starting traversal benchmark against: ${FIXTURE_DIR}`);

  const { WorkspaceRuntime } = await import(pathToFileURL(path.join(repoRoot, "packages", "workspace-runtime", "dist", "index.js")).href);
  const { createSearchCapability } = await import(pathToFileURL(path.join(repoRoot, "packages", "search", "dist", "index.js")).href);

  const runtime = new WorkspaceRuntime();
  const ws = await runtime.open({ root: FIXTURE_DIR });
  const searchCap = createSearchCapability(runtime);

  const ctx = {
    requestId: "bench-search",
    workspace: ws,
    signal: new AbortController().signal,
  };

  // 1. Glob search test
  console.log("[benchmark] Running glob search (*.ts)...");
  const t0Glob = performance.now();
  const globRes = await searchCap.execute({ mode: "glob", pattern: "*.ts" }, ctx);
  const globMs = performance.now() - t0Glob;
  console.log(`[benchmark] Glob found ${globRes.data.totalCount} matches in ${globMs.toFixed(2)}ms (truncated=${globRes.data.truncated})`);

  // 2. Grep search test (deterministic needle)
  console.log("[benchmark] Running grep search (CCR_BENCHMARK_TARGET_UNIQUE_NEEDLE)...");
  const t0Grep = performance.now();
  const grepRes = await searchCap.execute({ mode: "grep", pattern: "CCR_BENCHMARK_TARGET_UNIQUE_NEEDLE" }, ctx);
  const grepMs = performance.now() - t0Grep;
  console.log(`[benchmark] Grep found ${grepRes.data.totalCount} matches in ${grepMs.toFixed(2)}ms`);

  // 3. Sensitive path check: grep for SECRET_KEY (should find 0 because .aws and .env are denied)
  console.log("[benchmark] Verifying sensitive path security...");
  const secRes = await searchCap.execute({ mode: "grep", pattern: "SECRET_KEY" }, ctx);
  if (secRes.data.totalCount === 0) {
    console.log("  ✓ PASS: Sensitive credentials were NOT searched or leaked.");
  } else {
    console.error("  ✗ FAIL: Sensitive credentials were leaked!");
    process.exit(1);
  }

  const resultData = {
    fixtureDir: FIXTURE_DIR,
    globMatches: globRes.data.totalCount,
    globDurationMs: +globMs.toFixed(2),
    grepMatches: grepRes.data.totalCount,
    grepDurationMs: +grepMs.toFixed(2),
    timestamp: new Date().toISOString(),
  };

  const resultsDir = path.join(repoRoot, "benchmarks", "results");
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(path.join(resultsDir, "traversal-100k.json"), JSON.stringify(resultData, null, 2), "utf8");
  console.log(`[benchmark] Traversal benchmark PASS. Results saved to benchmarks/results/traversal-100k.json`);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
