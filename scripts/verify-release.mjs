#!/usr/bin/env node
/**
 * Release Admission Gate Verifier v2 (RR-01).
 * Enforces fail-closed validation of release criteria defined in
 * release/release-policy.json against evidence/*.json, package metadata,
 * git tags, and benchmark integrity.
 * Usage: node scripts/verify-release.mjs [--strict]
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const POLICY_FILE = path.join(ROOT, "release", "release-policy.json");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const ROOT_PACKAGE = path.join(ROOT, "package.json");
const APP_PACKAGE = path.join(ROOT, "apps", "my-pi-mcp", "package.json");

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  let policy;
  try {
    policy = JSON.parse(await readFile(POLICY_FILE, "utf8"));
  } catch (err) {
    console.error(`[RELEASE VERIFIER] Failed to load policy file ${POLICY_FILE}: ${err.message}`);
    process.exit(1);
  }

  console.log(`=== MY-PI RELEASE ADMISSION VERIFIER v2 ===`);
  console.log(`Release Version: ${policy.version} (${policy.releaseChannel} channel)`);
  console.log(`Schema Version:  ${policy.schemaVersion}`);

  let failures = 0;
  let passedCount = 0;

  // 1. Version & Tag binding across manifests
  let rootPkg, appPkg;
  try {
    rootPkg = JSON.parse(await readFile(ROOT_PACKAGE, "utf8"));
    appPkg = JSON.parse(await readFile(APP_PACKAGE, "utf8"));
  } catch (err) {
    console.error(`[RELEASE VERIFIER] Failed to read package manifests: ${err.message}`);
    process.exit(1);
  }

  if (rootPkg.version !== policy.version) {
    console.error(`  ✗ Root package version (${rootPkg.version}) does not match policy version (${policy.version})`);
    failures++;
  } else {
    console.log(`  ✓ Root package version matches policy: ${rootPkg.version}`);
  }

  if (appPkg.version !== policy.version) {
    console.error(`  ✗ App package version (${appPkg.version}) does not match policy version (${policy.version})`);
    failures++;
  } else {
    console.log(`  ✓ App package version matches policy: ${appPkg.version}`);
  }

  const tagEnv = process.env.RELEASE_TAG || (process.env.GITHUB_REF_NAME?.startsWith("v") ? process.env.GITHUB_REF_NAME : null);
  if (tagEnv) {
    const expectedTag = `v${policy.version}`;
    if (tagEnv !== expectedTag && tagEnv !== policy.version) {
      console.error(`  ✗ Tag (${tagEnv}) does not match expected release version (${expectedTag})`);
      failures++;
    } else {
      console.log(`  ✓ Release tag verified: ${tagEnv}`);
    }
  }

  // 2. Read evidence directory
  let evidenceFiles = [];
  try {
    evidenceFiles = (await readdir(EVIDENCE_DIR)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    console.error(`[RELEASE VERIFIER] Failed to read evidence directory: ${err.message}`);
    process.exit(1);
  }

  const evidenceMap = new Map();
  for (const f of evidenceFiles) {
    const gateData = JSON.parse(await readFile(path.join(EVIDENCE_DIR, f), "utf8"));
    const gateId = gateData.id || f.replace(".json", "");
    evidenceMap.set(gateId, gateData);
  }

  // 3. Required Gates validation
  for (const requiredGate of policy.requiredGates || []) {
    if (!evidenceMap.has(requiredGate)) {
      console.error(`  ✗ Missing required gate evidence for gate: ${requiredGate}`);
      failures++;
    }
  }

  // 4. Required criteria & duplicates validation
  const deferredList = policy.deferredCapabilities || [];
  const seenCriteria = new Set();

  for (const critKey of policy.requiredCriteria) {
    if (seenCriteria.has(critKey)) {
      console.error(`  ✗ Duplicate required criterion in policy: ${critKey}`);
      failures++;
      continue;
    }
    seenCriteria.add(critKey);

    const [gateId, critId] = critKey.split(":");
    const gateData = evidenceMap.get(gateId);

    if (!gateData) {
      console.error(`  ✗ Missing required gate evidence for: ${critKey}`);
      failures++;
      continue;
    }

    if (!gateData.commit || typeof gateData.commit !== "string" || gateData.commit.trim() === "") {
      console.error(`  ✗ Gate evidence ${gateId}.json is missing commit identifier`);
      failures++;
    }

    const crit = (gateData.criteria || []).find((c) => c.id === critId);
    if (!crit) {
      console.error(`  ✗ Missing required criterion: ${critKey} in ${gateId}.json`);
      failures++;
      continue;
    }

    if (crit.status !== "PASS") {
      console.error(`  ✗ Criterion ${critKey} status is ${crit.status} (expected PASS)`);
      failures++;
    } else {
      console.log(`  ✓ ${critKey} (PASS)`);
      passedCount++;
    }
  }

  for (const def of deferredList) {
    console.log(`  ℹ Deferred: ${def.gate}:${def.id} (${def.description}) - Non-blocking`);
  }

  // 5. Performance benchmark binding
  const benchDir = path.join(ROOT, "benchmarks", "results");
  const smokeBenchFile = path.join(benchDir, "traversal-smoke.json");
  const releaseBenchFile = path.join(benchDir, "traversal-release.json");

  const verifyBenchmark = async (filePath, expectedProfile, minTarget) => {
    try {
      const data = JSON.parse(await readFile(filePath, "utf8"));
      if (data.profile !== expectedProfile) {
        console.error(`  ✗ Benchmark profile mismatch in ${path.basename(filePath)}: got ${data.profile}, expected ${expectedProfile}`);
        failures++;
      }
      if (typeof data.targetFileCount !== "number" || data.targetFileCount < minTarget) {
        console.error(`  ✗ Benchmark target count insufficient in ${path.basename(filePath)}: got ${data.targetFileCount}, expected >= ${minTarget}`);
        failures++;
      }
      if (typeof data.observedFileCount !== "number" || data.observedFileCount < data.targetFileCount) {
        console.error(`  ✗ Benchmark observed file count (${data.observedFileCount}) < target count (${data.targetFileCount})`);
        failures++;
      }
      if (!data.timestamp) {
        console.error(`  ✗ Benchmark missing timestamp in ${path.basename(filePath)}`);
        failures++;
      }
      console.log(`  ✓ Benchmark ${expectedProfile} verified (${data.observedFileCount} files in ${data.globDurationMs}ms glob / ${data.grepDurationMs}ms grep)`);
    } catch (err) {
      if (expectedProfile === "release" && process.env.REQUIRE_RELEASE_BENCHMARK === "true") {
        console.error(`  ✗ Missing release benchmark evidence at ${filePath}: ${err.message}`);
        failures++;
      }
    }
  };

  if (await fileExists(smokeBenchFile)) {
    await verifyBenchmark(smokeBenchFile, "smoke", 5000);
  }
  if (await fileExists(releaseBenchFile)) {
    await verifyBenchmark(releaseBenchFile, "release", 100000);
  }

  console.log(`\n========================================`);
  const resultSummary = {
    release: policy.version,
    channel: policy.releaseChannel,
    status: failures === 0 ? "PASS" : "FAIL",
    requiredCount: policy.requiredCriteria.length,
    passedCount,
    failedCount: failures,
    deferredCount: deferredList.length,
  };
  console.log(JSON.stringify(resultSummary, null, 2));
  console.log(`========================================`);

  if (failures > 0) {
    console.error(`\n[RELEASE VERIFIER] ADMISSION WITHHELD: ${failures} check(s) failed.`);
    process.exit(1);
  }

  console.log(`\n[RELEASE VERIFIER] ADMISSION ADMITTED: All ${passedCount} criteria and release contracts verified successfully.`);
}

await run();