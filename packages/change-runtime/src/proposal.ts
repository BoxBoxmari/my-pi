import { createChangeProposalId, type AgentSessionId, type ChangeProposal, type IntentId, type ProjectId, type WorkItemId, type WorktreeId } from "@my-pi/contracts";
import type { ResourcePrecondition } from "./resource-version.js";

export interface ChangeProposalInput {
  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  agentSessionId?: AgentSessionId;
  workItemId?: WorkItemId;
  intentId?: IntentId;
  path: string;
  precondition: ResourcePrecondition;
  payloadDigest?: string;
  planDigest?: string;
}

export function makeChangeProposal(input: ChangeProposalInput, proposedAt = new Date().toISOString()): ChangeProposal {
  return {
    id: createChangeProposalId(),
    projectId: input.projectId ?? ("project_local" as ProjectId),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    agentSessionId: input.agentSessionId ?? ("session_local" as AgentSessionId),
    ...(input.workItemId === undefined ? {} : { workItemId: input.workItemId }),
    ...(input.intentId === undefined ? {} : { intentId: input.intentId }),
    resources: [{ path: input.path, ...(input.precondition.condition === "match" ? { fingerprint: input.precondition.fingerprint } : { absent: true }) }],
    preconditions: [{ path: input.path, ...(input.precondition.condition === "match" ? { fingerprint: input.precondition.fingerprint } : { absent: true }) }],
    ...(input.payloadDigest === undefined ? {} : { payloadDigest: input.payloadDigest }),
    ...(input.planDigest === undefined ? {} : { planDigest: input.planDigest }),
    proposedAt,
  };
}
