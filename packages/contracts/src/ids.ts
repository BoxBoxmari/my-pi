/**
 * Opaque, branded identifier types. Explicit application state uses these IDs;
 * no application correctness may depend on transport connection identity or
 * Mcp-Session-Id (architecture invariant).
 */
import { randomUUID } from "node:crypto";

declare const workspaceIdBrand: unique symbol;
declare const snapshotIdBrand: unique symbol;
declare const artifactIdBrand: unique symbol;
declare const requestIdBrand: unique symbol;
declare const projectIdBrand: unique symbol;
declare const repositoryIdBrand: unique symbol;
declare const worktreeIdBrand: unique symbol;
declare const agentSessionIdBrand: unique symbol;
declare const workItemIdBrand: unique symbol;
declare const intentIdBrand: unique symbol;
declare const scopeIdBrand: unique symbol;
declare const codeEntityIdBrand: unique symbol;
declare const eventIdBrand: unique symbol;
declare const contextArtifactIdBrand: unique symbol;
declare const changeProposalIdBrand: unique symbol;
declare const changeReceiptIdBrand: unique symbol;
declare const evaluationSpecIdBrand: unique symbol;
declare const evaluationRunIdBrand: unique symbol;
declare const feedbackPacketIdBrand: unique symbol;
declare const principalIdBrand: unique symbol;

export type WorkspaceId = string & { [workspaceIdBrand]: true };
export type SnapshotId = string & { [snapshotIdBrand]: true };
export type ArtifactId = string & { [artifactIdBrand]: true };
export type RequestId = string & { [requestIdBrand]: true };
export type ProjectId = string & { [projectIdBrand]: true };
export type RepositoryId = string & { [repositoryIdBrand]: true };
export type WorktreeId = string & { [worktreeIdBrand]: true };
export type AgentSessionId = string & { [agentSessionIdBrand]: true };
export type WorkItemId = string & { [workItemIdBrand]: true };
export type IntentId = string & { [intentIdBrand]: true };
export type ScopeId = string & { [scopeIdBrand]: true };
export type CodeEntityId = string & { [codeEntityIdBrand]: true };
export type EventId = string & { [eventIdBrand]: true };
export type ContextArtifactId = string & { [contextArtifactIdBrand]: true };
export type ChangeProposalId = string & { [changeProposalIdBrand]: true };
export type ChangeReceiptId = string & { [changeReceiptIdBrand]: true };
export type EvaluationSpecId = string & { [evaluationSpecIdBrand]: true };
export type EvaluationRunId = string & { [evaluationRunIdBrand]: true };
export type FeedbackPacketId = string & { [feedbackPacketIdBrand]: true };
export type PrincipalId = string & { [principalIdBrand]: true };

export function createWorkspaceId(): WorkspaceId {
  return `ws_${randomUUID().replaceAll("-", "").slice(0, 12)}` as WorkspaceId;
}

export function createSnapshotId(): SnapshotId {
  return `snap_${randomUUID().replaceAll("-", "").slice(0, 12)}` as SnapshotId;
}

export function createArtifactId(): ArtifactId {
  return `art_${randomUUID().replaceAll("-", "").slice(0, 12)}` as ArtifactId;
}

export function createRequestId(): RequestId {
  return `req_${randomUUID().replaceAll("-", "").slice(0, 12)}` as RequestId;
}

function createOpaqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function createProjectId(): ProjectId {
  return createOpaqueId("project") as ProjectId;
}

export function createRepositoryId(): RepositoryId {
  return createOpaqueId("repo") as RepositoryId;
}

export function createWorktreeId(): WorktreeId {
  return createOpaqueId("worktree") as WorktreeId;
}

export function createAgentSessionId(): AgentSessionId {
  return createOpaqueId("session") as AgentSessionId;
}

export function createWorkItemId(): WorkItemId {
  return createOpaqueId("work") as WorkItemId;
}

export function createIntentId(): IntentId {
  return createOpaqueId("intent") as IntentId;
}

export function createScopeId(): ScopeId {
  return createOpaqueId("scope") as ScopeId;
}

export function createCodeEntityId(): CodeEntityId {
  return createOpaqueId("entity") as CodeEntityId;
}

export function createEventId(): EventId {
  return createOpaqueId("event") as EventId;
}

export function createContextArtifactId(): ContextArtifactId {
  return createOpaqueId("context") as ContextArtifactId;
}

export function createChangeProposalId(): ChangeProposalId {
  return createOpaqueId("proposal") as ChangeProposalId;
}

export function createChangeReceiptId(): ChangeReceiptId {
  return createOpaqueId("receipt") as ChangeReceiptId;
}

export function createEvaluationSpecId(): EvaluationSpecId {
  return createOpaqueId("evalspec") as EvaluationSpecId;
}

export function createEvaluationRunId(): EvaluationRunId {
  return createOpaqueId("evalrun") as EvaluationRunId;
}

export function createFeedbackPacketId(): FeedbackPacketId {
  return createOpaqueId("feedback") as FeedbackPacketId;
}

export function createPrincipalId(): PrincipalId {
  return createOpaqueId("principal") as PrincipalId;
}
