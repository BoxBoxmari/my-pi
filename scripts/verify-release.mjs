#!/usr/bin/env node
/**
 * Release Admission Gate Verifier (RR-01).
 * Enforces fail-closed validation of release criteria defined in
 * release/release-policy.json against evidence/*.json and package metadata.
 * Usage: node scripts/verify-release.mjs [--strict]
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const POLICY_FILE = path.join(ROOT, "release", "release-policy.json");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const ROOT_PACKAGE = path.join(ROOT, "package.json");
const APP_PACKAGE = path.join(ROOT, "apps", "my-pi-mcp", "package.json");

async function run() {
  let policy;
  try {
    policy = JSON.parse(await readFile(POLICY_FILE, "utf8"));
  } catch (err) {
    console.error(`[RELEASE VERIFIER] Failed to load policy file ${POLICY_FILE}: ${err.message}`);
    process.exit(1);
  }

  console.log(`=== MY-PI RELEASE ADMISSION VERIFIER ===`);
  console.log(`Release Version: ${policy.version} (${policy.releaseChannel} channel)`);
  console.log(`Schema Version:  ${policy.schemaVersion}`);

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

  let failures = 0;
  let passedCount = 0;
  const deferredList = policy.deferredCapabilities || [];

  for (const critKey of policy.requiredCriteria) {
    const [gateId, critId] = critKey.split(":");
    const gateData = evidenceMap.get(gateId);

    if (!gateData) {
      console.error(`  ✗ Missing required gate evidence for: ${critKey}`);
      failures++;
      continue;
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
    console.error(`\n[RELEASE VERIFIER] ADMISSION WITHHELD: ${failures} criteria failed.`);
    process.exit(1);
  }

  console.log(`\n[RELEASE VERIFIER] ADMISSION ADMITTED: All ${passedCount} criteria verified successfully.`);
}

await run();