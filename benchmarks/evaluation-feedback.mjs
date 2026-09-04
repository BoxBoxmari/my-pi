#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { evaluateAcceptance } from "../packages/evaluation-runtime/dist/index.js";
import { makeFeedback } from "../packages/evaluation-runtime/dist/index.js";
import { makeRetryCycle } from "../packages/evaluation-runtime/dist/index.js";

const corpus = JSON.parse(await readFile(new URL("../fixtures/evaluation-feedback/corpus.json", import.meta.url), "utf8"));
const started = performance.now();
let structuredRepairCandidates = 0;
let ordinaryLogCandidates = 0;
let falseAccepts = 0;
let inconclusive = 0;
for (const sample of corpus) {
  const run = { id: `evalrun-${sample.id}`, specId: `evalspec-${sample.id}`, specVersion: 1, workItemId: `work-${sample.id}`, repositoryStateRef: `receipt-${sample.id}`, attempt: 1, state: "completed" };
  const spec = { id: run.specId, projectId: "project-benchmark", version: 1, name: sample.id, criteria: [{ id: "criterion", kind: sample.criterionKind, required: true, severity: "error", evaluatorRef: "fixture", expected: "pass" }], acceptancePolicy: { requiredCriteria: "all", allowManualOverride: false }, specDigest: `spec-${sample.id}`, createdAt: "2026-09-04T00:00:00.000Z" };
  const result = { providerResultId: `provider-${sample.id}`, providerId: "fixture", criterionId: "criterion", runId: run.id, resultDigest: `result-${sample.id}`, recordedAt: "2026-09-04T00:00:01.000Z", result: { criterionId: "criterion", outcome: sample.outcome, evidence: sample.outcome === "inconclusive" ? [] : [{ provider: "fixture", digest: `sha256-${sample.id}`, targetStateRef: run.repositoryStateRef, observedAt: "2026-09-04T00:00:01.000Z" }], reasonCode: sample.reasonCode } };
  const acceptance = evaluateAcceptance(spec, run.repositoryStateRef, [result]);
  if (acceptance.decision === "accepted") falseAccepts++;
  if (acceptance.decision === "inconclusive") inconclusive++;
  const feedback = makeFeedback(run, acceptance, [result]);
  if (feedback?.reasonCodes.length && sample.retryable) structuredRepairCandidates++;
  if (acceptance.decision !== "accepted") ordinaryLogCandidates++;
  if (feedback) makeRetryCycle(run, sample.retryable ? "recommended" : "review_required", feedback.reasonCodes, feedback.retryConstraints ?? [], 3);
}
const elapsedMs = performance.now() - started;
console.log(JSON.stringify({ profile: "evaluation-feedback", cases: corpus.length, elapsedMs: Number(elapsedMs.toFixed(3)), structuredFeedbackRepairCandidates: structuredRepairCandidates, ordinaryLogFailureCandidates: ordinaryLogCandidates, falseAccepts, inconclusive }, null, 2));
