export const GRAPH_SCHEMA_VERSION = "1" as const;

export const GRAPH_KINDS = ["code", "impact", "work", "lineage"] as const;
export type GraphKind = (typeof GRAPH_KINDS)[number];

export type GraphScalar = string | number | boolean | null;
export type GraphAttributes = Record<string, GraphScalar>;
export type GraphProvenance = "authoritative" | "derived";

export interface GraphEvidenceRef {
  type: "source" | "record" | "derived";
  id: string;
  locator?: string;
}

export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  attributes?: GraphAttributes;
  evidence?: GraphEvidenceRef[];
  provenance?: GraphProvenance;
}

export interface GraphEdge {
  id: string;
  kind: string;
  source: string;
  target: string;
  attributes?: GraphAttributes;
  evidence?: GraphEvidenceRef[];
  provenance?: GraphProvenance;
}

export interface GraphBounds {
  maxNodes: number;
  maxEdges: number;
  maxAttributeBytes: number;
}

export interface GraphDegradedState {
  provider: string;
  reason: string;
}

export interface GraphCursor {
  next: string;
}

export interface GraphSnapshot {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  graphVersion: string;
  kind: GraphKind;
  nodes: GraphNode[];
  edges: GraphEdge[];
  bounds: GraphBounds;
  truncated: boolean;
  cursor?: GraphCursor;
  generatedAt?: string;
  degraded?: GraphDegradedState;
}

export const GRAPH_TRACE_SCHEMA_VERSION = "my-pi/graph-trace/v1" as const;

export interface GraphTrace {
  schemaVersion: typeof GRAPH_TRACE_SCHEMA_VERSION;
  graphVersion: string;
  kind: GraphKind;
  fromNodeId: string;
  toNodeId: string;
  maxDepth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  bounds: GraphBounds;
  found: boolean;
  truncated: boolean;
  degraded?: GraphDegradedState;
}

export interface GraphTraceInput {
  snapshot: GraphSnapshot;
  fromNodeId: string;
  toNodeId: string;
  maxDepth?: number;
  bounds?: Partial<GraphBounds>;
}

export interface GraphSnapshotInput {
  graphVersion: string;
  kind: GraphKind;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  bounds?: Partial<GraphBounds>;
  truncated?: boolean;
  cursor?: GraphCursor;
  generatedAt?: string;
  degraded?: GraphDegradedState;
}

const DEFAULT_BOUNDS: GraphBounds = {
  maxNodes: 500,
  maxEdges: 2_000,
  maxAttributeBytes: 4_096,
};

const MAX_NODES = 10_000;
const MAX_EDGES = 50_000;
const MAX_ATTRIBUTE_BYTES = 64 * 1024;
const MAX_TEXT = 4_096;
const MAX_EVIDENCE_REFS = 64;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedText(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  return value;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  return value as number;
}

function normalizeBounds(input: Partial<GraphBounds> | undefined): GraphBounds {
  return {
    maxNodes: boundedInteger(input?.maxNodes ?? DEFAULT_BOUNDS.maxNodes, "bounds.maxNodes", 1, MAX_NODES),
    maxEdges: boundedInteger(input?.maxEdges ?? DEFAULT_BOUNDS.maxEdges, "bounds.maxEdges", 1, MAX_EDGES),
    maxAttributeBytes: boundedInteger(input?.maxAttributeBytes ?? DEFAULT_BOUNDS.maxAttributeBytes, "bounds.maxAttributeBytes", 1, MAX_ATTRIBUTE_BYTES),
  };
}

function normalizeAttributes(attributes: GraphAttributes | undefined, maxBytes: number, label: string): GraphAttributes | undefined {
  if (attributes === undefined) return undefined;
  if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) throw new Error(`${label} must be an object`);
  const result: GraphAttributes = {};
  for (const key of Object.keys(attributes).sort(compareText)) {
    boundedText(key, `${label} key`, 256);
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`${label} contains a reserved key`);
    const value = attributes[key];
    if (value === undefined) throw new Error(`${label}.${key} must be a scalar`);
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error(`${label}.${key} must be a scalar`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${label}.${key} must be finite`);
    result[key] = value;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  return result;
}

function normalizeEvidence(evidence: readonly GraphEvidenceRef[] | undefined, label: string): GraphEvidenceRef[] | undefined {
  if (evidence === undefined) return undefined;
  if (!Array.isArray(evidence)) throw new Error(`${label} must be an array`);
  if (evidence.length > MAX_EVIDENCE_REFS) throw new Error(`${label} must contain at most ${MAX_EVIDENCE_REFS} references`);
  const result = evidence.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label}[${index}] must be an object`);
    const item = entry as GraphEvidenceRef;
    const type = item.type;
    if (!["source", "record", "derived"].includes(type)) throw new Error(`${label}[${index}].type is invalid`);
    const id = boundedText(item.id, `${label}[${index}].id`, 512);
    const locator = item.locator === undefined ? undefined : boundedText(item.locator, `${label}[${index}].locator`, 1_024);
    return { type, id, ...(locator === undefined ? {} : { locator }) };
  });
  const seen = new Set<string>();
  for (const item of result) {
    const key = `${item.type}\0${item.id}\0${item.locator ?? ""}`;
    if (seen.has(key)) throw new Error(`${label} contains duplicate evidence references`);
    seen.add(key);
  }
  return result.sort((left, right) => compareText(`${left.type}\0${left.id}\0${left.locator ?? ""}`, `${right.type}\0${right.id}\0${right.locator ?? ""}`));
}

function normalizeNode(node: GraphNode, bounds: GraphBounds, label: string): GraphNode {
  if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error(`${label} must be an object`);
  const id = boundedText(node.id, `${label}.id`, 512);
  const kind = boundedText(node.kind, `${label}.kind`, 128);
  const text = boundedText(node.label, `${label}.label`);
  if (node.provenance !== undefined && !["authoritative", "derived"].includes(node.provenance)) throw new Error(`${label}.provenance is invalid`);
  const attributes = normalizeAttributes(node.attributes, bounds.maxAttributeBytes, `${label}.attributes`);
  const evidence = normalizeEvidence(node.evidence, `${label}.evidence`);
  return {
    id,
    kind,
    label: text,
    ...(attributes === undefined ? {} : { attributes }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(node.provenance === undefined ? {} : { provenance: node.provenance }),
  };
}

function normalizeEdge(edge: GraphEdge, bounds: GraphBounds, label: string): GraphEdge {
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) throw new Error(`${label} must be an object`);
  const id = boundedText(edge.id, `${label}.id`, 512);
  const kind = boundedText(edge.kind, `${label}.kind`, 128);
  const source = boundedText(edge.source, `${label}.source`, 512);
  const target = boundedText(edge.target, `${label}.target`, 512);
  if (edge.provenance !== undefined && !["authoritative", "derived"].includes(edge.provenance)) throw new Error(`${label}.provenance is invalid`);
  const attributes = normalizeAttributes(edge.attributes, bounds.maxAttributeBytes, `${label}.attributes`);
  const evidence = normalizeEvidence(edge.evidence, `${label}.evidence`);
  return {
    id,
    kind,
    source,
    target,
    ...(attributes === undefined ? {} : { attributes }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(edge.provenance === undefined ? {} : { provenance: edge.provenance }),
  };
}

function ensureUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must contain unique identifiers`);
}

export function normalizeGraphSnapshot(input: GraphSnapshotInput): GraphSnapshot {
  if (!input || typeof input !== "object") throw new Error("graph snapshot input must be an object");
  if (!GRAPH_KINDS.includes(input.kind)) throw new Error("graph snapshot kind is invalid");
  const graphVersion = boundedText(input.graphVersion, "graphVersion", 256);
  const bounds = normalizeBounds(input.bounds);
  const allNodes = input.nodes.map((node, index) => normalizeNode(node, bounds, `nodes[${index}]`)).sort((left, right) => compareText(left.id, right.id));
  ensureUnique(allNodes.map((node) => node.id), "node ids");
  const selectedNodes = allNodes.slice(0, bounds.maxNodes);
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  const allEdges = input.edges.map((edge, index) => normalizeEdge(edge, bounds, `edges[${index}]`)).sort((left, right) => compareText(left.id, right.id));
  ensureUnique(allEdges.map((edge) => edge.id), "edge ids");
  const connectedEdges = allEdges.filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target));
  const selectedEdges = connectedEdges.slice(0, bounds.maxEdges);
  const truncated = input.truncated === true || selectedNodes.length !== allNodes.length || selectedEdges.length !== connectedEdges.length || connectedEdges.length !== allEdges.length;
  if (input.cursor !== undefined) boundedText(input.cursor.next, "cursor.next", 512);
  if (input.generatedAt !== undefined) boundedText(input.generatedAt, "generatedAt", 128);
  const degraded = input.degraded === undefined ? undefined : {
    provider: boundedText(input.degraded.provider, "degraded.provider", 128),
    reason: boundedText(input.degraded.reason, "degraded.reason", 1_024),
  };
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    graphVersion,
    kind: input.kind,
    nodes: selectedNodes,
    edges: selectedEdges,
    bounds,
    truncated,
    ...(input.cursor === undefined ? {} : { cursor: { next: input.cursor.next } }),
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
    ...(degraded === undefined ? {} : { degraded }),
  };
}

export function traceGraphSnapshot(input: GraphTraceInput): GraphTrace {
  if (!input || typeof input !== "object") throw new Error("graph trace input must be an object");
  const snapshot = normalizeGraphSnapshot(input.snapshot);
  const fromNodeId = boundedText(input.fromNodeId, "fromNodeId", 512);
  const toNodeId = boundedText(input.toNodeId, "toNodeId", 512);
  const maxDepth = boundedInteger(input.maxDepth ?? 8, "maxDepth", 1, 8);
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const adjacency = new Map<string, Array<{ edge: GraphEdge; target: string }>>();
  for (const edge of [...snapshot.edges].sort((left, right) => compareText(left.id, right.id))) {
    const entries = adjacency.get(edge.source) ?? [];
    entries.push({ edge, target: edge.target });
    adjacency.set(edge.source, entries);
  }

  const depth = new Map<string, number>();
  const parent = new Map<string, { nodeId: string; edge: GraphEdge }>();
  const queue: string[] = [];
  if (nodeIds.has(fromNodeId)) {
    depth.set(fromNodeId, 0);
    queue.push(fromNodeId);
  }
  while (queue.length > 0 && !depth.has(toNodeId)) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current)!;
    if (currentDepth >= maxDepth) continue;
    for (const { edge, target } of adjacency.get(current) ?? []) {
      if (depth.has(target)) continue;
      depth.set(target, currentDepth + 1);
      parent.set(target, { nodeId: current, edge });
      queue.push(target);
      if (target === toNodeId) break;
    }
  }

  const found = nodeIds.has(fromNodeId) && depth.has(toNodeId);
  const selectedNodeIds = new Set<string>();
  const selectedEdgeIds = new Set<string>();
  if (found) {
    let current = toNodeId;
    selectedNodeIds.add(current);
    while (current !== fromNodeId) {
      const previous = parent.get(current);
      if (!previous) break;
      selectedEdgeIds.add(previous.edge.id);
      current = previous.nodeId;
      selectedNodeIds.add(current);
    }
  } else {
    if (nodeIds.has(fromNodeId)) selectedNodeIds.add(fromNodeId);
    if (nodeIds.has(toNodeId)) selectedNodeIds.add(toNodeId);
  }
  const tracedNodes = snapshot.nodes.filter((node) => selectedNodeIds.has(node.id));
  const tracedEdges = snapshot.edges.filter((edge) => selectedEdgeIds.has(edge.id));
  const normalized = normalizeGraphSnapshot({
    graphVersion: snapshot.graphVersion,
    kind: snapshot.kind,
    nodes: tracedNodes,
    edges: tracedEdges,
    bounds: input.bounds ?? snapshot.bounds,
    truncated: snapshot.truncated,
    degraded: snapshot.degraded,
  });
  const frontierAtBound = !found && [...depth.entries()].some(([nodeId, nodeDepth]) => nodeDepth >= maxDepth && (adjacency.get(nodeId)?.length ?? 0) > 0);
  return {
    schemaVersion: GRAPH_TRACE_SCHEMA_VERSION,
    graphVersion: normalized.graphVersion,
    kind: normalized.kind,
    fromNodeId,
    toNodeId,
    maxDepth,
    nodes: normalized.nodes,
    edges: normalized.edges,
    bounds: normalized.bounds,
    found,
    truncated: normalized.truncated || frontierAtBound,
    ...(normalized.degraded === undefined ? {} : { degraded: normalized.degraded }),
  };
}

export function validateGraphSnapshot(snapshot: unknown): { ok: boolean; errors: string[] } {
  try {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("snapshot must be an object");
    const value = snapshot as GraphSnapshot;
    if (value.schemaVersion !== GRAPH_SCHEMA_VERSION) throw new Error("schemaVersion is invalid");
    if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error("nodes and edges must be arrays");
    if (!value.bounds || value.nodes.length > value.bounds.maxNodes || value.edges.length > value.bounds.maxEdges) throw new Error("snapshot exceeds declared graph bounds");
    const nodeIds = new Set(value.nodes.map((node) => node?.id));
    if (nodeIds.size !== value.nodes.length) throw new Error("node ids must contain unique identifiers");
    for (const edge of value.edges) {
      if (!nodeIds.has(edge?.source) || !nodeIds.has(edge?.target)) throw new Error("edge endpoint is missing from nodes");
    }
    const normalized = normalizeGraphSnapshot(value);
    if (normalized.nodes.length !== value.nodes.length || normalized.edges.length !== value.edges.length) throw new Error("snapshot is not normalized within its declared bounds");
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
