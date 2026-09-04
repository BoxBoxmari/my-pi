import { createHash } from "node:crypto";
import { createEvaluationSpecId, err, type AcceptancePolicy, type EvaluationCriterion, type EvaluationSpec, type ProjectId } from "@my-pi/contracts";
import { validateCriteria } from "./criterion.js";

export interface EvaluationSpecInput {
  name: string;
  criteria: EvaluationCriterion[];
  acceptancePolicy?: Partial<AcceptancePolicy>;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function specDigest(input: { name: string; version: number; criteria: EvaluationCriterion[]; acceptancePolicy: AcceptancePolicy }): string {
  return createHash("sha256").update(stableJson(input), "utf8").digest("hex");
}

export function makeEvaluationSpec(projectId: ProjectId, input: EvaluationSpecInput, version = 1, createdAt = new Date().toISOString()): EvaluationSpec {
  if (!input.name || input.name.length > 256) throw err.evaluationSpecInvalid("evaluation spec name is required and bounded");
  validateCriteria(input.criteria);
  const acceptancePolicy: AcceptancePolicy = { requiredCriteria: "all", allowManualOverride: input.acceptancePolicy?.allowManualOverride === true };
  const digest = specDigest({ name: input.name, version, criteria: input.criteria, acceptancePolicy });
  return { id: createEvaluationSpecId(), projectId, version, name: input.name, criteria: input.criteria, acceptancePolicy, specDigest: digest, createdAt };
}

export function canonicalSpecJson(spec: EvaluationSpec): string {
  return stableJson({ name: spec.name, version: spec.version, criteria: spec.criteria, acceptancePolicy: spec.acceptancePolicy });
}
