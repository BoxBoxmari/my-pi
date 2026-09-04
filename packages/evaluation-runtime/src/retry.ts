import type { EvaluationRun, RetryCycle } from "@my-pi/contracts";

export function makeRetryCycle(run: EvaluationRun, state: RetryCycle["state"], reasonCodes: string[], constraints: string[], maxAttempts = 3, updatedAt = new Date().toISOString()): RetryCycle {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("maxAttempts must be between 1 and 10");
  const boundedState = run.attempt >= maxAttempts && state === "recommended" ? "exhausted" : state;
  return { id: `retry_${run.id}_${run.attempt}`, runId: run.id, attempt: run.attempt, maxAttempts, state: boundedState, reasonCodes: reasonCodes.slice(0, 100), constraints: constraints.slice(0, 100), updatedAt };
}
