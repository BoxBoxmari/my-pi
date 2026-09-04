import type { CodeEdge } from "@my-pi/contracts";
import type { CodeGraphDelta } from "./model.js";

function edgeKey(edge: CodeEdge): string {
  return `${edge.from}|${edge.to}|${edge.kind}|${edge.provider}`;
}

export function mergeDeltas(changedPath: string, deltas: CodeGraphDelta[], observedAt = new Date().toISOString()): CodeGraphDelta {
  const entities = new Map<string, CodeGraphDelta["entities"][number]>();
  const edges = new Map<string, CodeEdge>();
  const removedStableKeys = new Set<string>();
  const providerHealth: CodeGraphDelta["providerHealth"] = {};
  for (const delta of deltas) {
    for (const entity of delta.entities) entities.set(entity.stableKey, entity);
    for (const edge of delta.edges) edges.set(edgeKey(edge), edge);
    for (const stableKey of delta.removedStableKeys) removedStableKeys.add(stableKey);
    Object.assign(providerHealth, delta.providerHealth);
  }
  return {
    provider: "composite",
    changedPath,
    entities: [...entities.values()],
    edges: [...edges.values()],
    removedStableKeys: [...removedStableKeys],
    observedAt,
    providerHealth,
  };
}
