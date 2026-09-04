import type { IntentKind, IntentState, ScopeRef } from "@my-pi/contracts";
import type { AgentSessionId, IntentId, ProjectId, WorkItemId } from "@my-pi/contracts";

export interface DeclareIntentInput {
  agentSessionId: AgentSessionId;
  workItemId?: WorkItemId;
  kind: IntentKind;
  summary: string;
  targets: ScopeRef[];
  expiresAt?: string;
}

export interface IntentDraft {
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

export function validateIntentInput(input: DeclareIntentInput): void {
  if (!input.summary || input.summary.length > 2_000) throw new Error("intent summary is required and must be bounded");
  if (input.targets.length === 0 && input.kind !== "investigate") throw new Error("intent requires at least one scope target");
  if (input.targets.length > 100) throw new Error("intent target count exceeds the limit");
}
