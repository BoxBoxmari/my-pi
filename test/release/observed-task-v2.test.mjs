import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObservedResult, buildPairedManifest } from "../../scripts/dogfood-observed-paired-v2.mjs";
import { validateObservedPair, validateObservedTask, validateObservedResult } from "../../scripts/validate-observed-task-v2.mjs";

const BASE = "a".repeat(40);
const OTHER = "b".repeat(40);
const DIGEST = "c".repeat(64);

function task(overrides = {}) {
  return {
    schemaVersion: "2",
    recordType: "observed-task-v2",
    taskId: "OT-011",
    taskDefinitionPath: "dogfood/observed-tasks/OT-011.v2.json",
    taskDefinitionCommit: BASE,
    registeredAt: "2026-09-13T00:00:00.000Z",
    title: "Receipt-to-code-state provenance observation",
    taskClass: "research",
    primaryHypothesis: "none",
    baseCommit: BASE,
    targetScope: { include: ["packages/code-state/**"], exclude: [".my-pi/**"] },
    acceptanceCriteria: [{ id: "managed-output", condition: "a verified receipt output is classified as managed" }],
    primaryVariable: { name: "provenance evidence", control: "observation only", treatment: "verified receipt matching" },
    arms: {
      control: { profileId: "observe-only", description: "No receipt supplied", baseCommit: BASE, worktreeKey: "control", sessionKey: "control", freshWorktree: true, freshSession: true },
      treatment: { profileId: "receipt-aware", description: "Verified receipt supplied", baseCommit: BASE, worktreeKey: "treatment", sessionKey: "treatment", freshWorktree: true, freshSession: true }
    },
    requiredTests: [{ id: "unit", argv: ["node", "--test", "test/release/observed-task-v2.test.mjs"], timeoutMs: 60_000 }],
    environment: { hostFamily: "local-node", modelFamily: "none", sameHostFamily: true, sameModelFamily: true },
    adjudication: { independent: true, evaluator: "read-only-test-run", groundTruth: "asserted test outcomes", requiredEvidence: ["stdout", "exit code"] },
    metrics: [{ id: "classification", definition: "status by path transition", role: "primary" }],
    contaminationControls: { freshWorktree: true, freshSession: true, noSharedContext: true, noCrossArmArtifacts: true, stableAuthorityRequired: false, forbiddenPaths: [".env", ".my-pi/provenance/**"] },
    ...overrides
  };
}

function result(overrides = {}) {
  return {
    schemaVersion: "2",
    recordType: "observed-result-v2",
    taskId: "OT-011",
    taskDefinition: "dogfood/observed-tasks/OT-011.v2.json",
    taskDefinitionCommit: BASE,
    runId: "run-1111111111111111",
    status: "COMPLETED",
    baseCommit: BASE,
    runStartedAt: "2026-09-13T00:01:00.000Z",
    runCompletedAt: "2026-09-13T00:02:00.000Z",
    arms: [
      { armId: "control", runId: "run-2222222222222222", sessionId: "session-control", worktreeId: "worktree-control", baseCommit: BASE, sourceStateDigest: DIGEST, commands: [{ id: "unit", argv: ["node", "--test", "test/release/observed-task-v2.test.mjs"], status: "passed", exitCode: 0 }], contamination: { detected: false, reasons: [] } },
      { armId: "treatment", runId: "run-3333333333333333", sessionId: "session-treatment", worktreeId: "worktree-treatment", baseCommit: BASE, sourceStateDigest: DIGEST, commands: [{ id: "unit", argv: ["node", "--test", "test/release/observed-task-v2.test.mjs"], status: "passed", exitCode: 0 }], contamination: { detected: false, reasons: [] } }
    ],
    adjudication: { independent: true, evaluatorRunId: "eval-4444", recordedAt: "2026-09-13T00:03:00.000Z", outcome: "accepted", evidenceRefs: ["stdout"] },
    ...overrides
  };
}

test("ObservedTask v2 golden fixture validates", () => {
  const validation = validateObservedTask(task());
  assert.deepEqual(validation, { ok: true, errors: [] });
});

test("validator rejects a missing preregistration identity and an unregistered command", () => {
  const invalid = task({ taskDefinitionCommit: "short", requiredTests: [{ id: "bad", argv: ["bash", "-lc", "echo unsafe"], timeoutMs: 1_000 }] });
  const validation = validateObservedTask(invalid);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /taskDefinitionCommit/);
  assert.match(validation.errors.join("\n"), /not an allowed/);
});

test("validator rejects control/treatment base drift and shared isolation keys", () => {
  const invalid = task({ arms: { ...task().arms, treatment: { ...task().arms.treatment, baseCommit: OTHER, worktreeKey: "control" } } });
  const validation = validateObservedTask(invalid);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /baseCommit/);
  assert.match(validation.errors.join("\n"), /different worktree keys/);
});

test("PN6 and PN8 tasks require divergent preregistered arm setup commands", () => {
  const invalid = task({ taskClass: "PN6", primaryHypothesis: "PN6" });
  const validation = validateObservedTask(invalid);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /setupCommands/);

  const valid = task({
    taskClass: "PN6",
    primaryHypothesis: "PN6",
    arms: {
      ...task().arms,
      control: { ...task().arms.control, setupCommands: [{ id: "profile", argv: ["node", "--version"], timeoutMs: 10_000 }] },
      treatment: { ...task().arms.treatment, setupCommands: [{ id: "profile", argv: ["node", "--help"], timeoutMs: 10_000 }] },
    },
  });
  assert.deepEqual(validateObservedTask(valid), { ok: true, errors: [] });
  const manifest = buildPairedManifest(valid, { currentCommit: BASE, runAt: "2026-09-13T00:03:30.000Z" });
  assert.deepEqual(manifest.arms.map((arm) => arm.commands.map((command) => ({ id: command.id, phase: command.phase, argv: command.argv }))), [
    [
      { id: "profile", phase: "arm_setup", argv: ["node", "--version"] },
      { id: "unit", phase: "downstream", argv: ["node", "--test", "test/release/observed-task-v2.test.mjs"] },
    ],
    [
      { id: "profile", phase: "arm_setup", argv: ["node", "--help"] },
      { id: "unit", phase: "downstream", argv: ["node", "--test", "test/release/observed-task-v2.test.mjs"] },
    ],
  ]);
});

test("paired result golden fixture validates only with independent adjudication", () => {
  const valid = validateObservedPair(task(), result());
  assert.deepEqual(valid, { ok: true, errors: [] });
  const invalid = validateObservedPair(task(), result({ adjudication: { ...result().adjudication, independent: false } }));
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /independent/);
});

test("result command evidence must match the preregistered argv", () => {
  const invalid = result({ arms: result().arms.map((arm) => ({ ...arm, commands: [{ ...arm.commands[0], argv: ["node", "--test", "tampered.mjs"] }] })) });
  const validation = validateObservedResult(invalid, task());
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /argv differs from preregistration/);
});

test("contamination bypass is fail-closed and cannot be reported completed", () => {
  const contaminated = result({
    status: "COMPLETED",
    arms: [result().arms[0], { ...result().arms[1], contamination: { detected: true, reasons: ["opposite-arm artifact found"] } }]
  });
  const validation = validateObservedResult(contaminated, task());
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /CONTAMINATED/);
});

test("paired manifest is deterministic for frozen inputs", () => {
  const first = buildPairedManifest(task(), { currentCommit: BASE, runAt: "2026-09-13T00:04:00.000Z" });
  const second = buildPairedManifest(task(), { currentCommit: BASE, runAt: "2026-09-13T00:04:00.000Z" });
  assert.deepEqual(first, second);
  assert.equal(first.arms[0].baseCommit, BASE);
  assert.notEqual(first.arms[0].worktreeId, first.arms[1].worktreeId);
  assert.notEqual(first.arms[0].sessionId, first.arms[1].sessionId);
});

test("executed manifest conversion preserves bounded command evidence", () => {
  const manifest = buildPairedManifest(task(), { currentCommit: BASE, runAt: "2026-09-13T00:05:00.000Z", execute: true });
  for (const arm of manifest.arms) {
    for (const command of arm.commands) Object.assign(command, { status: "passed", exitCode: 0, stdoutDigest: DIGEST, stderrDigest: DIGEST });
    arm.sourceStateDigest = DIGEST;
  }
  const observed = buildObservedResult(task(), manifest, {
    runCompletedAt: "2026-09-13T00:06:00.000Z",
    adjudication: { independent: true, evaluatorRunId: "eval-independent", recordedAt: "2026-09-13T00:07:00.000Z", outcome: "accepted", evidenceRefs: ["independent-check"] },
    measurements: [{ id: "classification", armId: "control", value: 0 }, { id: "classification", armId: "treatment", value: 1 }],
  });
  assert.equal(validateObservedPair(task(), observed).ok, true);
  assert.equal(observed.status, "COMPLETED");
  assert.equal(observed.arms[0].sourceStateDigest, DIGEST);
});

test("measurements reject unknown metrics and duplicate arm/metric pairs", () => {
  const invalid = result({ measurements: [
    { id: "unknown", armId: "control", value: 1 },
    { id: "classification", armId: "control", value: 0 },
    { id: "classification", armId: "control", value: 1 },
  ] });
  const validation = validateObservedResult(invalid, task());
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /reference a task metric/);
  assert.match(validation.errors.join("\n"), /duplicates an arm\/metric/);
});
