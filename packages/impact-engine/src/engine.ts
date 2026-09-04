import { createHash } from "node:crypto";
import type { CodeEdge, CodeEntity, Intent, ScopeRef, WorkDependency, WorkItem } from "@my-pi/contracts";
import type { AffectedAgent, AffectedEntity, AffectedWorkItem, ImpactBounds, ImpactInput, ImpactReason, ImpactResult } from "./model.js";

const DEFAULT_BOUNDS: Required<ImpactBounds> = {
  maxDepth: 3,
  maxEntities: 500,
  allowedEdgeKinds: ["contains", "imports", "references", "calls", "tests"],
  minimumConfidence: "medium",
};

const CONFIDENCE_RANK = { exact: 4, strong: 3, medium: 2, weak: 1 } as const;

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function hashGraph(entities: CodeEntity[], edges: CodeEdge[]): string {
  const canonical = JSON.stringify({
    entities: entities.map((entity) => [entity.stableKey, entity.fingerprint?.digest ?? "", entity.observedAt]).sort(),
    edges: edges.map((edge) => [edge.from, edge.to, edge.kind, edge.confidence, edge.provider, edge.observedAt]).sort(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24);
}

function scopeMatches(entity: CodeEntity, scope: ScopeRef): boolean {
  const entityPath = entity.path ? normalizePath(entity.path) : "";
  switch (scope.type) {
    case "path":
      return entityPath === normalizePath(scope.value);
    case "directory": {
      const directory = normalizePath(scope.value);
      return entityPath === directory || entityPath.startsWith(`${directory}/`);
    }
    case "module":
      return entity.kind === "module" && (entity.displayName === scope.value || entity.stableKey.includes(`|${scope.value}`));
    case "package":
      return entityPath === normalizePath(scope.value) || entityPath.startsWith(`${normalizePath(scope.value)}/`);
    case "symbol":
      return entity.id === scope.entityId;
  }
}

function reason(code: ImpactReason["code"], score: number, explanation: string, entityPath?: string[]): ImpactReason {
  return { code, score, explanation, ...(entityPath === undefined ? {} : { entityPath }) };
}

function mergeReasons(reasons: ImpactReason[]): ImpactReason[] {
  const byKey = new Map<string, ImpactReason>();
  for (const current of reasons) {
    const key = `${current.code}|${current.explanation}`;
    const previous = byKey.get(key);
    if (!previous || current.score > previous.score) byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
}

function targetEntities(intent: Intent | undefined, entities: CodeEntity[]): CodeEntity[] {
  if (!intent) return [];
  return entities.filter((entity) => intent.targets.some((scope) => scopeMatches(entity, scope)));
}

function graphTraversal(targets: CodeEntity[], entities: CodeEntity[], edges: CodeEdge[], bounds: Required<ImpactBounds>): { entities: Map<string, { entity: CodeEntity; score: number; reasons: ImpactReason[] }>; truncated: boolean } {
  const byId = new Map(entities.map((entity) => [entity.id, entity] as const));
  const inbound = new Map<string, CodeEdge[]>();
  const outbound = new Map<string, CodeEdge[]>();
  for (const edge of edges) {
    if (!bounds.allowedEdgeKinds.includes(edge.kind) || CONFIDENCE_RANK[edge.confidence] < CONFIDENCE_RANK[bounds.minimumConfidence]) continue;
    const incoming = inbound.get(edge.to) ?? [];
    incoming.push(edge);
    inbound.set(edge.to, incoming);
    const outgoing = outbound.get(edge.from) ?? [];
    outgoing.push(edge);
    outbound.set(edge.from, outgoing);
  }
  const found = new Map<string, { entity: CodeEntity; score: number; reasons: ImpactReason[] }>();
  const queue = targets.map((entity) => ({ id: entity.id as string, depth: 0, path: [entity.id as string] }));
  for (const target of targets) found.set(target.id, { entity: target, score: 95, reasons: [reason("exact_scope_overlap", 95, `intent scope exactly matches ${target.displayName}`, [target.id])] });
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= bounds.maxDepth) continue;
    const adjacent = [...(inbound.get(current.id) ?? []), ...(outbound.get(current.id) ?? [])];
    for (const edge of adjacent) {
      const nextId = edge.from === current.id ? edge.to : edge.from;
      const next = byId.get(nextId);
      if (!next) continue;
      const nextPath = [...current.path, next.id as string];
      const score = Math.max(1, 80 - current.depth * 15 - (edge.kind === "calls" ? 10 : 0));
      const currentFound = found.get(next.id);
      const nextReason = reason("graph_edge", score, `${edge.kind} ${edge.confidence} edge from ${current.id} to ${next.id}`, nextPath);
      if (currentFound) {
        currentFound.score = Math.max(currentFound.score, score);
        currentFound.reasons.push(nextReason);
        continue;
      }
      if (found.size >= bounds.maxEntities) {
        truncated = true;
        continue;
      }
      found.set(next.id, { entity: next, score, reasons: [nextReason] });
      queue.push({ id: next.id as string, depth: current.depth + 1, path: nextPath });
    }
  }
  return { entities: found, truncated };
}

function workItemReasons(input: ImpactInput, impacted: Map<string, { entity: CodeEntity; score: number; reasons: ImpactReason[] }>): Map<string, ImpactReason[]> {
  const reasons = new Map<string, ImpactReason[]>();
  const intentWorkItemId = input.intent?.workItemId;
  for (const item of input.workItems) {
    const itemReasons: ImpactReason[] = [];
    if (intentWorkItemId && item.id === intentWorkItemId) itemReasons.push(reason("same_work_item", 100, "the intent belongs to this work item"));
    for (const dependency of input.dependencies ?? []) {
      if (intentWorkItemId !== dependency.from && intentWorkItemId !== dependency.to) continue;
      const related = dependency.from === item.id || dependency.to === item.id;
      if (related) itemReasons.push(reason("explicit_work_dependency", 100, `explicit ${dependency.type} dependency connects this work item to the intent work item`));
    }
    for (const activeIntent of input.activeIntents ?? []) {
      if (activeIntent.workItemId !== item.id) continue;
      const overlap = [...impacted.values()].filter(({ entity }) => activeIntent.targets.some((scope) => scopeMatches(entity, scope)));
      if (overlap.length > 0) itemReasons.push(reason("exact_scope_overlap", 95, `active intent for this work item overlaps ${overlap.length} impacted code entities`));
    }
    if (itemReasons.length > 0) reasons.set(item.id, itemReasons);
  }
  return reasons;
}

export class ImpactEngine {
  compute(input: ImpactInput): ImpactResult {
    const bounds = { ...DEFAULT_BOUNDS, ...input.bounds };
    if (!Number.isSafeInteger(bounds.maxDepth) || bounds.maxDepth < 0 || bounds.maxDepth > 20) throw new RangeError("maxDepth must be between 0 and 20");
    if (!Number.isSafeInteger(bounds.maxEntities) || bounds.maxEntities < 1 || bounds.maxEntities > 100_000) throw new RangeError("maxEntities is out of bounds");
    const targets = targetEntities(input.intent, input.entities);
    const traversal = graphTraversal(targets, input.entities, input.edges, bounds);
    const workReasons = workItemReasons(input, traversal.entities);
    const affectedWorkItems: AffectedWorkItem[] = input.workItems.flatMap((item) => {
      const itemReasons = mergeReasons(workReasons.get(item.id) ?? []);
      if (itemReasons.length === 0) return [];
      return [{ workItemId: item.id, score: Math.max(...itemReasons.map((itemReason) => itemReason.score)), reasons: itemReasons }];
    }).sort((a, b) => b.score - a.score || String(a.workItemId).localeCompare(String(b.workItemId)));
    const affectedEntities: AffectedEntity[] = [...traversal.entities.values()].map(({ entity, score, reasons }) => ({ entityId: entity.id, score, reasons: mergeReasons(reasons) })).sort((a, b) => b.score - a.score || String(a.entityId).localeCompare(String(b.entityId)));
    const agentMap = new Map<string, { score: number; reasons: ImpactReason[] }>();
    for (const item of input.workItems) {
      if (!item.assignee || !affectedWorkItems.some((affected) => affected.workItemId === item.id)) continue;
      const previous = agentMap.get(item.assignee) ?? { score: 0, reasons: [] };
      const itemImpact = affectedWorkItems.find((affected) => affected.workItemId === item.id)!;
      previous.score = Math.max(previous.score, itemImpact.score);
      previous.reasons.push(...itemImpact.reasons);
      agentMap.set(item.assignee, previous);
    }
    const affectedAgents: AffectedAgent[] = [...agentMap.entries()].map(([agentSessionId, value]) => ({ agentSessionId: agentSessionId as NonNullable<WorkItem["assignee"]>, score: value.score, reasons: mergeReasons(value.reasons) })).sort((a, b) => b.score - a.score || String(a.agentSessionId).localeCompare(String(b.agentSessionId)));
    const reasons = mergeReasons([...affectedEntities.flatMap((entity) => entity.reasons), ...affectedWorkItems.flatMap((item) => item.reasons)]);
    const confidence = targets.length === 0 ? 0 : Math.round((targets.length / Math.max(targets.length, traversal.entities.size)) * 1000) / 1000;
    return { subject: input.subject, affectedWorkItems, affectedAgents, affectedEntities, confidence, reasons, graphVersion: hashGraph(input.entities, input.edges), truncated: traversal.truncated };
  }
}
