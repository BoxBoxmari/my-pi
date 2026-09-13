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
    metrics: [{ id: "primary", definition: "observed outcome", role: "primary" }],
    contaminationControls: { freshWorktree: true, freshSession: true, noSharedContext: true, noCrossArmArtifacts: true, stableAuthorityRequired: false, forbiddenPaths: [".env"] },
  };
}

function result(taskId, { accepted = true, treatment = 2 } = {}) {
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
    arms: [
      { armId: "control", runId: `run-${"2".repeat(16)}`, sessionId: `${taskId}-control-session`, worktreeId: `${taskId}-control-worktree`, baseCommit: BASE, sourceStateDigest: DIGEST, commands: [{ id: "profile", argv: ["node", "--version"], status: "passed", exitCode: 0 }, { id: "unit", argv: ["node", "--test", "test/release/observed-evidence-aggregate-v2.test.mjs"], status: "passed", exitCode: 0 }], contamination: { detected: false, reasons: [] } },
      { armId: "treatment", runId: `run-${"3".repeat(16)}`, sessionId: `${taskId}-treatment-session`, worktreeId: `${taskId}-treatment-worktree`, baseCommit: BASE, sourceStateDigest: DIGEST, commands: [{ id: "profile", argv: ["node", "--help"], status: "passed", exitCode: 0 }, { id: "unit", argv: ["node", "--test", "test/release/observed-evidence-aggregate-v2.test.mjs"], status: "passed", exitCode: 0 }], contamination: { detected: false, reasons: [] } },
    ],
    measurements: [{ id: "primary", armId: "control", value: 1 }, { id: "primary", armId: "treatment", value: treatment }],
    adjudication: { independent: true, evaluatorRunId: `${taskId}-evaluator`, recordedAt: "2026-09-13T00:03:00.000Z", outcome: accepted ? "accepted" : "inconclusive", evidenceRefs: ["stdout"] },
  };
}

test("aggregate reports metric deltas but never self-promotes", () => {
  const report = aggregateObservedEvidence([
    { task: task("OT-011"), result: result("OT-011") },
    { task: task("OT-012"), result: result("OT-012", { treatment: 3 }) },
    { task: task("OT-013", "PN8"), result: result("OT-013") },
  ], { minQualified: 2 });
  assert.equal(report.status, "WITHHELD");
  assert.equal(report.promotionEligible, false);
  assert.equal(report.sample.byHypothesis.PN6.qualified, 2);
  assert.equal(report.sample.byHypothesis.PN8.qualified, 1);
  assert.equal(report.metrics.primary.meanDelta, 4 / 3);
  assert.match(report.reasons.join("\n"), /sample target/);
});

test("failed adjudication remains visible but is not qualified", () => {
  const report = aggregateObservedEvidence([{ task: task("OT-014"), result: result("OT-014", { accepted: false }) }], { minQualified: 1 });
  assert.equal(report.sample.qualifiedPairs, 0);
  assert.equal(report.pairs[0].qualified, false);
  assert.match(report.pairs[0].reasons.join("\n"), /adjudication outcome/);
});
