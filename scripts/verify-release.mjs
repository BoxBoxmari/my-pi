#!/usr/bin/env node
/**
 * Release Admission Gate Verifier v3.
 *
 * Enforces fail-closed validation of release criteria defined in
 * release/release-policy.json against evidence/*.json, package metadata,
 * candidate commit identity, git tags, and benchmark integrity.
 * Usage: node scripts/verify-release.mjs [--strict]
 */
import { realpathSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { normalizeCommit, resolveReleaseCommit } from "./release-identity.mjs";

const ROOT = process.cwd();
const STRICT = process.argv.includes("--strict");
const POLICY_FILE = path.join(ROOT, "release", "release-policy.json");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const ROOT_PACKAGE = path.join(ROOT, "package.json");
const APP_PACKAGE = path.join(ROOT, "apps", "my-pi-mcp", "package.json");

function isMainModule(metaUrl) {
  const invokedPath = process.argv[1];
  if (!invokedPath) return false;
  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return path.resolve(invokedPath) === path.resolve(fileURLToPath(metaUrl));
  }
}

async function fileExists(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch {
    return false;
  }
}

function requiredEvidenceIds(policy) {
  const ids = new Set(policy.requiredGates ?? []);
  for (const criterion of policy.requiredCriteria ?? []) {
    const [gateId] = String(criterion).split(":", 1);
    if (gateId) ids.add(gateId);
  }
  return [...ids].sort();
}

async function readEvidence(evidenceFiles) {
  const evidenceMap = new Map();
  let failures = 0;
  for (const file of evidenceFiles) {
    const filePath = path.join(EVIDENCE_DIR, file);
    try {
      const gateData = JSON.parse(await readFile(filePath, "utf8"));
      const fileGateId = file.replace(/\.json$/, "");
      const gateId = gateData.id || fileGateId;
      if (gateData.id && gateData.id !== fileGateId) {
        console.error(`  ✗ Evidence file ${file} declares unexpected gate id ${gateData.id}`);
        failures++;
        continue;
      }
      if (evidenceMap.has(gateId)) {
        console.error(`  ✗ Duplicate evidence document for gate ${gateId}`);
        failures++;
        continue;
      }
      evidenceMap.set(gateId, gateData);
    } catch (err) {
      console.error(`  ✗ Failed to parse evidence ${file}: ${err.message}`);
      failures++;
    }
  }
  return { evidenceMap, failures };
}

function validateEvidenceFreshness(policy, evidenceMap) {
  const mode = policy.evidenceFreshness?.mode ?? "none";
  if (mode === "none") return { failures: 0, commit: null };
  if (mode !== "current-release-commit") {
    console.error(`  ✗ Unsupported evidence freshness mode: ${mode}`);
    return { failures: 1, commit: null };
  }

  let canonicalCommit;
  try {
    canonicalCommit = resolveReleaseCommit({ cwd: ROOT });
    console.log(`  ✓ Canonical release commit: ${canonicalCommit}`);
  } catch (err) {
    console.error(`  ✗ Cannot determine canonical release commit: ${err.message}`);
    return { failures: 1, commit: null };
  }

  let failures = 0;
  for (const gateId of requiredEvidenceIds(policy)) {
    const gateData = evidenceMap.get(gateId);
    if (!gateData) continue;
    if (typeof gateData.commit !== "string" || gateData.commit.trim() === "") {
      console.error(`  ✗ Gate evidence ${gateId}.json is missing commit identifier`);
      failures++;
      continue;
    }

    let observedCommit;
    try {
      observedCommit = normalizeCommit(gateData.commit, { cwd: ROOT });
    } catch (err) {
      console.error(`  ✗ Gate evidence ${gateId}.json has invalid commit ${gateData.commit}: ${err.message}`);
      failures++;
      continue;
    }

    if (observedCommit !== canonicalCommit) {
      console.error(`  ✗ Gate evidence ${gateId}.json is stale: expected ${canonicalCommit}, observed ${observedCommit}`);
      failures++;
    } else {
      console.log(`  ✓ Gate evidence ${gateId}.json bound to ${canonicalCommit}`);
    }
  }
  return { failures, commit: canonicalCommit };
}

function validateBenchmarkData(data, { expectedProfile, minTarget, policyVersion, canonicalCommit, fileName }) {
  let failures = 0;
  if (data.profile !== expectedProfile) {
    console.error(`  ✗ Benchmark profile mismatch in ${fileName}: got ${data.profile}, expected ${expectedProfile}`);
    failures++;
  }
  if (typeof data.releaseVersion !== "string" || data.releaseVersion !== policyVersion) {
    console.error(`  ✗ Benchmark release version mismatch in ${fileName}: got ${data.releaseVersion}, expected ${policyVersion}`);
    failures++;
  }
  if (typeof data.commit !== "string" || data.commit.trim() === "") {
    console.error(`  ✗ Benchmark ${fileName} is missing candidate commit`);
    failures++;
  } else {
    try {
      const observedCommit = normalizeCommit(data.commit, { cwd: ROOT });
      if (canonicalCommit && observedCommit !== canonicalCommit) {
        console.error(`  ✗ Benchmark ${fileName} is stale: expected ${canonicalCommit}, observed ${observedCommit}`);
        failures++;
      }
    } catch (err) {
      console.error(`  ✗ Benchmark ${fileName} has invalid commit ${data.commit}: ${err.message}`);
      failures++;
    }
  }
  if (typeof data.targetFileCount !== "number" || data.targetFileCount < minTarget) {
    console.error(`  ✗ Benchmark target count insufficient in ${fileName}: got ${data.targetFileCount}, expected >= ${minTarget}`);
    failures++;
  }
  if (typeof data.observedFileCount !== "number" || data.observedFileCount < data.targetFileCount) {
    console.error(`  ✗ Benchmark observed file count (${data.observedFileCount}) < target count (${data.targetFileCount})`);
    failures++;
  }
  if (typeof data.observedFileCount !== "number" || data.observedFileCount < minTarget) {
    console.error(`  ✗ Benchmark observed file count (${data.observedFileCount}) < required minimum (${minTarget})`);
    failures++;
  }
  if (typeof data.platform !== "string" || data.platform.trim() === "") {
    console.error(`  ✗ Benchmark ${fileName} is missing platform`);
    failures++;
  }
  if (typeof data.nodeVersion !== "string" || data.nodeVersion.trim() === "") {
    console.error(`  ✗ Benchmark ${fileName} is missing Node version`);
    failures++;
  }
  if (typeof data.timestamp !== "string" || data.timestamp.trim() === "") {
    console.error(`  ✗ Benchmark ${fileName} is missing timestamp`);
    failures++;
  }
  return failures;
}

async function verifyBenchmark(filePath, config, policyVersion, canonicalCommit, required) {
  const fileName = path.basename(filePath);
  let data;
  try {
    data = JSON.parse(await readFile(filePath, "utf8"));
  } catch (err) {
    if (required) {
      console.error(`  ✗ Missing required ${config.profile} benchmark evidence at ${filePath}: ${err.message}`);
      return 1;
    }
    return 0;
  }

  const failures = validateBenchmarkData(data, {
    expectedProfile: config.profile,
    minTarget: config.minTarget,
    policyVersion,
    canonicalCommit,
    fileName,
  });
  if (failures === 0) {
    console.log(`  ✓ Benchmark ${config.profile} verified (${data.observedFileCount} files in ${data.globDurationMs}ms glob / ${data.grepDurationMs}ms grep)`);
  }
  return failures;
}

export async function run() {
  let policy;
  try {
    policy = JSON.parse(await readFile(POLICY_FILE, "utf8"));
  } catch (err) {
    throw new Error(`Failed to load policy file ${POLICY_FILE}: ${err.message}`);
  }

  console.log(`=== MY-PI RELEASE ADMISSION VERIFIER v3 (${STRICT ? "strict" : "standard"}) ===`);
  console.log(`Release Version: ${policy.version} (${policy.releaseChannel} channel)`);
  console.log(`Schema Version:  ${policy.schemaVersion}`);

  let failures = 0;
  let passedCount = 0;

  let rootPkg;
  let appPkg;
  try {
    rootPkg = JSON.parse(await readFile(ROOT_PACKAGE, "utf8"));
    appPkg = JSON.parse(await readFile(APP_PACKAGE, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read package manifests: ${err.message}`);
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

  let evidenceFiles;
  try {
    evidenceFiles = (await readdir(EVIDENCE_DIR)).filter((file) => file.endsWith(".json"));
  } catch (err) {
    throw new Error(`Failed to read evidence directory: ${err.message}`);
  }
  const evidenceResult = await readEvidence(evidenceFiles);
  const evidenceMap = evidenceResult.evidenceMap;
  failures += evidenceResult.failures;

  for (const requiredGate of policy.requiredGates || []) {
    if (!evidenceMap.has(requiredGate)) {
      console.error(`  ✗ Missing required gate evidence for gate: ${requiredGate}`);
      failures++;
    }
  }

  const freshness = validateEvidenceFreshness(policy, evidenceMap);
  failures += freshness.failures;
  const canonicalCommit = freshness.commit;

  const deferredList = policy.deferredCapabilities || [];
  const seenCriteria = new Set();
  for (const critKey of policy.requiredCriteria || []) {
    if (seenCriteria.has(critKey)) {
      console.error(`  ✗ Duplicate required criterion in policy: ${critKey}`);
      failures++;
      continue;
    }
    seenCriteria.add(critKey);

    const [gateId, ...criterionParts] = String(critKey).split(":");
    const critId = criterionParts.join(":");
    const gateData = evidenceMap.get(gateId);
    if (!gateData) {
      console.error(`  ✗ Missing required gate evidence for: ${critKey}`);
      failures++;
      continue;
    }

    const crit = (gateData.criteria || []).find((criterion) => criterion.id === critId);
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

  const benchmarkDefaults = {
    smoke: { file: "benchmarks/results/traversal-smoke.json", profile: "smoke", minTarget: 5000, requiredInStrictMode: false },
    release: { file: "benchmarks/results/traversal-release.json", profile: "release", minTarget: 100000, requiredInStrictMode: true },
  };
  const benchmarkPolicy = { ...benchmarkDefaults, ...(policy.benchmarkQualification || {}) };
  for (const config of Object.values(benchmarkPolicy)) {
    if (!config?.file) continue;
    const filePath = path.resolve(ROOT, config.file);
    const required = config.requiredInStrictMode === true && (STRICT || process.env.REQUIRE_RELEASE_BENCHMARK === "true");
    if (required || await fileExists(filePath)) {
      failures += await verifyBenchmark(filePath, config, policy.version, canonicalCommit, required);
    }
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
    releaseCommit: canonicalCommit,
  };
  console.log(JSON.stringify(resultSummary, null, 2));
  console.log(`========================================`);

  if (failures > 0) {
    console.error(`\n[RELEASE VERIFIER] ADMISSION WITHHELD: ${failures} check(s) failed.`);
    process.exitCode = 1;
    return false;
  }

  console.log(`\n[RELEASE VERIFIER] ADMISSION ADMITTED: All ${passedCount} criteria and release contracts verified successfully.`);
  return true;
}

if (isMainModule(import.meta.url)) {
  await run().catch((err) => {
    console.error(`[RELEASE VERIFIER] ${err.message}`);
    process.exitCode = 1;
  });
}
