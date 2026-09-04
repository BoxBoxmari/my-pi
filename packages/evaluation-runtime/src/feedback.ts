import { createFeedbackPacketId, type CodeEntityId, type EvaluationRun, type FeedbackPacket } from "@my-pi/contracts";
import type { StoredEvaluationResult } from "./result.js";
import type { AcceptanceEvaluation } from "./acceptance.js";

export function makeFeedback(run: EvaluationRun, acceptance: AcceptanceEvaluation, results: StoredEvaluationResult[], affectedEntities: CodeEntityId[] = []): FeedbackPacket | undefined {
  if (acceptance.decision === "accepted") return undefined;
  const evidence = results.flatMap((result) => result.result.evidence).slice(0, 50);
  const summary = acceptance.reasons.slice(0, 20).join("; ").slice(0, 2_000);
  const normalizedReasons = new Set<string>(results.flatMap((result) => result.result.reasonCode ? [result.result.reasonCode] : []));
  for (const criterion of acceptance.failedCriteria) normalizedReasons.add(`CRITERION_FAILED:${criterion}`);
  for (const criterion of acceptance.inconclusiveCriteria) normalizedReasons.add(`CRITERION_INCONCLUSIVE:${criterion}`);
  return {
    id: createFeedbackPacketId(),
    runId: run.id,
    workItemId: run.workItemId,
    failedCriteria: acceptance.failedCriteria.slice(0, 100),
    inconclusiveCriteria: acceptance.inconclusiveCriteria.slice(0, 100),
    reasonCodes: [...normalizedReasons].slice(0, 100),
    affectedEntities: affectedEntities.slice(0, 100),
    evidence,
    conciseSummary: summary || "Evaluation did not reach acceptance.",
    retryConstraints: acceptance.failedCriteria.length > 0 ? ["preserve all previously passing required criteria"] : ["obtain current target-state evidence before retry"],
    priorPassesThatMustNotRegress: results.filter((result) => result.result.outcome === "pass").map((result) => result.criterionId).slice(0, 100),
  };
}
