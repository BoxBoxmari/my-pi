import type { AgentSessionId, EvaluationRunId, WorkItemId } from "@my-pi/contracts";

export interface CompleteInput {
  agentSessionId: AgentSessionId;
  workItemId: WorkItemId;
  /** Optional audit reference for the accepted run used to finish a gated item. */
  evaluationRunId?: EvaluationRunId;
}
