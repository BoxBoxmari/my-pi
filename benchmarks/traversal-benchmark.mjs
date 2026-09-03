#!/usr/bin/env node
/**
 * Large repository traversal & search benchmark (Plan §27, Workstream B).
 *
 * Runs search (glob + grep) over the deterministic synthetic fixture.
 * Supports:
 *   --profile smoke   (5,000 files - PR / CI smoke profile)
 *   --profile release (100,000 files - Full release qualification profile)
 *
 * Usage:
 *   node benchmarks/traversal-benchmark.mjs [--profile smoke|release] [fixtureDir]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveReleaseCommit } from "../scripts/release-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Parse arguments
const args = process.argv.slice(2);
let profile = "smoke";
let customDir = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--profile" && args[i + 1]) {
    profile = args[i + 1];
    i++;
  } else if (!args[i].startsWith("--")) {
    customDir = args[i];
  }
}

const targetCount = profile === "release" ? 100000 : 5000;
if (profile !== "smoke" && profile !== "release") {
  throw new Error(`Unsupported benchmark profile: ${profile}`);
}
const FIXTURE_DIR = customDir ? path.resolve(customDir) : path.join(os.tmpdir(), `my-pi-${profile}-${targetCount}-fixture`);

async function countFilesRecursively(dir) {
  let count = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        count += await countFilesRecursively(path.join(dir, e.name));
      } else if (e.isFile()) {
        count++;
      }
    }
  } catch {
    return 0;
  }
  return count;
}

async function runBenchmark() {
  console.log(`=== TRAVERSAL BENCHMARK: profile=${profile} target=${targetCount} ===`);
  const appPackage = JSON.parse(await fs.readFile(path.join(repoRoot, "apps", "my-pi-mcp", "package.json"), "utf8"));
  const commit = resolveReleaseCommit({ cwd: repoRoot });

  // Auto-generate fixture if missing or if count doesn't match
  let observedCount = await countFilesRecursively(FIXTURE_DIR);
  if (observedCount < targetCount) {
    console.log(`[benchmark] Fixture missing or incomplete (${observedCount}/${targetCount}) at ${FIXTURE_DIR}. Generating...`);
    const { generate100kFixture } = await import(pathToFileURL(path.join(repoRoot, "benchmarks", "generate-100k-fixture.mjs")).href);
    await generate100kFixture(FIXTURE_DIR, targetCount);
    observedCount = await countFilesRecursively(FIXTURE_DIR);
  }

  console.log(`[benchmark] Target fixture verified: ${observedCount} observed files in ${FIXTURE_DIR}`);
  if (observedCount < targetCount) {
    throw new Error(`[benchmark] FATAL: Observed file count (${observedCount}) is less than required target count (${targetCount})`);
  }

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
  console.log("[benchmark] Running grep search (MY_PI_BENCHMARK_TARGET_UNIQUE_NEEDLE)...");
  const t0Grep = performance.now();
  const grepRes = await searchCap.execute({ mode: "grep", pattern: "MY_PI_BENCHMARK_TARGET_UNIQUE_NEEDLE" }, ctx);
  const grepMs = performance.now() - t0Grep;
  console.log(`[benchmark] Grep found ${grepRes.data.totalCount} matches in ${grepMs.toFixed(2)}ms`);

  // 3. Sensitive path check: grep for the synthetic marker (should find 0 because .aws and .env are denied)
  console.log("[benchmark] Verifying sensitive path security...");
  const secRes = await searchCap.execute({ mode: "grep", pattern: "BENCHMARK_DENIED_PATH_VALUE" }, ctx);
  if (secRes.data.totalCount === 0) {
    console.log("  ✓ PASS: Sensitive credentials were NOT searched or leaked.");
  } else {
    console.error("  ✗ FAIL: Sensitive credentials were leaked!");
    process.exit(1);
  }

  const resultData = {
    profile,
    releaseVersion: appPackage.version,
    commit,
    targetFileCount: targetCount,
    observedFileCount: observedCount,
    fixtureDir: path.basename(FIXTURE_DIR),
    globMatches: globRes.data.totalCount,
    globDurationMs: +globMs.toFixed(2),
    grepMatches: grepRes.data.totalCount,
    grepDurationMs: +grepMs.toFixed(2),
    platform: process.platform,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  };

  const resultsDir = path.join(repoRoot, "benchmarks", "results");
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(path.join(resultsDir, `traversal-${profile}.json`), JSON.stringify(resultData, null, 2), "utf8");
  console.log(`[benchmark] Traversal benchmark PASS. Results saved to benchmarks/results/traversal-${profile}.json`);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
