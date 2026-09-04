import type { CoordinationEvent } from "@my-pi/contracts";
import type { AgentSessionId, WorkItemId } from "@my-pi/contracts";
import type { ImpactResult } from "@my-pi/impact-engine";

export interface ContextRouterInput {
  agentSessionId: AgentSessionId;
  currentWorkItemIds: WorkItemId[];
  dependencyWorkItemIds?: WorkItemId[];
  sinceSequence?: bigint;
  events: CoordinationEvent[];
  impactResults?: ImpactResult[];
  maxEvents?: number;
  maxBytes?: number;
}

export interface RoutedEvent {
  event: CoordinationEvent;
  priority: "high" | "normal";
  reason: "same_agent" | "same_work_item" | "dependency_work_item" | "impact_result";
}

export interface ContextRouteResult {
  highPriority: RoutedEvent[];
  normalPriority: RoutedEvent[];
  throughSequence: bigint;
  truncated: boolean;
}
