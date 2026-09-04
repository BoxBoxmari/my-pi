#!/usr/bin/env node
/**
 * PN8 controlled replay for ordinary log handoff versus structured feedback.
 * The evaluator and acceptance decisions are real EvaluationRuntime calls. The
 * repair profiles are labelled fixture assumptions, so this is a candidate
 * signal rather than a production repair-yield claim.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createProjectId } from "../packages/contracts/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";
import { EvaluationRuntime } from "../packages/evaluation-runtime/dist/index.js";
import { candidateCommit, candidateDirty, candidateStateDigest } from "../scripts/candidate-state.mjs";

const ROOT = path.resolve(".");
const CORPUS_PATH = path.join(ROOT, "fixtures", "evaluation-feedback", "corpus.json");
const OBSERVED_AT = "2026-09-04T00:00:00.000Z";

async function putWorkItem(store, projectId, id) {
  await store.transact((tx) => tx.putProjection("work_item", id, { id, projectId, title: id, state: "ready", version: 0, createdAt: OBSERVED_AT, updatedAt: OBSERVED_AT }, projectId, OBSERVED_AT));
}

class FixtureEvaluatorProvider {
  id = "fixture-deterministic";

  supports() {
    return true;
  }

  async evaluate(input, signal) {
    signal.throwIfAborted();
    const observation = input.observed && typeof input.observed === "object" ? input.observed : {};
    const value = observation.value;
    const outcome = observation.outcome ?? (JSON.stringify(value) === JSON.stringify(input.criterion.expected) ? "pass" : "fail");
    const evidence = outcome === "inconclusive" ? [] : [{ provider: this.id, digest: `sha256:${createHash("sha256").update(JSON.stringify({ run: input.run.id, criterion: input.criterion.id, value }), "utf8").digest("hex")}`, targetStateRef: input.run.repositoryStateRef, observedAt: OBSERVED_AT }];
    return {
      providerResultId: `${this.id}:${input.run.id}:${input.criterion.id}`,
      criterionId: input.criterion.id,
      outcome,
      evidence,
      observed: value,
      ...(observation.reasonCode === undefined ? {} : { reasonCode: observation.reasonCode }),
    };
  }
}

const corpus = JSON.parse(await readFile(CORPUS_PATH, "utf8"));
const started = performance.now();
const store = new SqliteCoordinationStore(":memory:");
const projectId = createProjectId();
const evaluation = new EvaluationRuntime(store, projectId, [new FixtureEvaluatorProvider()]);
const cases = [];
let falseAccepts = 0;
let feedbackPackets = 0;
let structuredRetries = 0;
let structuredRepairs = 0;
let ordinaryRetries = 0;
let ordinaryRepairs = 0;
let noRegressionAfterStructuredRepair = 0;

try {
  await store.init();
  await store.transact((tx) => tx.putProjection("project", projectId, { id: projectId, schemaVersion: "1", createdAt: OBSERVED_AT }, projectId, OBSERVED_AT));
  for (const sample of corpus) {
    const workItemId = `work-${sample.id}`;
    await putWorkItem(store, projectId, workItemId);
    const spec = await evaluation.registerSpec({
      name: `PN8 ${sample.id}`,
      criteria: [
        { id: "failure", kind: sample.criterionKind, required: true, severity: "critical", evaluatorRef: "fixture-deterministic", expected: "pass" },
        { id: "regression-guard", kind: "artifact", required: true, severity: "critical", evaluatorRef: "fixture-deterministic", expected: "preserved" },
      ],
    });
    const firstState = `fixture:${sample.id}:attempt-1`;
    const firstRun = await evaluation.requestRun({ specId: spec.id, workItemId, repositoryStateRef: firstState, attempt: 1 });
    const first = await evaluation.evaluateRun(firstRun.id, {
      failure: { outcome: sample.outcome, value: sample.outcome === "fail" ? "broken" : sample.outcome, reasonCode: sample.reasonCode },
      "regression-guard": { outcome: "pass", value: "preserved" },
    });
    if (first.decision?.decision === "accepted" && sample.expectedDecision !== "accepted") falseAccepts += 1;
    if (first.feedback) feedbackPackets += 1;

    const model = sample.repairModel ?? { ordinary: false, structured: false };
    const structuredAttempted = model.structured === true && sample.retryable === true && first.feedback?.failedCriteria?.includes("failure");
    const ordinaryAttempted = model.ordinary === true && sample.retryable === true;
    let structuredRepairAccepted = false;
    let structuredGuardPreserved = false;
    if (structuredAttempted) {
      structuredRetries += 1;
      const secondState = `fixture:${sample.id}:attempt-2`;
      const secondRun = await evaluation.requestRun({ specId: spec.id, workItemId, repositoryStateRef: secondState, attempt: 2 });
      const second = await evaluation.evaluateRun(secondRun.id, {
        failure: { outcome: "pass", value: "pass" },
        "regression-guard": { outcome: "pass", value: "preserved" },
      });
      if (second.decision?.decision === "accepted" && second.feedback === undefined) {
        structuredRepairAccepted = true;
        structuredRepairs += 1;
        structuredGuardPreserved = second.results.some((result) => result.criterionId === "regression-guard" && result.result.outcome === "pass");
        noRegressionAfterStructuredRepair += structuredGuardPreserved ? 1 : 0;
      }
    }
    if (ordinaryAttempted) {
      ordinaryRetries += 1;
      if (model.ordinaryResolves === true) ordinaryRepairs += 1;
    }
    cases.push({
      id: sample.id,
      expectedDecision: sample.expectedDecision,
      observedDecision: first.decision?.decision,
      feedbackReasonCodes: first.feedback?.reasonCodes ?? [],
      structuredFeedbackRetry: structuredAttempted,
      structuredRepairAccepted,
      ordinaryLogRetry: ordinaryAttempted,
      ordinaryLogRepairAccepted: ordinaryAttempted && model.ordinaryResolves === true,
      regressionGuardPreserved: structuredGuardPreserved,
    });
  }
} finally {
  await store.close();
}

const structuredYield = structuredRetries === 0 ? 0 : Number((structuredRepairs / structuredRetries).toFixed(3));
const ordinaryYield = ordinaryRetries === 0 ? 0 : Number((ordinaryRepairs / ordinaryRetries).toFixed(3));
const report = {
  profile: "evaluation-feedback-arms",
  evidenceKind: "controlled_replay",
  outcomeSource: "controlled_fixture_repair_model",
  productGate: structuredYield > ordinaryYield && falseAccepts === 0 ? "CANDIDATE_VALUE_SIGNAL" : "WITHHELD_NO_VALUE_SIGNAL",
  cases: corpus.length,
  seededFalseAccepts: falseAccepts,
  feedbackPackets,
  arms: {
    ordinaryLogHandoff: { retriesStarted: ordinaryRetries, repairsAccepted: ordinaryRepairs, repairYield: ordinaryYield },
    structuredFeedback: { retriesStarted: structuredRetries, repairsAccepted: structuredRepairs, repairYield: structuredYield, priorPassesPreserved: noRegressionAfterStructuredRepair },
  },
  comparison: { repairYieldDelta: Number((structuredYield - ordinaryYield).toFixed(3)), structuredFeedbackImproves: structuredYield > ordinaryYield },
  casesDetail: cases,
  elapsedMs: Number((performance.now() - started).toFixed(3)),
};

const evidenceOutArg = process.argv.indexOf("--evidence-out");
const evidenceOut = evidenceOutArg < 0 ? undefined : process.argv[evidenceOutArg + 1];
if (evidenceOutArg >= 0 && !evidenceOut) throw new Error("--evidence-out requires a path");
if (evidenceOut === undefined) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const outputPath = path.resolve(ROOT, evidenceOut);
  const relative = path.relative(ROOT, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--evidence-out must stay inside the repository");
  const commit = candidateCommit();
  const dirty = candidateDirty();
  const evidenceDocument = { schemaVersion: "1", id: "PN8", profile: report.profile, status: "CANDIDATE", evidenceKind: report.evidenceKind, outcomeSource: report.outcomeSource, commit, candidateSha: dirty ? "uncommitted" : commit, candidateDirty: dirty, candidateStateDigest: await candidateStateDigest(), promotionEligible: false, report };
  await writeFile(outputPath, `${JSON.stringify(evidenceDocument, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ profile: report.profile, evidencePath: relative.replaceAll(path.sep, "/"), candidateSha: evidenceDocument.candidateSha, candidateDirty: evidenceDocument.candidateDirty, productGate: report.productGate }, null, 2));
}
