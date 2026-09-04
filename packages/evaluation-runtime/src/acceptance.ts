import { createHash } from "node:crypto";
import type { AcceptanceDecisionKind, EvaluationResult, EvaluationSpec } from "@my-pi/contracts";
import type { StoredEvaluationResult } from "./result.js";

export interface AcceptanceEvaluation {
  decision: AcceptanceDecisionKind;
  decisionDigest: string;
  reasons: string[];
  failedCriteria: string[];
  inconclusiveCriteria: string[];
}

export function evaluateAcceptance(spec: EvaluationSpec, targetStateRef: string, results: StoredEvaluationResult[]): AcceptanceEvaluation {
  const byCriterion = new Map<string, StoredEvaluationResult[]>();
  for (const result of results) byCriterion.set(result.criterionId, [...(byCriterion.get(result.criterionId) ?? []), result]);
  const failedCriteria: string[] = [];
  const inconclusiveCriteria: string[] = [];
  const reasons: string[] = [];
  for (const criterion of spec.criteria) {
    const criterionResults = byCriterion.get(criterion.id) ?? [];
    if (!criterion.required) continue;
    if (criterionResults.length === 0) {
      inconclusiveCriteria.push(criterion.id);
      reasons.push(`${criterion.id}: missing required evidence`);
      continue;
    }
    if (criterionResults.some((stored) => stored.result.outcome === "fail")) {
      failedCriteria.push(criterion.id);
      reasons.push(`${criterion.id}: criterion failed`);
      continue;
    }
    if (criterionResults.some((stored) => stored.result.evidence.length === 0)) {
      inconclusiveCriteria.push(criterion.id);
      reasons.push(`${criterion.id}: required evidence is empty`);
      continue;
    }
    if (criterionResults.some((stored) => stored.result.evidence.some((evidence) => evidence.targetStateRef !== targetStateRef))) {
      inconclusiveCriteria.push(criterion.id);
      reasons.push(`${criterion.id}: stale target-state evidence`);
      continue;
    }
    if (criterionResults.some((stored) => stored.result.outcome !== "pass")) {
      inconclusiveCriteria.push(criterion.id);
      reasons.push(`${criterion.id}: one or more outcomes are not acceptance`);
    }
  }
  const decision: AcceptanceDecisionKind = failedCriteria.length > 0 ? "rejected" : inconclusiveCriteria.length > 0 ? "inconclusive" : "accepted";
  const decisionDigest = createHash("sha256").update(JSON.stringify({ specDigest: spec.specDigest, targetStateRef, outcomes: results.map((result) => [result.criterionId, result.result.outcome, result.resultDigest]).sort() }), "utf8").digest("hex");
  return { decision, decisionDigest, reasons, failedCriteria, inconclusiveCriteria };
}
