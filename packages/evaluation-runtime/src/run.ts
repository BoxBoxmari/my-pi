import { createEvaluationRunId, type EvaluationRun, type EvaluationSpec, type IntentId, type WorkItemId, type ChangeReceiptId } from "@my-pi/contracts";

export interface EvaluationRunInput {
  spec: EvaluationSpec;
  workItemId: WorkItemId;
  intentId?: IntentId;
  changeReceiptId?: ChangeReceiptId;
  repositoryStateRef: string;
  attempt?: number;
}

export function makeEvaluationRun(input: EvaluationRunInput, createdAt = new Date().toISOString()): EvaluationRun {
  if (!input.repositoryStateRef || input.repositoryStateRef.length > 1024) throw new Error("repositoryStateRef is required and bounded");
  const attempt = input.attempt ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 100) throw new Error("evaluation attempt is out of bounds");
  return {
    id: createEvaluationRunId(),
    specId: input.spec.id,
    specVersion: input.spec.version,
    workItemId: input.workItemId,
    ...(input.intentId === undefined ? {} : { intentId: input.intentId }),
    ...(input.changeReceiptId === undefined ? {} : { changeReceiptId: input.changeReceiptId }),
    repositoryStateRef: input.repositoryStateRef,
    attempt,
    state: "pending",
    startedAt: createdAt,
  };
}
