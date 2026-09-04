import type { AgentSessionId, CodeEntityId, ProjectId, ScopeId } from "./ids.js";

export type ScopeRef =
  | { type: "path"; value: string }
  | { type: "directory"; value: string }
  | { type: "module"; value: string }
  | { type: "symbol"; entityId: CodeEntityId }
  | { type: "package"; value: string };

export type ScopeMode = "observe" | "shared" | "exclusive";

/** Scope is an awareness declaration, not automatically a hard lock. */
export interface Scope {
  id: ScopeId;
  projectId: ProjectId;
  agentSessionId: AgentSessionId;
  mode: ScopeMode;
  refs: ScopeRef[];
  createdAt: string;
  releasedAt?: string;
}
