import type { ContextArtifact, ContextArtifactKind } from "@my-pi/contracts";
import type { AgentSessionId, CodeEntityId, ContextArtifactId, ScopeId, WorkItemId } from "@my-pi/contracts";

export interface PublishInput {
  agentSessionId: AgentSessionId;
  workItemId?: WorkItemId;
  kind: ContextArtifactKind;
  contentDigest: string;
  scopeIds?: ScopeId[];
  codeEntityIds?: CodeEntityId[];
  classification: string;
  retention: string;
  supersedes?: ContextArtifactId;
}

const ARTIFACT_KINDS = new Set<ContextArtifactKind>(["decision", "constraint", "interface_contract", "finding", "task_result", "failure", "handoff", "verification"]);

export function validatePublishInput(input: PublishInput): void {
  if (!ARTIFACT_KINDS.has(input.kind)) throw new Error("context artifact kind is invalid");
  if (!/^[a-zA-Z0-9:_-]{8,256}$/.test(input.contentDigest)) throw new Error("contentDigest must be a bounded digest reference");
  if (!input.classification || input.classification.length > 64 || !input.retention || input.retention.length > 128) throw new Error("artifact classification and retention are required and bounded");
  if ((input.scopeIds?.length ?? 0) > 100 || (input.codeEntityIds?.length ?? 0) > 100) throw new Error("artifact link count exceeds the limit");
}

export function artifactFromInput(input: PublishInput, projectId: string, id: ContextArtifactId, createdAt: string): ContextArtifact {
  return {
    id,
    kind: input.kind,
    authorAgentSessionId: input.agentSessionId,
    ...(input.workItemId === undefined ? {} : { workItemId: input.workItemId }),
    scopeIds: input.scopeIds ?? [],
    codeEntityIds: input.codeEntityIds ?? [],
    contentDigest: input.contentDigest,
    classification: input.classification,
    retention: input.retention,
    createdAt,
    ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
  };
}
