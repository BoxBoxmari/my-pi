import type { CodeEntityId, EvaluationRunId, FeedbackPacketId, IntentId, WorkItemId } from "./ids.js";
import type { EvidenceRef } from "./evaluation.js";

export interface FeedbackPacket {
  id: FeedbackPacketId;
  runId: EvaluationRunId;
  workItemId: WorkItemId;
  failedCriteria: string[];
  inconclusiveCriteria: string[];
  reasonCodes: string[];
  affectedEntities: CodeEntityId[];
  evidence: EvidenceRef[];
  conciseSummary: string;
  retryConstraints?: string[];
  priorPassesThatMustNotRegress?: string[];
}

export type RetryCycleState = "none" | "recommended" | "scheduled" | "active" | "succeeded" | "exhausted" | "cancelled" | "review_required";

export interface RetryCycle {
  id: string;
  runId: EvaluationRunId;
  attempt: number;
  maxAttempts: number;
  state: RetryCycleState;
  reasonCodes: string[];
  constraints: string[];
  nextIntentId?: IntentId;
  updatedAt: string;
}
