import type { AgentSessionId, IntentId, ProjectId, WorkItemId } from "./ids.js";
import type { ScopeRef } from "./scope.js";

export type IntentKind = "modify" | "refactor" | "change_contract" | "add" | "remove" | "verify" | "investigate";
export type IntentState = "active" | "superseded" | "completed" | "cancelled";

/** Immutable declaration of a planned software change. */
export interface Intent {
  id: IntentId;
  projectId: ProjectId;
  agentSessionId: AgentSessionId;
  workItemId?: WorkItemId;
  kind: IntentKind;
  summary: string;
  targets: ScopeRef[];
  state: IntentState;
  createdAt: string;
  expiresAt?: string;
}
