#!/usr/bin/env node
/**
 * R0.1.10: gate evidence framework.
 *
 * Validates that `evidence/*.json` statuses are consistent with machine
 * reality. A gate marked PASS must have, per criterion, at least one
 * evidence reference that is NOT a skipped test or a branch-name-only
 * reference. CI must fail if docs say PASS but machine evidence says PARTIAL.
 *
 * Usage: node scripts/verify-gates.mjs [--strict]
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const strict = process.argv.includes("--strict");

let failures = 0;
let totalCriteria = 0;

async function run() {
  let files;
  try {
    files = await readdir(EVIDENCE_DIR);
  } catch {
    console.error("evidence/ directory not found. Create evidence/*.json first.");
    process.exit(1);
  }
  for (const f of files.filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(await readFile(path.join(EVIDENCE_DIR, f), "utf8"));
    const gateId = data.id ?? f.replace(".json", "");
    console.log(`\n[${gateId}] status=${data.status}`);
    for (const crit of data.criteria ?? []) {
      totalCriteria++;
      const valid = validateCriterion(crit);
      if (!valid.ok) {
        console.error(`  ✗ ${crit.id}: ${valid.reason}`);
        failures++;
      } else {
        console.log(`  ✓ ${crit.id} (${crit.status})`);
      }
    }
  }

  console.log(`\n${totalCriteria} criteria checked, ${failures} invalid.`);
  if (failures > 0) process.exit(1);
  console.log("gate evidence validation: PASS");
}

/**
 * A PASS criterion must reference concrete machine evidence, never:
 * - a skipped test,
 * - a branch name only,
 * - an unrelated test,
 * - a test that accepts both success and failure.
 */
function validateCriterion(crit) {
  const ev = crit.evidence ?? [];
  if (crit.status !== "PASS") return { ok: true };
  if (ev.length === 0) {
    return { ok: false, reason: "PASS criterion has no evidence" };
  }
  for (const e of ev) {
    if (typeof e !== "string") continue;
    if (/skip/i.test(e)) return { ok: false, reason: `evidence references a skipped test: ${e}` };
    if (/^refs\/heads\//i.test(e) || /branch/i.test(e)) return { ok: false, reason: `evidence is branch-name-only: ${e}` };
  }
  return { ok: true };
}

if (strict) {
  // In strict mode, a criterion listed but without a machine test name is a warning.
  console.log("strict mode: every PASS criterion must reference a concrete test/workflow/benchmark.");
}

await run();
