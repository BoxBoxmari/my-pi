import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProjectId } from "@my-pi/contracts";
import { SqliteCoordinationStore } from "@my-pi/coordination-store";
import { EvaluationRuntime, DeterministicProvider, makeRetryCycle } from "@my-pi/evaluation-runtime";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-evaluation-"));
  const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
  await store.init();
  const projectId = createProjectId();
  await store.transact((tx) => tx.putProjection("project", projectId, { id: projectId, schemaVersion: "1", createdAt: "2026-09-04T00:00:00.000Z" }, projectId));
  return { dir, store, projectId, evaluation: new EvaluationRuntime(store, projectId) };
}

async function ensureWorkItem(store: SqliteCoordinationStore, projectId: string, id: string) {
  const now = "2026-09-04T00:00:00.000Z";
  await store.transact((tx) => tx.putProjection("work_item", id, { id, projectId, title: id, state: "ready", version: 0, createdAt: now, updatedAt: now }, projectId, now));
}

function evidence(targetStateRef: string, provider = "ci") {
  return [{ provider, digest: "sha256:evidence1234", targetStateRef, observedAt: "2026-09-04T00:00:01.000Z" }];
}

test("PN8 accepts only all-required exact-state evidence and survives reopen", async () => {
  const { dir, store, projectId } = await setup();
  const evaluation = new EvaluationRuntime(store, projectId, [new DeterministicProvider()]);
  try {
    const spec = await evaluation.registerSpec({
      name: "required checks",
      criteria: [{ id: "tests", kind: "test", required: true, severity: "error", evaluatorRef: "deterministic-local", expected: "pass" }],
    });
    await ensureWorkItem(store, projectId, "work-1");
    const run = await evaluation.requestRun({ specId: spec.id, workItemId: "work-1" as never, repositoryStateRef: "receipt-1" });
    const accepted = await evaluation.evaluateRun(run.id, { tests: "pass" });
    assert.equal(accepted.decision?.decision, "accepted");
    assert.equal(accepted.feedback, undefined);
    assert.equal(accepted.retry, undefined);
    assert.equal((await evaluation.completeRun(run.id)).decision?.decision, "accepted");

    await store.close();
    const reopenedStore = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
    await reopenedStore.init();
    try {
      const recovered = await new EvaluationRuntime(reopenedStore, projectId).status(run.id);
      assert.equal(recovered.run.state, "completed");
      assert.equal(recovered.decision?.decision, "accepted");
      assert.equal(recovered.results.length, 1);
    } finally {
      await reopenedStore.close();
    }
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN8 rejects stale evidence, missing evidence, and evaluator errors without passing", async () => {
  const { dir, store, projectId, evaluation } = await setup();
  try {
    const spec = await evaluation.registerSpec({
      name: "stale check",
      criteria: [{ id: "tests", kind: "test", required: true, severity: "critical", evaluatorRef: "ci", expected: "pass" }],
    });
    await ensureWorkItem(store, projectId, "work-stale");
    const staleRun = await evaluation.requestRun({ specId: spec.id, workItemId: "work-stale" as never, repositoryStateRef: "receipt-new" });
    await assert.rejects(
      evaluation.recordResult(staleRun.id, { providerResultId: "stale", providerId: "ci", criterionId: "tests", result: { criterionId: "tests", outcome: "pass", evidence: evidence("receipt-old") } }),
      /different target state/,
    );
    const missing = await evaluation.completeRun(staleRun.id);
    assert.equal(missing.decision?.decision, "inconclusive");
    assert.equal(missing.retry?.state, "review_required");
    assert.ok(missing.feedback?.reasonCodes.some((code) => code.startsWith("CRITERION_INCONCLUSIVE:")));

    await ensureWorkItem(store, projectId, "work-error");
    const errorRun = await evaluation.requestRun({ specId: spec.id, workItemId: "work-error" as never, repositoryStateRef: "receipt-error" });
    await evaluation.recordResult(errorRun.id, { providerResultId: "error", providerId: "ci", criterionId: "tests", result: { criterionId: "tests", outcome: "error", evidence: evidence("receipt-error"), reasonCode: "CI_UNAVAILABLE" } });
    const errored = await evaluation.completeRun(errorRun.id);
    assert.equal(errored.decision?.decision, "inconclusive");
    assert.notEqual(errored.decision?.decision, "accepted");
    assert.ok(errored.feedback?.reasonCodes.includes("CI_UNAVAILABLE"));

    await ensureWorkItem(store, projectId, "work-empty");
    const emptyEvidenceRun = await evaluation.requestRun({ specId: spec.id, workItemId: "work-empty" as never, repositoryStateRef: "receipt-empty" });
    await evaluation.recordResult(emptyEvidenceRun.id, { providerResultId: "empty", providerId: "ci", criterionId: "tests", result: { criterionId: "tests", outcome: "pass", evidence: [] } });
    const emptyEvidence = await evaluation.completeRun(emptyEvidenceRun.id);
    assert.equal(emptyEvidence.decision?.decision, "inconclusive");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN8 provider result identity is idempotent but cannot be replayed with a different digest", async () => {
  const { dir, store, projectId, evaluation } = await setup();
  try {
    const spec = await evaluation.registerSpec({ name: "replay", criteria: [{ id: "check", kind: "external", required: true, severity: "error", evaluatorRef: "external", expected: true }] });
    await ensureWorkItem(store, projectId, "work-replay");
    const run = await evaluation.requestRun({ specId: spec.id, workItemId: "work-replay" as never, repositoryStateRef: "receipt-replay" });
    const input = { providerResultId: "provider-result", providerId: "external", criterionId: "check", result: { criterionId: "check", outcome: "pass" as const, evidence: evidence("receipt-replay", "external") } };
    const first = await evaluation.recordResult(run.id, input);
    const same = await evaluation.recordResult(run.id, input);
    assert.equal(same.resultDigest, first.resultDigest);
    await assert.rejects(
      evaluation.recordResult(run.id, { ...input, providerId: "forged-provider" }),
      (error: unknown) => (error as { code?: string }).code === "ERR_EVALUATION_RESULT_CONFLICT",
    );
    await assert.rejects(
      evaluation.recordResult(run.id, { ...input, result: { ...input.result, outcome: "fail" } }),
      (error: unknown) => (error as { code?: string }).code === "ERR_EVALUATION_RESULT_CONFLICT",
    );
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN8 caller-declared evaluator identity cannot satisfy a trusted criterion", async () => {
  const { dir, store, projectId, evaluation } = await setup();
  try {
    const spec = await evaluation.registerSpec({ name: "forged provider", criteria: [{ id: "check", kind: "artifact", required: true, severity: "critical", evaluatorRef: "deterministic-local", expected: true }] });
    await ensureWorkItem(store, projectId, "work-forged-provider");
    const run = await evaluation.requestRun({ specId: spec.id, workItemId: "work-forged-provider" as never, repositoryStateRef: "state-forged-provider" });
    const stored = await evaluation.recordResult(run.id, {
      providerResultId: "caller-claimed-pass",
      providerId: "deterministic-local",
      criterionId: "check",
      result: { criterionId: "check", outcome: "pass", evidence: evidence("state-forged-provider", "deterministic-local") },
    });
    assert.equal(stored.provenance, "external_unverified");
    const status = await evaluation.completeRun(run.id);
    assert.equal(status.decision?.decision, "inconclusive");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN8 retry budget is bounded and deterministic provider never executes shell", async () => {
  const run = { id: "evalrun-test" as never, specId: "evalspec-test" as never, specVersion: 1, workItemId: "work-test" as never, repositoryStateRef: "receipt-test", attempt: 3, state: "completed" as const };
  assert.equal(makeRetryCycle(run, "recommended", ["FAIL"], ["keep tests passing"], 3).state, "exhausted");
  const provider = new DeterministicProvider();
  const criterion = { id: "check", kind: "artifact" as const, required: true, severity: "error" as const, evaluatorRef: "deterministic-local", expected: true };
  const result = await provider.evaluate({ run, criterion, observed: false }, new AbortController().signal);
  assert.equal(result.outcome, "fail");
  assert.equal(provider.id, "deterministic-local");
});

test("PN8 evaluator errors are recorded as inconclusive and never leave a run implicitly accepted", async () => {
  const { dir, store, projectId } = await setup();
  try {
    const failingProvider = {
      id: "failing-provider",
      supports: () => true,
      evaluate: async () => { throw new Error("simulated evaluator outage"); },
    };
    const evaluation = new EvaluationRuntime(store, projectId, [failingProvider]);
    const spec = await evaluation.registerSpec({ name: "provider failure", criteria: [{ id: "check", kind: "artifact", required: true, severity: "critical", evaluatorRef: "failing-provider", expected: true }] });
    await ensureWorkItem(store, projectId, "work-provider-failure");
    const run = await evaluation.requestRun({ specId: spec.id, workItemId: "work-provider-failure" as never, repositoryStateRef: "receipt-provider-failure" });
    const status = await evaluation.evaluateRun(run.id, { check: true });
    assert.equal(status.run.state, "completed");
    assert.equal(status.decision?.decision, "inconclusive");
    assert.equal(status.results[0]?.result.outcome, "error");
    assert.equal(status.results[0]?.result.reasonCode, "EVALUATOR_ERROR");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN8 duplicate criterion results aggregate conservatively instead of letting a pass mask a failure", async () => {
  const { dir, store, projectId, evaluation } = await setup();
  try {
    const spec = await evaluation.registerSpec({ name: "conservative aggregation", criteria: [{ id: "check", kind: "external", required: true, severity: "critical", evaluatorRef: "fixture", expected: true }] });
    await ensureWorkItem(store, projectId, "work-aggregate");
    const run = await evaluation.requestRun({ specId: spec.id, workItemId: "work-aggregate" as never, repositoryStateRef: "tree-aggregate" });
    const passEvidence = evidence("tree-aggregate", "fixture");
    await evaluation.recordResult(run.id, { providerResultId: "pass-result", providerId: "fixture", criterionId: "check", result: { criterionId: "check", outcome: "pass", evidence: passEvidence } });
    await evaluation.recordResult(run.id, { providerResultId: "fail-result", providerId: "fixture", criterionId: "check", result: { criterionId: "check", outcome: "fail", evidence: passEvidence, reasonCode: "CONFLICTING_RESULT" } });
    const status = await evaluation.completeRun(run.id);
    assert.equal(status.decision?.decision, "inconclusive");
    assert.ok(status.feedback?.reasonCodes.includes("CRITERION_INCONCLUSIVE:check"));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
