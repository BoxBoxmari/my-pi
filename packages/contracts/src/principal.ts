import type { AgentSessionId, PrincipalId } from "./ids.js";

/** Protocol-neutral reference to a versioned policy definition. */
export interface PolicyRef {
  id: string;
  version?: string;
}

/** A principal is populated only by an authenticated adapter or control plane. */
export interface PrincipalRef {
  id: PrincipalId;
  kind: "human" | "workload" | "service" | "agent-session-attribution";
  source: "authenticated-adapter" | "enterprise-control-plane";
}

export type ActorRef =
  | { kind: "agent_session"; id: AgentSessionId }
  | { kind: "principal"; id: PrincipalId }
  | { kind: "system"; name: string };
