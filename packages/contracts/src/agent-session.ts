import type { AgentSessionId, ProjectId, WorktreeId } from "./ids.js";
import type { PrincipalRef } from "./principal.js";

export type AgentSessionStatus = "active" | "idle" | "blocked" | "completed" | "expired";

/** One active coding-agent execution context, not an LLM identity claim. */
export interface AgentSession {
  id: AgentSessionId;
  projectId: ProjectId;
  worktreeId?: WorktreeId;
  host: string;
  clientInstance?: string;
  role?: string;
  status: AgentSessionStatus;
  joinedAt: string;
  heartbeatAt: string;
  identity?: PrincipalRef;
}
