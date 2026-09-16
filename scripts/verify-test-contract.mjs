#!/usr/bin/env node
/**
 * Test-contract verifier (Issue #31).
 *
 * Fails closed when a release/runtime invariant loses its executable proof:
 * - manifest entry is malformed, duplicated, or uses an unknown level/gate
 * - a proof file no longer exists on disk
 * - a proof command references a missing script or package script
 * - a CI anchor (stable workflow reference) no longer appears in the workflow
 *
 * This detects accidental gate removal: deleting a verifier from CI or
 * deleting its test files breaks the contract until intentionally updated.
 *
 * Usage: node scripts/verify-test-contract.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, "test-contract/invariants.json");
const LEVELS = new Set(["unit", "integration", "process", "artifact"]);
const GATES = new Set(["merge", "release", "evidence"]);

function fail(lines) {
  console.error("=== TEST CONTRACT CHECK: FAIL ===");
  for (const line of lines) console.error(line);
  process.exit(1);
}

function main() {
  const failures = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch (error) {
    fail([`cannot read manifest test-contract/invariants.json: ${error.message}`]);
  }
  if (!Array.isArray(manifest.invariants) || manifest.invariants.length === 0) {
    fail(["manifest has no invariants; the contract must never be empty"]);
  }
  const seen = new Set();
  const gateCounts = { merge: 0, release: 0, evidence: 0 };
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  } catch (error) {
    fail([`cannot read package.json: ${error.message}`]);
  }

  for (const inv of manifest.invariants) {
    const id = inv?.id ?? "<missing-id>";
    if (typeof id !== "string" || seen.has(id)) {
      failures.push(`MISSING INVARIANT PROOF: duplicate or missing id '${id}'`);
      continue;
    }
    seen.add(id);
    if (!LEVELS.has(inv.level)) {
      failures.push(`MISSING INVARIANT PROOF: ${id}\n  unknown proof level '${inv.level}' (expected one of ${[...LEVELS].join(", ")})`);
      continue;
    }
    if (!GATES.has(inv.gate)) {
      failures.push(`MISSING INVARIANT PROOF: ${id}\n  unknown gate '${inv.gate}' (expected one of ${[...GATES].join(", ")})`);
      continue;
    }
    gateCounts[inv.gate]++;

    // Proof files must exist.
    const files = inv?.proof?.files ?? [];
    if (!Array.isArray(files) || files.length === 0) {
      failures.push(`MISSING INVARIANT PROOF: ${id}\n  no proof files listed`);
    }
    for (const file of files) {
      if (!existsSync(path.join(ROOT, file))) {
        failures.push(`MISSING INVARIANT PROOF: ${id}\n  expected proof file: ${file}\n  expected command: ${inv?.proof?.command}`);
      }
    }

    // Proof command must resolve to a real script or package script.
    const command = inv?.proof?.command ?? "";
    const scriptMatch = command.match(/node (scripts\/[^\s'"]+\.mjs)/);
    if (scriptMatch && !existsSync(path.join(ROOT, scriptMatch[1]))) {
      failures.push(`MISSING INVARIANT PROOF: ${id}\n  expected command: ${command}\n  missing script: ${scriptMatch[1]}`);
    }
    const pnpmMatch = command.match(/^pnpm ([^\s'"]+)/);
    if (pnpmMatch && !packageJson.scripts?.[pnpmMatch[1]]) {
      failures.push(`MISSING INVARIANT PROOF: ${id}\n  expected command: ${command}\n  missing package script: ${pnpmMatch[1]}`);
    }

    // CI anchors must appear verbatim in the referenced workflow.
    const workflow = inv?.ci?.workflow;
    const anchors = inv?.ci?.anchors ?? [];
    let workflowText;
    try {
      workflowText = readFileSync(path.join(ROOT, workflow), "utf8");
    } catch {
      failures.push(`MISSING CI BINDING: ${id}\n  expected in: ${workflow} (file unreadable)`);
      continue;
    }
    for (const anchor of anchors) {
      if (!workflowText.includes(anchor)) {
        failures.push(`MISSING CI BINDING: ${id}\n  expected in: ${workflow}\n  missing anchor: ${anchor}\n  expected command: ${command}`);
      }
    }
  }

  for (const gate of Object.keys(gateCounts)) {
    if (gateCounts[gate] === 0) failures.push(`MISSING GATE COVERAGE: no invariant uses gate '${gate}'`);
  }

  if (failures.length > 0) fail(failures);
  console.log(`=== TEST CONTRACT CHECK: PASS (${seen.size} invariants: merge=${gateCounts.merge}, release=${gateCounts.release}, evidence=${gateCounts.evidence}) ===`);
}

main();
