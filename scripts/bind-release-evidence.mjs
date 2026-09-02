#!/usr/bin/env node
/**
 * Bind release-required evidence documents to the candidate commit.
 *
 * This is an explicit generation step. verify-gates.mjs and verify-release.mjs
 * remain read-only consumers of the resulting evidence.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveReleaseCommit } from "./release-identity.mjs";

const ROOT = process.cwd();

function requiredEvidenceIds(policy) {
  const ids = new Set(policy.requiredGates ?? []);
  for (const criterion of policy.requiredCriteria ?? []) {
    const [gateId] = String(criterion).split(":", 1);
    if (gateId) ids.add(gateId);
  }
  return [...ids].sort();
}

export async function main() {
  const policyPath = path.join(ROOT, "release", "release-policy.json");
  const evidenceDir = path.join(ROOT, "evidence");
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const commit = resolveReleaseCommit({ cwd: ROOT });

  for (const gateId of requiredEvidenceIds(policy)) {
    const evidencePath = path.join(evidenceDir, `${gateId}.json`);
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (evidence.id && evidence.id !== gateId) {
      throw new Error(`evidence file ${gateId}.json declares unexpected id ${evidence.id}`);
    }
    const idNeedsUpdate = evidence.id !== gateId;
    evidence.id = gateId;
    if (idNeedsUpdate || evidence.commit !== commit) {
      await writeFile(evidencePath, `${JSON.stringify({ ...evidence, commit }, null, 2)}\n`, "utf8");
    }
    console.log(`Bound ${gateId}.json to ${commit}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main().catch((err) => {
    console.error(`[EVIDENCE] Binding failed: ${err.message}`);
    process.exitCode = 1;
  });
}
