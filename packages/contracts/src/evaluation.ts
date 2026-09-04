import type { ArtifactId } from "./ids.js";
import type { ChangeReceiptId, EvaluationRunId, EvaluationSpecId, IntentId, ProjectId, WorkItemId } from "./ids.js";

export type EvaluationCriterionKind = "test" | "diagnostic" | "policy" | "performance" | "artifact" | "external";
export type EvaluationSeverity = "info" | "warning" | "error" | "critical";
export type EvaluationRunState = "pending" | "running" | "completed" | "cancelled" | "expired";
export type EvaluationOutcome = "pass" | "fail" | "error" | "skipped" | "inconclusive";
export type AcceptanceDecisionKind = "accepted" | "rejected" | "inconclusive" | "review_required";

export interface AcceptancePolicy {
  requiredCriteria: "all";
  allowManualOverride: boolean;
}

export interface EvaluationCriterion {
  id: string;
  kind: EvaluationCriterionKind;
  required: boolean;
  severity: EvaluationSeverity;
  evaluatorRef: string;
  expected: unknown;
}

export interface EvaluationSpec {
  id: EvaluationSpecId;
  projectId: ProjectId;
  version: number;
  name: string;
  criteria: EvaluationCriterion[];
  acceptancePolicy: AcceptancePolicy;
  specDigest: string;
  createdAt: string;
}

export interface EvidenceRef {
  artifactId?: ArtifactId;
  provider: string;
  digest: string;
  targetStateRef: string;
  observedAt: string;
}

export interface EvaluationRun {
  id: EvaluationRunId;
  specId: EvaluationSpecId;
  specVersion: number;
  workItemId: WorkItemId;
  intentId?: IntentId;
  changeReceiptId?: ChangeReceiptId;
  repositoryStateRef: string;
  attempt: number;
  state: EvaluationRunState;
  startedAt?: string;
  completedAt?: string;
}

export interface EvaluationResult {
  criterionId: string;
  outcome: EvaluationOutcome;
  evidence: EvidenceRef[];
  observed?: unknown;
  reasonCode?: string;
}

export interface AcceptanceDecision {
  runId: EvaluationRunId;
  decision: AcceptanceDecisionKind;
  decisionDigest: string;
  reasons: string[];
}
