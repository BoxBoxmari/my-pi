import type { AgentSessionId, EvaluationRunId, EvaluationSpecId, ProjectId, WorkItemId } from "./ids.js";

export type WorkItemState =
  | "ready"
  | "claimed"
  | "active"
  | "implementation_complete"
  | "awaiting_evaluation"
  | "accepted"
  | "needs_retry"
  | "review_required"
  | "blocked"
  | "done"
  | "cancelled";

/** Lightweight coordination unit, intentionally not a project-management ticket. */
export interface WorkItem {
  id: WorkItemId;
  projectId: ProjectId;
  parentId?: WorkItemId;
  title: string;
  summary?: string;
  state: WorkItemState;
  assignee?: AgentSessionId;
  /** When present, the item cannot become done without an accepted run for this spec. */
  evaluationSpecId?: EvaluationSpecId;
  /** The exact accepted evaluation run that authorized the final done transition. */
  acceptedEvaluationRunId?: EvaluationRunId;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemRef {
  id: WorkItemId;
  title: string;
  state?: WorkItemState;
}

export type WorkDependencyType = "depends_on" | "blocks" | "implements" | "verifies";

export interface WorkDependency {
  from: WorkItemId;
  to: WorkItemId;
  type: WorkDependencyType;
}
