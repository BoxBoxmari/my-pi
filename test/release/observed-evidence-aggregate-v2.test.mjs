import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateObservedEvidence } from "../../scripts/aggregate-observed-evidence-v2.mjs";

const BASE = "a".repeat(40);
const DIGEST = "c".repeat(64);

function task(taskId, hypothesis = "PN6") {
  return {
    schemaVersion: "2",
    recordType: "observed-task-v2",
    taskId,
    taskDefinitionPath: `dogfood/observed-tasks/${taskId}.json`,
    taskDefinitionCommit: BASE,
    registration: { receiptPath: `dogfood/observed-registrations/${taskId}.json` },
    registeredAt: "2026-09-13T00:00:00.000Z",
    title: `${hypothesis} observed task`,
    taskClass: hypothesis,
    primaryHypothesis: hypothesis,
    baseCommit: BASE,
    targetScope: { include: ["packages/**"], exclude: [".my-pi/**"] },
    acceptanceCriteria: [{ id: "tests", condition: "the downstream tests pass" }],
    primaryVariable: { name: "routing", control: "disabled", treatment: "enabled" },
    arms: {
      control: { profileId: "control", description: "control", baseCommit: BASE, worktreeKey: `${taskId}-control`, sessionKey: `${taskId}-control`, freshWorktree: true, freshSession: true, setupCommands: [{ id: "profile", argv: ["node", "--version"], timeoutMs: 10_000 }] },
      treatment: { profileId: "treatment", description: "treatment", baseCommit: BASE, worktreeKey: `${taskId}-treatment`, sessionKey: `${taskId}-treatment`, freshWorktree: true, freshSession: true, setupCommands: [{ id: "profile", argv: ["node", "--help"], timeoutMs: 10_000 }] },
    },
    requiredTests: [{ id: "unit", argv: ["node", "--test", "test/release/observed-evidence-aggregate-v2.test.mjs"], timeoutMs: 60_000 }],
    environment: { hostFamily: "local-node", modelFamily: "none", sameHostFamily: true, sameModelFamily: true },
    adjudication: { independent: true, evaluator: "independent-run", groundTruth: "test result", requiredEvidence: ["stdout"] },
    metrics: [
      { id: "primary", definition: "observed outcome", role: "primary" },
      { id: "downstream_pass", definition: "independent acceptance", role: "secondary" },
      { id: "repair_iterations", definition: "independent repair attempts", role: "secondary" },
    ],
    contaminationControls: { freshWorktree: true, freshSession: true, noSharedContext: true, noCrossArmArtifacts: true, stableAuthorityRequired: false, forbiddenPaths: [".env"] },
    workload: { evidenceKind: hypothesis === "PN8" ? "live_repair" : "observed_source_change", heterogeneityKey: taskId, frozenStateId: taskId },
  };
}

function verifiedRegistration() {
  return { ok: true, errors: [] };
}

function result(taskId, { accepted = true, treatment = 2 } = {}) {
  const isPN8 = taskId === "OT-013";
  const evaluatorRunId = taskId + "-evaluator";
  return {
    schemaVersion: "2",
    recordType: "observed-result-v2",
    taskId,
    taskDefinition: `dogfood/observed-tasks/${taskId}.json`,
    taskDefinitionCommit: BASE,
    runId: `run-${taskId.slice(-3).padStart(16, "1")}`,
    status: "COMPLETED",
    baseCommit: BASE,
    runStartedAt: "2026-09-13T00:01:00.000Z",
    runCompletedAt: "2026-09-13T00:02:00.000Z",
    evidenceKind: isPN8 ? "live_repair" : "observed_source_change",
    measurementEvidence: {
      evaluatorMode: "independent-command-output",
      armRuns: {
        control: { runId: `run-${"2".repeat(16)}`, evaluatorRunId, repairIterations: 1, accepted: true },
        treatment: { runId: `run-${"3".repeat(16)}`, evaluatorRunId, repairIterations: 1, accepted: true },
      },
    },
    repairSessions: isPN8 ? [
      { armId: "control", sessionId: `${taskId}-control-session`, worktreeId: `${taskId}-control-worktree`, frozenStateDigest: DIGEST, feedbackMode: "ordinary_log", attempts: 1, initialFailureObserved: true, repairPatchIds: [`${taskId}-repair`], evaluatorEvidence: "independent evaluator output", accepted: true, priorPassesPreserved: true, regressions: 0, falseAccepts: 0 },
      { armId: "treatment", sessionId: `${taskId}-treatment-session`, worktreeId: `${taskId}-treatment-worktree`, frozenStateDigest: DIGEST, feedbackMode: "structured_feedback_packet", attempts: 1, initialFailureObserved: true, repairPatchIds: [`${taskId}-repair`], evaluatorEvidence: "independent evaluator output", accepted: true, priorPassesPreserved: true, regressions: 0, falseAccepts: 0 },
    ] : undefined,
    arms: [
      { armId: "control", runId: `run-${"2".repeat(16)}`, sessionId: `${taskId}-control-session`, worktreeId: `${taskId}-control-worktree`, baseCommit: BASE, sourceStateDigest: DIGEST, commands: [{ id: "profile", argv: ["node", "--version"], status: "passed", exitCode: 0 }, { id: "unit", argv: ["node", "--test", "test/release/observed-evidence-aggregate-v2.test.mjs"], status: "passed", exitCode: 0 }], contamination: { detected: false, reasons: [] } },
      { armId: "treatment", runId: `run-${"3".repeat(16)}`, sessionId: `${taskId}-treatment-session`, worktreeId: `${taskId}-treatment-worktree`, baseCommit: BASE, sourceStateDigest: DIGEST, commands: [{ id: "profile", argv: ["node", "--help"], status: "passed", exitCode: 0 }, { id: "unit", argv: ["node", "--test", "test/release/observed-evidence-aggregate-v2.test.mjs"], status: "passed", exitCode: 0 }], contamination: { detected: false, reasons: [] } },
    ],
    measurements: [
      { id: "primary", armId: "control", value: 1 },
      { id: "primary", armId: "treatment", value: treatment },
      { id: "downstream_pass", armId: "control", value: 1 },
      { id: "downstream_pass", armId: "treatment", value: 1 },
      { id: "repair_iterations", armId: "control", value: 1 },
      { id: "repair_iterations", armId: "treatment", value: 1 },
    ],
    adjudication: { independent: true, evaluatorRunId, recordedAt: "2026-09-13T00:03:00.000Z", outcome: accepted ? "accepted" : "inconclusive", evidenceRefs: ["stdout"] },
  };
}

test("aggregate reports metric deltas but never self-promotes", () => {
  const report = aggregateObservedEvidence([
    { task: task("OT-011"), result: result("OT-011"), registration: verifiedRegistration() },
    { task: task("OT-012"), result: result("OT-012", { treatment: 3 }), registration: verifiedRegistration() },
    { task: task("OT-013", "PN8"), result: result("OT-013"), registration: verifiedRegistration() },
  ], { minQualified: 2 });
  assert.equal(report.status, "WITHHELD");
  assert.equal(report.promotionEligible, false);
  assert.equal(report.sample.byHypothesis.PN6.qualified, 2);
  assert.equal(report.sample.byHypothesis.PN8.qualified, 1);
  assert.equal(report.metrics.primary.meanDelta, 4 / 3);
  assert.match(report.reasons.join("\n"), /sample target/);
});

test("missing Git registration remains visible but is not qualified", () => {
  const report = aggregateObservedEvidence([{ task: task("OT-015"), result: result("OT-015"), registration: { ok: false, errors: ["task definition changed after Git registration"] } }], { minQualified: 1 });
  assert.equal(report.sample.qualifiedPairs, 0);
  assert.equal(report.pairs[0].validPair, false);
  assert.match(report.pairs[0].reasons.join("\n"), /Git registration/);
});

test("failed adjudication remains visible but is not qualified", () => {
  const report = aggregateObservedEvidence([{ task: task("OT-014"), result: result("OT-014", { accepted: false }), registration: verifiedRegistration() }], { minQualified: 1 });
  assert.equal(report.sample.qualifiedPairs, 0);
  assert.equal(report.pairs[0].qualified, false);
  assert.match(report.pairs[0].reasons.join("\n"), /adjudication outcome/);
});

test("PN8 rejects a repair record without measured initial failure", () => {
  const taskRecord = task("OT-013", "PN8");
  const resultRecord = result("OT-013");
  resultRecord.repairSessions[0].initialFailureObserved = false;
  const report = aggregateObservedEvidence([{ task: taskRecord, result: resultRecord, registration: verifiedRegistration() }], { minQualified: 1 });
  assert.equal(report.pairs[0].qualified, false);
  assert.match(report.pairs[0].reasons.join("\n"), /initial failure/);
});
