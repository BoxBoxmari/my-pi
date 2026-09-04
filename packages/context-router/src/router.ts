import type { CoordinationEvent } from "@my-pi/contracts";
import type { ContextRouteResult, ContextRouterInput, RoutedEvent } from "./model.js";

const DEFAULT_MAX_EVENTS = 100;
const DEFAULT_MAX_BYTES = 256 * 1024;

function payload(event: CoordinationEvent): Record<string, unknown> {
  return event.payload !== null && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
}

function serializedBytes(event: CoordinationEvent): number {
  return Buffer.byteLength(JSON.stringify(event, (_key, value) => typeof value === "bigint" ? value.toString() : value), "utf8");
}

function impactWorkItemIds(event: CoordinationEvent): Set<string> {
  if (event.eventType !== "ImpactDetected" || event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) return new Set();
  const values = (event.payload as Record<string, unknown>).affectedWorkItems;
  if (!Array.isArray(values)) return new Set();
  return new Set(values.flatMap((value) => value && typeof value === "object" && typeof (value as Record<string, unknown>).workItemId === "string" ? [(value as Record<string, unknown>).workItemId as string] : []));
}

function impactAgentMatches(event: CoordinationEvent, agentSessionId: string): boolean {
  if (event.eventType !== "ImpactDetected" || event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) return false;
  const values = (event.payload as Record<string, unknown>).affectedAgents;
  return Array.isArray(values) && values.some((value) => value && typeof value === "object" && (value as Record<string, unknown>).agentSessionId === agentSessionId);
}

function supersededArtifactIds(events: CoordinationEvent[]): Set<string> {
  const superseded = new Set<string>();
  for (const event of events) {
    if (event.eventType !== "ContextPublished" || event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) continue;
    const value = event.payload as Record<string, unknown>;
    if (typeof value.supersedes === "string") superseded.add(value.supersedes);
  }
  return superseded;
}

export class ContextRouter {
  route(input: ContextRouterInput): ContextRouteResult {
    const maxEvents = input.maxEvents ?? DEFAULT_MAX_EVENTS;
    const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 1000) throw new RangeError("maxEvents is out of bounds");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 * 1024) throw new RangeError("maxBytes is out of bounds");
    const current = new Set(input.currentWorkItemIds);
    const dependencies = new Set(input.dependencyWorkItemIds ?? []);
    const impacted = new Set((input.impactResults ?? []).flatMap((result) => result.affectedWorkItems.map((item) => item.workItemId)));
    const seenEventIds = new Set<string>();
    const superseded = supersededArtifactIds(input.events);
    const highPriority: RoutedEvent[] = [];
    const normalPriority: RoutedEvent[] = [];
    let bytes = 0;
    let truncated = input.events.length > maxEvents;
    let throughSequence = input.events.length > 0 ? input.events[0]!.sequence - 1n : (input.sinceSequence ?? 0n);
    for (const event of input.events.slice(0, maxEvents)) {
      if (seenEventIds.has(event.eventId)) {
        throughSequence = event.sequence;
        continue;
      }
      seenEventIds.add(event.eventId);
      if (event.eventType === "ContextPublished" && payload(event).id && superseded.has(String(payload(event).id))) {
        throughSequence = event.sequence;
        continue;
      }
      const itemPayload = payload(event);
      const directAgent = itemPayload.agentSessionId === input.agentSessionId || itemPayload.authorAgentSessionId === input.agentSessionId || itemPayload.sessionId === input.agentSessionId || itemPayload.assignee === input.agentSessionId;
      const workItemId = typeof itemPayload.workItemId === "string" ? itemPayload.workItemId : event.eventType.startsWith("WorkItem") && typeof itemPayload.id === "string" ? itemPayload.id : undefined;
      const impactedWorkItems = impactWorkItemIds(event);
      let routed: RoutedEvent | undefined;
      if (directAgent) routed = { event, priority: "high", reason: "same_agent" };
      else if (workItemId && current.has(workItemId as never)) routed = { event, priority: "high", reason: "same_work_item" };
      else if (workItemId && dependencies.has(workItemId as never)) routed = { event, priority: "normal", reason: "dependency_work_item" };
      else if (workItemId && impacted.has(workItemId as never)) routed = { event, priority: "normal", reason: "impact_result" };
      else if (impactAgentMatches(event, input.agentSessionId)) routed = { event, priority: "high", reason: "impact_result" };
      else if ([...impactedWorkItems].some((id) => current.has(id as never))) routed = { event, priority: "high", reason: "impact_result" };
      else if ([...impactedWorkItems].some((id) => dependencies.has(id as never))) routed = { event, priority: "normal", reason: "impact_result" };
      if (!routed) {
        throughSequence = event.sequence;
        continue;
      }
      const eventBytes = serializedBytes(event);
      if (bytes + eventBytes > maxBytes) {
        truncated = true;
        break;
      }
      bytes += eventBytes;
      (routed.priority === "high" ? highPriority : normalPriority).push(routed);
      throughSequence = event.sequence;
    }
    return { highPriority, normalPriority, throughSequence, truncated };
  }
}
