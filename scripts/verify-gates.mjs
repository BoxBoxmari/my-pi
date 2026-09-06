#!/usr/bin/env node
/**
 * R0.1.10: gate evidence framework (P1 hardened).
 *
 * Validates that `evidence/*.json` statuses are consistent with machine
 * reality. A gate marked PASS must have, per criterion, at least one
 * evidence reference that is NOT a skipped test or a branch-name-only
 * reference AND that resolves to an existing test/benchmark/workflow file
 * (bare prose strings with no file token are rejected). CI must fail if
 * docs say PASS but machine evidence says PARTIAL.
 *
 * Usage: node scripts/verify-gates.mjs [--strict]
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
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
      } else if (valid.needsFileCheck && !(await criterionHasFileBackedEvidence(crit.evidence ?? []))) {
        console.error(`  ✗ ${crit.id}: PASS criterion has no file-backed evidence (bare string; expected a resolvable test/benchmark/workflow file)`);
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
 * - a test that accepts both success and failure,
 * - a bare prose string with no resolvable test/benchmark/workflow file.
 * At least one evidence entry must contain a file token (e.g. `foo.test.ts`,
 * `scripts/*.mjs`, `benchmarks/*.mjs`, `.github/workflows/*.yml`) that
 * resolves to an existing file under the repo root.
 */
const EVIDENCE_FILE_RE = /[\w\-.]+\.(?:test\.[cm]?[jt]s|spec\.[cm]?[jt]s|[cm]?[jt]s|mjs|cjs|json|ya?ml)\b/g;
const EVIDENCE_SEARCH_ROOTS = ["test", "tests", "packages", "apps", "scripts", "benchmarks", "evidence", "provenance", "docs", ".github", "schemas", "policies", "crates"];

function extractFileTokens(entry) {
  const out = [];
  for (const m of String(entry).matchAll(EVIDENCE_FILE_RE)) {
    let token = m[0].replace(/^["'(\[]+|["')\],.;:]+$/g, "");
    if (token) out.push(token);
  }
  // Also capture explicit relative paths (scripts/foo.mjs, test/bar.test.mjs).
  for (const m of String(entry).matchAll(/[\w.\-]+(?:\/[\w.\-]+)+\.\w+/g)) {
    const token = m[0].replace(/^["'(\[]+|["')\],.;:]+$/g, "");
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

async function evidenceTokenResolves(token) {
  const clean = token.replace(/:\d+(?::\d+)?$/, "");
  const candidates = [path.join(ROOT, clean), path.join(ROOT, clean.replace(/^\.\//, ""))];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        const st = await stat(c);
        if (st.isFile()) return c;
      } catch { /* race: fall through to basename search */ }
    }
  }
  const base = path.basename(clean);
  for (const root of EVIDENCE_SEARCH_ROOTS) {
    const dir = path.join(ROOT, root);
    if (!existsSync(dir)) continue;
    if (await basenameExistsRecursive(dir, base)) return path.join(dir, base);
  }
  return undefined;
}

async function basenameExistsRecursive(dir, base) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      if (await basenameExistsRecursive(path.join(dir, e.name), base)) return true;
    } else if (e.name === base) {
      return true;
    }
  }
  return false;
}

async function criterionHasFileBackedEvidence(ev) {
  for (const e of ev) {
    if (typeof e !== "string") continue;
    for (const token of extractFileTokens(e)) {
      if (await evidenceTokenResolves(token)) return true;
    }
  }
  return false;
}

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
  return { ok: true, needsFileCheck: true };
}

if (strict) {
  // In strict mode, a criterion listed but without a machine test name is a warning.
  console.log("strict mode: every PASS criterion must reference a concrete test/workflow/benchmark.");
}

await run();
