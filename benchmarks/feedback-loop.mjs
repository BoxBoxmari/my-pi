#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { evaluateAcceptance, makeFeedback, makeRetryCycle } from "../packages/evaluation-runtime/dist/index.js";

const corpus = JSON.parse(await readFile(new URL("../fixtures/evaluation-feedback/corpus.json", import.meta.url), "utf8"));
let falseAccepts = 0;
let feedbackPackets = 0;
let retryRecommendations = 0;
for (const sample of corpus) {
  const run = { id: `evalrun-${sample.id}`, specId: `evalspec-${sample.id}`, specVersion: 1, workItemId: `work-${sample.id}`, repositoryStateRef: `receipt-${sample.id}`, attempt: 1, state: "completed" };
  const spec = { id: run.specId, projectId: "project-benchmark", version: 1, name: sample.id, criteria: [{ id: "criterion", kind: sample.criterionKind, required: true, severity: "critical", evaluatorRef: "fixture", expected: "pass" }], acceptancePolicy: { requiredCriteria: "all", allowManualOverride: false }, specDigest: `spec-${sample.id}`, createdAt: "2026-09-04T00:00:00.000Z" };
  const result = { providerResultId: `provider-${sample.id}`, providerId: "fixture", criterionId: "criterion", runId: run.id, resultDigest: `result-${sample.id}`, recordedAt: "2026-09-04T00:00:01.000Z", result: { criterionId: "criterion", outcome: sample.outcome, evidence: sample.outcome === "inconclusive" ? [] : [{ provider: "fixture", digest: `sha256-${sample.id}`, targetStateRef: run.repositoryStateRef, observedAt: "2026-09-04T00:00:01.000Z" }], reasonCode: sample.reasonCode } };
  const acceptance = evaluateAcceptance(spec, run.repositoryStateRef, [result]);
  if (acceptance.decision === "accepted" && sample.expectedDecision !== "accepted") falseAccepts++;
  const feedback = makeFeedback(run, acceptance, [result]);
  if (feedback) {
    feedbackPackets++;
    const retry = makeRetryCycle(run, sample.retryable ? "recommended" : "review_required", feedback.reasonCodes, feedback.retryConstraints ?? [], 3);
    if (retry.state === "recommended") retryRecommendations++;
  }
}
console.log(JSON.stringify({ profile: "feedback-loop", cases: corpus.length, falseAccepts, feedbackPackets, retryRecommendations }, null, 2));
