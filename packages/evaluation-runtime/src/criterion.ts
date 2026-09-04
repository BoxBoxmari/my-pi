import type { EvaluationCriterion } from "@my-pi/contracts";

export function validateCriteria(criteria: EvaluationCriterion[]): void {
  if (criteria.length === 0 || criteria.length > 100) throw new Error("evaluation criteria count must be between 1 and 100");
  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (!criterion.id || criterion.id.length > 128 || ids.has(criterion.id)) throw new Error("evaluation criterion IDs must be unique and bounded");
    if (!criterion.evaluatorRef || criterion.evaluatorRef.length > 256) throw new Error("evaluation criterion evaluatorRef is required and bounded");
    ids.add(criterion.id);
  }
}
