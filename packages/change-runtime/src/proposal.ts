import { createHash } from "node:crypto";
import { createChangeProposalId, type AgentSessionId, type ChangeProposal, type IntentId, type ProjectId, type ResourceVersion, type WorkItemId, type WorktreeId } from "@my-pi/contracts";
import type { ResourcePrecondition } from "./resource-version.js";

export interface ChangeProposalResourceInput {
  path: string;
  precondition: ResourcePrecondition;
  operation?: "create" | "replace";
  payloadDigest?: string;
}

export interface ChangeProposalInput extends ChangeProposalResourceInput {
  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  agentSessionId?: AgentSessionId;
  workItemId?: WorkItemId;
  intentId?: IntentId;
  planDigest?: string;
  policyContext?: { workspaceMode?: "read-only" | "workspace-write" | "review-required" };
}

export interface CompositeChangeProposalInput {
  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  agentSessionId?: AgentSessionId;
  workItemId?: WorkItemId;
  intentId?: IntentId;
  resources: ChangeProposalResourceInput[];
  policyContext?: { workspaceMode?: "read-only" | "workspace-write" | "review-required" };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function versionFromInput(input: ChangeProposalResourceInput): ResourceVersion {
  return {
    path: input.path,
    ...(input.precondition.condition === "match" ? { fingerprint: input.precondition.fingerprint, absent: false } : { absent: true }),
    ...(input.operation === undefined ? {} : { operation: input.operation }),
    ...(input.payloadDigest === undefined ? {} : { payloadDigest: input.payloadDigest }),
  };
}

function metadata(input: CompositeChangeProposalInput | ChangeProposalInput): Pick<ChangeProposal, "projectId" | "worktreeId" | "agentSessionId" | "workItemId" | "intentId" | "policyContext"> {
  return {
    projectId: input.projectId ?? ("project_local" as ProjectId),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    agentSessionId: input.agentSessionId ?? ("session_local" as AgentSessionId),
    ...(input.workItemId === undefined ? {} : { workItemId: input.workItemId }),
    ...(input.intentId === undefined ? {} : { intentId: input.intentId }),
    ...(input.policyContext === undefined ? {} : { policyContext: input.policyContext }),
  };
}

export function makeChangeProposal(input: ChangeProposalInput, proposedAt = new Date().toISOString()): ChangeProposal {
  return makeCompositeChangeProposal({ ...input, resources: [input] }, proposedAt);
}

export function makeCompositeChangeProposal(input: CompositeChangeProposalInput, proposedAt = new Date().toISOString()): ChangeProposal {
  if (input.resources.length === 0 || input.resources.length > 100) throw new Error("a change proposal requires between 1 and 100 resources");
  const resources = input.resources.map(versionFromInput);
  const canonical = { ...metadata(input), resources };
  const planDigest = createHash("sha256").update(stableJson(canonical), "utf8").digest("hex");
  return {
    id: createChangeProposalId(),
    ...metadata(input),
    resources,
    preconditions: resources.map(({ path, fingerprint, absent }) => ({ path, ...(fingerprint === undefined ? { absent: absent === true } : { fingerprint, absent: false }) })),
    planDigest,
    proposedAt,
  };
}
