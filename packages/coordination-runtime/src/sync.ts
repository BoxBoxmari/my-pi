import type { CoordinationEvent, WorkItemRef } from "@my-pi/contracts";
import type { AgentSessionId, ProjectId, WorkItemId } from "@my-pi/contracts";
import type { CodeStateSnapshot } from "@my-pi/coordination-store";

export interface CoordinationSyncRequest {
  agentSessionId: AgentSessionId;
  sinceSequence?: bigint;
  maxEvents?: number;
  maxBytes?: number;
  codeState?: CodeStateSnapshot;
}

export interface RoutedContextItem {
  event: CoordinationEvent;
  priority: "high" | "normal";
  reason: "same_agent" | "same_work_item" | "dependency_work_item" | "published_artifact" | "impact_result";
}

export interface CoordinationSyncResult {
  projectId: ProjectId;
  throughSequence: bigint;
  highPriority: RoutedContextItem[];
  normalPriority: RoutedContextItem[];
  blockedBy: WorkItemRef[];
  warnings: string[];
}

export function payloadRecord(event: CoordinationEvent): Record<string, unknown> {
  return event.payload !== null && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

export function eventWorkItemId(event: CoordinationEvent): string | undefined {
  const payload = payloadRecord(event);
  const value = payload.workItemId ?? (event.eventType.startsWith("WorkItem") ? payload.id : undefined);
  return typeof value === "string" ? value : undefined;
}

export function routeEvent(event: CoordinationEvent, agentSessionId: AgentSessionId, workItemIds: Set<WorkItemId>, dependencyWorkItemIds: Set<WorkItemId>): RoutedContextItem | undefined {
  const payload = payloadRecord(event);
  const directAgent = payload.agentSessionId === agentSessionId || payload.sessionId === agentSessionId || payload.assignee === agentSessionId;
  if (directAgent) return { event, priority: "high", reason: "same_agent" };
  const workItemId = eventWorkItemId(event);
  if (workItemId && workItemIds.has(workItemId as WorkItemId)) return { event, priority: "high", reason: "same_work_item" };
  if (workItemId && dependencyWorkItemIds.has(workItemId as WorkItemId)) return { event, priority: "normal", reason: "dependency_work_item" };
  if (event.eventType === "ContextPublished" && typeof payload.workItemId === "string" && dependencyWorkItemIds.has(payload.workItemId as WorkItemId)) {
    return { event, priority: "normal", reason: "published_artifact" };
  }
  if (event.eventType === "ImpactDetected") {
    const affectedAgents = Array.isArray(payload.affectedAgents) ? payload.affectedAgents : [];
    if (affectedAgents.some((value) => value && typeof value === "object" && (value as Record<string, unknown>).agentSessionId === agentSessionId)) {
      return { event, priority: "high", reason: "impact_result" };
    }
    const affectedWorkItems = Array.isArray(payload.affectedWorkItems) ? payload.affectedWorkItems : [];
    if (affectedWorkItems.some((value) => value && typeof value === "object" && workItemIds.has((value as Record<string, unknown>).workItemId as WorkItemId))) {
      return { event, priority: "high", reason: "impact_result" };
    }
    if (affectedWorkItems.some((value) => value && typeof value === "object" && dependencyWorkItemIds.has((value as Record<string, unknown>).workItemId as WorkItemId))) {
      return { event, priority: "normal", reason: "impact_result" };
    }
  }
  return undefined;
}
