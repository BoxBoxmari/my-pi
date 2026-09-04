import type { AgentSessionId, CodeEntityId, ContextArtifactId, ScopeId, WorkItemId } from "./ids.js";

export type ContextArtifactKind = "decision" | "constraint" | "interface_contract" | "finding" | "task_result" | "failure" | "handoff" | "verification";

export interface ContextArtifact {
  id: ContextArtifactId;
  kind: ContextArtifactKind;
  authorAgentSessionId: AgentSessionId;
  workItemId?: WorkItemId;
  scopeIds: ScopeId[];
  codeEntityIds: CodeEntityId[];
  contentDigest: string;
  classification: string;
  retention: string;
  createdAt: string;
  supersedes?: ContextArtifactId;
}
