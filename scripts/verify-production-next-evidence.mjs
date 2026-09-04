#!/usr/bin/env node
/**
 * Read-only validation for candidate-bound Production Next evidence.
 * This validates the recorded self-host run; it does not grant release admission.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { candidateStateDigest } from "./candidate-state.mjs";
import { validateStableBootstrapEvidence } from "./stable-bootstrap-contract.mjs";

const ROOT = process.cwd();
const EVIDENCE_PATH = path.join(ROOT, "evidence", "PN9.json");
const PN6_EVIDENCE_PATH = path.join(ROOT, "evidence", "PN6.json");
const PN8_EVIDENCE_PATH = path.join(ROOT, "evidence", "PN8.json");
const PN12_EVIDENCE_PATH = path.join(ROOT, "evidence", "PN12.json");
const FULL_SHA = /^[0-9a-f]{40}$/i;
const CURRENT_STATE_DIGEST = await candidateStateDigest();

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim().toLowerCase();
}

function has(value, message, errors) {
  if (!value) errors.push(message);
}

async function verify() {
  const errors = [];
  let evidence;
  try {
    evidence = JSON.parse(await readFile(EVIDENCE_PATH, "utf8"));
  } catch (error) {
    return { present: false, valid: false, errors: [`cannot read evidence/PN9.json: ${error.message}`] };
  }
  const head = currentCommit();
  has(evidence.id === "PN9", "evidence id must be PN9", errors);
  has(evidence.schemaVersion === "1", "schemaVersion must be 1", errors);
  has(evidence.profile === "PN9-self-host", "profile must be PN9-self-host", errors);
  if (evidence.bootstrapMode === "stable-n-minus-one-runtime") {
    errors.push(...validateStableBootstrapEvidence(evidence, { head, stateDigest: CURRENT_STATE_DIGEST }));
  } else {
    has(evidence.status === "CANDIDATE", "PN9 evidence must remain CANDIDATE", errors);
    has(evidence.promotionEligible === false, "PN9 evidence cannot self-declare promotion eligibility", errors);
    has(evidence.bootstrapMode === "candidate-current-build" && evidence.stableNMinusOneVerified === false, "PN9 candidate must explicitly disclose that stable N-1 was not verified", errors);
  }
  has(FULL_SHA.test(evidence.commit ?? "") && evidence.commit.toLowerCase() === head, `evidence commit must equal current HEAD ${head}`, errors);
  has(evidence.candidateStateDigest === CURRENT_STATE_DIGEST, "PN9 evidence candidateStateDigest does not match the current working tree", errors);
  has(typeof evidence.bootstrapSha === "string" && FULL_SHA.test(evidence.bootstrapSha), "bootstrapSha must be a full commit SHA", errors);
  has(evidence.candidateDirty === true ? evidence.candidateSha === "uncommitted" : evidence.candidateSha === head, "candidateSha does not match candidateDirty", errors);
  has(typeof evidence.projectId === "string" && evidence.projectId.length > 0, "projectId is missing", errors);

  const decisions = evidence.evaluations ?? {};
  has(decisions.firstDecision?.decision === "rejected", "first evaluation decision must be rejected", errors);
  has(decisions.secondDecision?.decision === "accepted", "second evaluation decision must be accepted", errors);
  has(typeof decisions.rejectedRunId === "string" && typeof decisions.acceptedRunId === "string" && decisions.rejectedRunId !== decisions.acceptedRunId, "evaluation runs must show two distinct attempts", errors);

  const feedback = evidence.feedback ?? {};
  has(feedback.failedCriteria?.includes("target-marker"), "feedback must cite target-marker", errors);
  has(feedback.retryState === "recommended", "feedback must recommend a bounded retry", errors);

  const receipts = evidence.changeReceipts ?? [];
  has(receipts.length === 2, "self-host evidence must contain exactly two change receipts", errors);
  if (receipts.length === 2) {
    has(receipts[0]?.status === "APPLIED" && receipts[1]?.status === "APPLIED", "both self-host change receipts must be APPLIED", errors);
    has(receipts[0]?.inputVersions?.[0]?.fingerprint?.digest, "first receipt must prove its existing source precondition", errors);
    has(receipts[1]?.inputVersions?.[0]?.fingerprint?.digest === receipts[0]?.outputVersions?.[0]?.fingerprint?.digest, "retry receipt must bind to the first output fingerprint", errors);
    has(receipts.every((receipt) => receipt.verification?.verified === true), "all receipts must be read-back verified", errors);
  }

  has(evidence.routing?.reviewerInitialBlockObserved === true, "dependency block was not recorded", errors);
  has(evidence.routing?.replayDeterministic === true, "routing replay was not deterministic", errors);
  has(evidence.routing?.observerItems === 0, "unrelated observer received routed items", errors);
  has(evidence.routing?.impactDetected === true, "self-host impact routing did not emit an ImpactDetected event", errors);
  has(evidence.verification?.targetSourceMarker === true && evidence.verification?.acceptedAfterRetry === true, "target source verification did not pass after retry", errors);
  has(evidence.verification?.noAutonomousSpawn === true, "self-host evidence did not record the no-spawn control", errors);
  has(evidence.verification?.boundedRetryAttempts === 2, "retry attempts are not bounded at two", errors);
  has(evidence.metrics?.retryIterations === 1 && evidence.metrics?.evaluationFalseAccepts === 0, "self-host metrics do not show one retry and zero false accepts", errors);

  const eventTypes = new Set(evidence.eventLog?.types ?? []);
  for (const eventType of ["WorkItemImplementationComplete", "WorkItemAwaitingEvaluation", "WorkItemEvaluationRejected", "WorkItemEvaluationAccepted", "WorkItemUnblocked"]) {
    has(eventTypes.has(eventType), `event log is missing ${eventType}`, errors);
  }
  return { present: true, valid: errors.length === 0, commit: head, errors, evidence: { acceptedRunId: decisions.acceptedRunId, eventCount: evidence.eventLog?.count ?? null, finalTree: evidence.metrics?.finalTree ?? null } };
}

async function verifyPN6() {
  const errors = [];
  let evidence;
  try {
    evidence = JSON.parse(await readFile(PN6_EVIDENCE_PATH, "utf8"));
  } catch (error) {
    return { present: false, valid: false, errors: [`cannot read evidence/PN6.json: ${error.message}`] };
  }
  const head = currentCommit();
  has(evidence.id === "PN6", "PN6 evidence id must be PN6", errors);
  has(evidence.schemaVersion === "1", "PN6 schemaVersion must be 1", errors);
  has(evidence.profile === "impact-routing-arms", "PN6 profile is invalid", errors);
  has(evidence.status === "CANDIDATE", "PN6 evidence must remain CANDIDATE", errors);
  has(evidence.evidenceKind === "controlled_replay", "PN6 evidence must identify controlled replay", errors);
  has(evidence.promotionEligible === false, "PN6 evidence cannot self-declare promotion eligibility", errors);
  has(FULL_SHA.test(evidence.commit ?? "") && evidence.commit.toLowerCase() === head, `PN6 evidence commit must equal current HEAD ${head}`, errors);
  has(evidence.candidateStateDigest === CURRENT_STATE_DIGEST, "PN6 evidence candidateStateDigest does not match the current working tree", errors);
  has(evidence.candidateDirty === true ? evidence.candidateSha === "uncommitted" : evidence.candidateSha === head, "PN6 candidateSha does not match candidateDirty", errors);
  const report = evidence.report ?? {};
  const requiredScenarios = ["independent-modules", "api-contract-change", "schema-migration", "hub-refactor", "parallel-bugfix"];
  has(requiredScenarios.every((id) => report.scenarioIds?.includes(id)), "PN6 corpus is missing a required workload class", errors);
  has(report.productGate === "CANDIDATE_VALUE_SIGNAL", "PN6 controlled replay did not produce a value signal", errors);
  const full = report.arms?.fullImpactRouting;
  const baseline = report.arms?.taskBoardOnly;
  has(full && baseline && full.recall >= baseline.recall, "PN6 full routing recall is below the simpler baseline", errors);
  has(full && baseline && full.averageRepairIterations < baseline.averageRepairIterations, "PN6 full routing does not reduce modeled repair iterations", errors);
  has(full && baseline && full.staleContractMistakes < baseline.staleContractMistakes, "PN6 full routing does not reduce modeled stale-contract mistakes", errors);
  has(full?.caseResults?.every((result) => Array.isArray(result.impactReasons) && result.impactReasons.length > 0), "PN6 full routing results lack explainable reasons", errors);
  return { present: true, valid: errors.length === 0, commit: head, errors, evidence: { cases: report.cases ?? null, fullRecall: full?.recall ?? null, baselineRecall: baseline?.recall ?? null, fullRepairReduction: report.comparison?.fullRepairReduction ?? null } };
}

async function verifyPN8() {
  const errors = [];
  let evidence;
  try {
    evidence = JSON.parse(await readFile(PN8_EVIDENCE_PATH, "utf8"));
  } catch (error) {
    return { present: false, valid: false, errors: [`cannot read evidence/PN8.json: ${error.message}`] };
  }
  const head = currentCommit();
  has(evidence.id === "PN8", "PN8 evidence id must be PN8", errors);
  has(evidence.schemaVersion === "1", "PN8 schemaVersion must be 1", errors);
  has(evidence.profile === "evaluation-feedback-arms", "PN8 profile is invalid", errors);
  has(evidence.status === "CANDIDATE", "PN8 evidence must remain CANDIDATE", errors);
  has(evidence.evidenceKind === "controlled_replay", "PN8 evidence must identify controlled replay", errors);
  has(evidence.outcomeSource === "controlled_fixture_repair_model", "PN8 outcome source must be explicit", errors);
  has(evidence.promotionEligible === false, "PN8 evidence cannot self-declare promotion eligibility", errors);
  has(FULL_SHA.test(evidence.commit ?? "") && evidence.commit.toLowerCase() === head, `PN8 evidence commit must equal current HEAD ${head}`, errors);
  has(evidence.candidateStateDigest === CURRENT_STATE_DIGEST, "PN8 evidence candidateStateDigest does not match the current working tree", errors);
  has(evidence.candidateDirty === true ? evidence.candidateSha === "uncommitted" : evidence.candidateSha === head, "PN8 candidateSha does not match candidateDirty", errors);
  const report = evidence.report ?? {};
  has(report.cases === 8, "PN8 corpus must contain eight seeded defect classes", errors);
  has(report.seededFalseAccepts === 0, "PN8 seeded false accepts must be zero", errors);
  has(report.feedbackPackets >= 1, "PN8 must produce structured feedback packets", errors);
  const structured = report.arms?.structuredFeedback;
  const ordinary = report.arms?.ordinaryLogHandoff;
  has(structured && ordinary && structured.repairYield > ordinary.repairYield, "PN8 structured feedback does not improve the controlled repair yield", errors);
  has(structured && structured.priorPassesPreserved === structured.repairsAccepted, "PN8 structured repairs do not preserve all prior required passes", errors);
  has(Array.isArray(report.casesDetail) && report.casesDetail.length === 8, "PN8 case detail is incomplete", errors);
  has(report.casesDetail?.every((item) => item.expectedDecision === item.observedDecision), "PN8 acceptance decisions differ from seeded expected decisions", errors);
  return { present: true, valid: errors.length === 0, commit: head, errors, evidence: { cases: report.cases ?? null, structuredYield: structured?.repairYield ?? null, ordinaryYield: ordinary?.repairYield ?? null, falseAccepts: report.seededFalseAccepts ?? null } };
}

async function verifyPN12() {
  const errors = [];
  let evidence;
  try {
    evidence = JSON.parse(await readFile(PN12_EVIDENCE_PATH, "utf8"));
  } catch (error) {
    return { present: false, valid: false, errors: [`cannot read evidence/PN12.json: ${error.message}`] };
  }
  const head = currentCommit();
  has(evidence.id === "PN12", "PN12 evidence id must be PN12", errors);
  has(evidence.schemaVersion === "1", "PN12 schemaVersion must be 1", errors);
  has(evidence.profile === "local-reliability", "PN12 profile is invalid", errors);
  has(evidence.status === "CANDIDATE", "PN12 evidence must remain CANDIDATE", errors);
  has(evidence.evidenceKind === "local_fault_qualification", "PN12 evidence kind is invalid", errors);
  has(evidence.promotionEligible === false, "PN12 evidence cannot self-declare promotion eligibility", errors);
  has(FULL_SHA.test(evidence.commit ?? "") && evidence.commit.toLowerCase() === head, `PN12 evidence commit must equal current HEAD ${head}`, errors);
  has(evidence.candidateStateDigest === CURRENT_STATE_DIGEST, "PN12 evidence candidateStateDigest does not match the current working tree", errors);
  has(evidence.candidateDirty === true ? evidence.candidateSha === "uncommitted" : evidence.candidateSha === head, "PN12 candidateSha does not match candidateDirty", errors);
  const report = evidence.report ?? {};
  has(report.platform === process.platform, "PN12 platform metadata does not match the verifier host", errors);
  has(report.scenarios && Object.values(report.scenarios).length >= 6 && Object.values(report.scenarios).every(Boolean), "PN12 local recovery/fault scenarios are incomplete", errors);
  has(Array.isArray(report.untestedFaults) && report.untestedFaults.length > 0, "PN12 must declare untested fault classes", errors);
  return { present: true, valid: errors.length === 0, commit: head, errors, evidence: { scenarios: report.scenarios ?? null, recoveryMs: report.metrics?.crashRecoveryMs ?? null, untestedFaults: report.untestedFaults ?? [] } };
}

const pn9 = await verify();
const pn6 = await verifyPN6();
const pn8 = await verifyPN8();
const pn12 = await verifyPN12();
const result = { present: pn9.present && pn6.present && pn8.present && pn12.present, valid: pn9.valid && pn6.valid && pn8.valid && pn12.valid, commit: currentCommit(), errors: [...pn9.errors, ...pn6.errors, ...pn8.errors, ...pn12.errors], evidence: { pn9: pn9.evidence ?? null, pn6: pn6.evidence ?? null, pn8: pn8.evidence ?? null, pn12: pn12.evidence ?? null } };
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
