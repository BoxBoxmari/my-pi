import type { Project, Repository, Worktree } from "@my-pi/contracts";
import type { AgentSessionId, ProjectId } from "@my-pi/contracts";

export interface JoinInput {
  project?: Pick<Project, "displayName" | "policyRef">;
  repository: Repository;
  worktree: Worktree;
  host: string;
  clientInstance?: string;
  role?: string;
}

export interface JoinResult {
  projectHandle: { projectId: ProjectId };
  agentSessionId: AgentSessionId;
  currentSequence: bigint;
  lease: { leaseMs: number; expiresAt: string };
}

export function validateJoinInput(input: JoinInput, projectId: ProjectId): void {
  if (!input.host || input.host.length > 128) throw new Error("host is required and must be bounded");
  if (input.repository.projectId !== projectId) throw new Error("repository does not belong to the daemon project");
  if (input.worktree.repositoryId !== input.repository.id) throw new Error("worktree does not belong to the repository");
  if (!input.worktree.root || input.worktree.root.length > 4096) throw new Error("worktree root is required and must be bounded");
}
