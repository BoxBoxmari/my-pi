import { createHash } from "node:crypto";
import type { EvaluationCriterion, EvaluationOutcome, EvaluationResult, EvaluationRun, EvidenceRef } from "@my-pi/contracts";

export interface EvaluationInput {
  run: EvaluationRun;
  criterion: EvaluationCriterion;
  observed?: unknown;
}

export interface EvaluationProviderResult {
  providerResultId: string;
  criterionId: string;
  outcome: EvaluationOutcome;
  evidence: EvidenceRef[];
  observed?: unknown;
  reasonCode?: string;
}

export interface EvaluatorProvider {
  readonly id: string;
  supports(criterion: EvaluationCriterion): boolean;
  evaluate(input: EvaluationInput, signal: AbortSignal): Promise<EvaluationProviderResult>;
}

/** External evidence is caller-declared and remains unverified; this provider never executes a command. */
export class ExternalEvidenceProvider implements EvaluatorProvider {
  readonly id = "external-evidence";

  supports(criterion: EvaluationCriterion): boolean {
    return criterion.kind === "external";
  }

  async evaluate(_input: EvaluationInput, _signal: AbortSignal): Promise<EvaluationProviderResult> {
    throw new Error("external evidence must be recorded with provider provenance");
  }
}

/** Deterministic local provider for criteria whose expected value is directly comparable. */
export class DeterministicProvider implements EvaluatorProvider {
  readonly id = "deterministic-local";

  supports(criterion: EvaluationCriterion): boolean {
    return criterion.kind === "artifact" || criterion.kind === "policy" || criterion.kind === "performance" || criterion.kind === "test" || criterion.kind === "diagnostic";
  }

  async evaluate(input: EvaluationInput, signal: AbortSignal): Promise<EvaluationProviderResult> {
    signal.throwIfAborted();
    const equal = JSON.stringify(input.observed) === JSON.stringify(input.criterion.expected);
    const observedDigest = createHash("sha256").update(JSON.stringify(input.observed), "utf8").digest("hex");
    const evidence: EvidenceRef[] = [{ provider: this.id, digest: observedDigest, targetStateRef: input.run.repositoryStateRef, observedAt: new Date().toISOString() }];
    const result: EvaluationResult = { criterionId: input.criterion.id, outcome: equal ? "pass" : "fail", evidence, observed: input.observed, ...(equal ? {} : { reasonCode: "EXPECTED_VALUE_MISMATCH" }) };
    return { providerResultId: `${this.id}:${input.criterion.id}:${input.run.attempt}`, criterionId: result.criterionId, outcome: result.outcome, evidence: result.evidence, observed: result.observed, reasonCode: result.reasonCode };
  }
}

/** Deliberately no implementation: arbitrary model-supplied shell is not an evaluator. */
export interface ConfiguredEvaluatorProfile {
  id: string;
  administratorConfigured: true;
  executableDigest: string;
  timeoutMs: number;
}
