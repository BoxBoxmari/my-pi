#!/usr/bin/env node
/**
 * Read-only PN11 entry/promotion gate. Controlled fixture evidence is useful
 * qualification data but cannot satisfy this gate; observed engineering
 * outcomes and a distinct stable N-1 bootstrap are required.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { candidateCommit, candidateDirty, candidateStateDigest } from "./candidate-state.mjs";
import { validateStableBootstrapEvidence } from "./stable-bootstrap-contract.mjs";

const ROOT = process.cwd();
const IDS = ["PN6", "PN8", "PN9", "PN12"];
const FULL_SHA = /^[0-9a-f]{40}$/i;
const HEAD = candidateCommit().toLowerCase();
const STATE_DIGEST = await candidateStateDigest();

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

async function readEvidence(id) {
  try {
    return { id, value: JSON.parse(await readFile(path.join(ROOT, "evidence", `${id}.json`), "utf8")) };
  } catch (error) {
    return { id, error: `cannot read evidence/${id}.json: ${error.message}` };
  }
}

function validateEnvelope(id, evidence, errors) {
  if (!evidence) return;
  add(errors, evidence.id === id, `${id}: envelope id is invalid`);
  add(errors, evidence.schemaVersion === "1", `${id}: schemaVersion must be 1`);
  add(errors, evidence.status === "ACCEPTED", `${id}: status must be ACCEPTED for promotion`);
  add(errors, evidence.promotionEligible === true, `${id}: promotionEligible must be true`);
  add(errors, evidence.candidateDirty === false, `${id}: candidateDirty must be false`);
  add(errors, FULL_SHA.test(evidence.commit ?? "") && evidence.commit.toLowerCase() === HEAD, `${id}: commit must equal current HEAD ${HEAD}`);
  add(errors, evidence.candidateSha === HEAD, `${id}: candidateSha must equal current HEAD`);
  add(errors, evidence.candidateStateDigest === STATE_DIGEST, `${id}: candidateStateDigest does not match current source state`);
}

function validatePN6(evidence, errors) {
  if (!evidence) return;
  validateEnvelope("PN6", evidence, errors);
  add(errors, evidence.evidenceKind === "observed_replay", "PN6: evidenceKind must be observed_replay");
  const report = evidence.report ?? {};
  add(errors, typeof report.observationSource === "string" && report.observationSource !== "controlled_fixture_repair_model" && report.observationSource !== "controlled_replay", "PN6: observationSource must identify independent engineering outcomes");
  add(errors, Array.isArray(report.independentRunIds) && report.independentRunIds.length > 0, "PN6: independentRunIds are required");
  add(errors, report.arms?.fullImpactRouting?.recall >= report.arms?.taskBoardOnly?.recall, "PN6: full routing recall must meet the simpler baseline");
  add(errors, report.arms?.fullImpactRouting?.averageRepairIterations < report.arms?.taskBoardOnly?.averageRepairIterations, "PN6: observed full routing must reduce repair iterations");
}

function validatePN8(evidence, errors) {
  if (!evidence) return;
  validateEnvelope("PN8", evidence, errors);
  add(errors, evidence.evidenceKind === "observed_replay", "PN8: evidenceKind must be observed_replay");
  const report = evidence.report ?? {};
  add(errors, typeof report.observationSource === "string" && report.observationSource !== "controlled_fixture_repair_model", "PN8: observationSource must identify independent engineering outcomes");
  add(errors, Array.isArray(report.independentRunIds) && report.independentRunIds.length > 0, "PN8: independentRunIds are required");
  add(errors, report.arms?.structuredFeedback?.repairYield > report.arms?.ordinaryLogHandoff?.repairYield, "PN8: observed structured feedback must improve repair yield");
  add(errors, report.arms?.structuredFeedback?.priorPassesPreserved === report.arms?.structuredFeedback?.repairsAccepted, "PN8: observed structured repairs must preserve prior passes");
  add(errors, report.seededFalseAccepts === 0, "PN8: seeded false accepts must be zero");
}

function validatePN9(evidence, errors) {
  if (!evidence) return;
  validateEnvelope("PN9", evidence, errors);
  if (evidence.bootstrapMode === "stable-n-minus-one-runtime") {
    errors.push(...validateStableBootstrapEvidence(evidence, { head: HEAD, stateDigest: STATE_DIGEST }));
  } else {
    add(errors, evidence.stableNMinusOneVerified === true, "PN9: stableNMinusOneVerified must be true");
    add(errors, FULL_SHA.test(evidence.bootstrapSha ?? "") && evidence.bootstrapSha.toLowerCase() !== HEAD, "PN9: bootstrapSha must be a distinct stable N-1 commit");
  }
  const report = evidence.report ?? evidence;
  add(errors, report.routing?.impactDetected === true, "PN9: observed self-host impact routing is required");
  add(errors, report.verification?.acceptedAfterRetry === true, "PN9: observed accepted retry is required");
  add(errors, report.verification?.noAutonomousSpawn === true, "PN9: no-autonomous-spawn control is required");
}

function validatePN12(evidence, errors) {
  if (!evidence) return;
  validateEnvelope("PN12", evidence, errors);
  const report = evidence.report ?? {};
  add(errors, evidence.evidenceKind === "local_fault_qualification", "PN12: evidenceKind is invalid");
  add(errors, report.scenarios && Object.values(report.scenarios).length >= 6 && Object.values(report.scenarios).every(Boolean), "PN12: all required local scenarios must pass");
  add(errors, Array.isArray(report.untestedFaults) && report.untestedFaults.length > 0, "PN12: untested fault classes must remain declared");
}

const loaded = await Promise.all(IDS.map(readEvidence));
const errors = loaded.flatMap((entry) => entry.error ? [entry.error] : []);
const byId = new Map(loaded.map((entry) => [entry.id, entry.value]));
validatePN6(byId.get("PN6"), errors);
validatePN8(byId.get("PN8"), errors);
validatePN9(byId.get("PN9"), errors);
validatePN12(byId.get("PN12"), errors);

const result = {
  schemaVersion: "1",
  promotionEligible: errors.length === 0,
  currentCommit: HEAD,
  candidateDirty: candidateDirty(),
  errors,
  gates: Object.fromEntries(IDS.map((id) => [id, errors.some((error) => error.startsWith(`${id}:`)) ? "WITHHELD" : "ACCEPTED"])),
};
console.log(JSON.stringify(result, null, 2));
if (!result.promotionEligible) process.exitCode = 1;
