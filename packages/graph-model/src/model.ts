export const GRAPH_SCHEMA_VERSION = "1" as const;

export const GRAPH_KINDS = ["code", "impact", "work", "lineage"] as const;
export type GraphKind = (typeof GRAPH_KINDS)[number];

/**
 * Allowlisted coordination event-type strings per graph kind. Values mirror
 * COORDINATION_EVENT_TYPES from @my-pi/contracts (repeated as literals to keep
 * graph-model dependency-free); the test suite asserts membership against the
 * real exported set.
 */
export const GRAPH_EVENT_TYPES_BY_KIND: Record<GraphKind, readonly string[]> = {
  work: [
    "AgentJoined",
    "AgentHeartbeat",
    "AgentExpired",
    "WorkItemCreated",
    "WorkItemClaimed",
    "WorkItemBlocked",
    "WorkItemUnblocked",
    "WorkItemImplementationComplete",
    "WorkItemAwaitingEvaluation",
    "WorkItemEvaluationAccepted",
    "WorkItemEvaluationRejected",
    "WorkItemEvaluationReviewRequired",
    "WorkItemCompleted",
    "IntentDeclared",
    "IntentSuperseded",
    "EvaluationRequested",
    "EvaluationStarted",
    "EvaluationResultRecorded",
    "EvaluationCompleted",
    "AcceptanceDecided",
    "FeedbackIssued",
    "RetryRecommended",
    "RetryScheduled",
    "RetryExhausted",
  ],
  code: [
    "CodeGraphUpdated",
    "ContractChanged",
  ],
  impact: [
    "ImpactDetected",
    "ScopeDeclared",
    "ScopeReleased",
  ],
  lineage: [
    "ContextPublished",
    "ChangeProposed",
    "ChangeApplied",
    "ChangePartiallyApplied",
    "ChangeRejected",
    "VerificationRecorded",
  ],
};

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

export const THEATER_FRAME_SCHEMA_VERSION = "my-pi/theater-frame/v1" as const;

export interface TheaterEventActor {
  kind: string;
  id?: string;
  name?: string;
}

export interface TheaterEvent {
  projectId: string;
  sequence: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor: TheaterEventActor;
  correlationId?: string;
  causationId?: string;
  payload?: Record<string, unknown> | null;
}

export interface QualityState {
  degraded: boolean;
  truncated: boolean;
  stale: boolean;
  empty: boolean;
  reasons: string[];
  generatedAt: string;
  asOf?: string;
}

export interface TheaterCapabilities {
  live: boolean;
  replay: boolean;
  expand: boolean;
  trace: boolean;
  renderer3d: boolean;
}

export interface TheaterScope {
  projectId: string;
  worktreeId?: string;
  kind: GraphKind;
  subjectId?: string;
}

export interface TheaterFrame {
  schemaVersion: typeof THEATER_FRAME_SCHEMA_VERSION;
  scope: TheaterScope;
  graph: GraphSnapshot;
  events: TheaterEvent[];
  cursor: {
    firstSequence?: string;
    lastSequence?: string;
    nextSequence?: string;
  };
  quality: QualityState;
  capabilities: TheaterCapabilities;
}

export type MotionCueType = "pulse" | "claim" | "blocked" | "intent" | "settle";

export interface SceneCue {
  id: string;
  eventId: string;
  sequence: string;
  type: MotionCueType;
  targetNodeId: string;
  sourceNodeId?: string;
  color?: string;
  durationMs?: number;
  timestamp: string;
}

export function eventToMotionCue(
  event: TheaterEvent | { sequence: string | bigint; eventId: string; eventType: string; occurredAt?: string; actor?: TheaterEventActor; payload?: unknown },
  graph: GraphSnapshot,
): SceneCue | null {
  const sequenceStr = String(event.sequence);
  const eventType = event.eventType;
  const payload = (event.payload && typeof event.payload === "object") ? event.payload as Record<string, unknown> : {};
  const timestamp = event.occurredAt || new Date().toISOString();
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  if (eventType === "AgentHeartbeat") {
    const actorId = event.actor?.id ?? String(payload.agentSessionId ?? "");
    let target = actorId ? (nodeMap.get(`agent:session:${actorId}`) || nodeMap.get(actorId)) : undefined;
    if (!target && actorId) {
      target = graph.nodes.find((n) => n.kind === "agent_session" && (n.id.includes(actorId) || n.label.includes(actorId)));
    }
    if (!target) {
      target = graph.nodes.find((n) => n.kind === "agent_session");
    }
    if (!target) return null;
    return {
      id: `cue:pulse:${event.eventId}`,
      eventId: event.eventId,
      sequence: sequenceStr,
      type: "pulse",
      targetNodeId: target.id,
      color: "var(--kpmg-cobalt)",
      durationMs: 800,
      timestamp,
    };
  }

  if (eventType === "WorkItemClaimed") {
    const workItemId = String(payload.workItemId ?? "");
    const actorId = event.actor?.id ?? String(payload.agentSessionId ?? "");
    let target = workItemId ? (nodeMap.get(`work:item:${workItemId}`) || nodeMap.get(workItemId)) : undefined;
    if (!target && workItemId) {
      target = graph.nodes.find((n) => n.id.includes(workItemId));
    }
    if (!target) return null;
    let source = actorId ? (nodeMap.get(`agent:session:${actorId}`) || nodeMap.get(actorId)) : undefined;
    if (!source && actorId) {
      source = graph.nodes.find((n) => n.kind === "agent_session" && (n.id.includes(actorId) || n.label.includes(actorId)));
    }
    return {
      id: `cue:claim:${event.eventId}`,
      eventId: event.eventId,
      sequence: sequenceStr,
      type: "claim",
      targetNodeId: target.id,
      sourceNodeId: source?.id,
      color: "var(--kpmg-pacific)",
      durationMs: 1200,
      timestamp,
    };
  }

  if (eventType === "WorkItemBlocked" || eventType === "Blocked") {
    const workItemId = String(payload.workItemId ?? event.actor?.id ?? "");
    let target = workItemId ? (nodeMap.get(`work:item:${workItemId}`) || nodeMap.get(workItemId)) : undefined;
    if (!target && workItemId) {
      target = graph.nodes.find((n) => n.id.includes(workItemId));
    }
    if (!target) return null;
    return {
      id: `cue:blocked:${event.eventId}`,
      eventId: event.eventId,
      sequence: sequenceStr,
      type: "blocked",
      targetNodeId: target.id,
      color: "var(--status-warning)",
      durationMs: 1500,
      timestamp,
    };
  }

  if (eventType === "IntentDeclared") {
    const intentId = String(payload.intentId ?? "");
    const actorId = event.actor?.id ?? String(payload.agentSessionId ?? "");
    let target = intentId ? (nodeMap.get(`intent:${intentId}`) || nodeMap.get(intentId)) : undefined;
    if (!target && intentId) {
      target = graph.nodes.find((n) => n.kind === "intent" && n.id.includes(intentId));
    }
    let source = actorId ? (nodeMap.get(`agent:session:${actorId}`) || nodeMap.get(actorId)) : undefined;
    if (!target && !source) return null;
    return {
      id: `cue:intent:${event.eventId}`,
      eventId: event.eventId,
      sequence: sequenceStr,
      type: "intent",
      targetNodeId: target?.id ?? source!.id,
      sourceNodeId: source?.id,
      color: "var(--kpmg-purple)",
      durationMs: 1000,
      timestamp,
    };
  }

  if (
    eventType === "WorkItemCompleted" ||
    eventType === "Completed" ||
    eventType === "WorkItemEvaluationAccepted" ||
    eventType === "EvaluationAccepted"
  ) {
    const workItemId = String(payload.workItemId ?? event.actor?.id ?? "");
    let target = workItemId ? (nodeMap.get(`work:item:${workItemId}`) || nodeMap.get(workItemId)) : undefined;
    if (!target && workItemId) {
      target = graph.nodes.find((n) => n.id.includes(workItemId));
    }
    if (!target) return null;
    return {
      id: `cue:settle:${event.eventId}`,
      eventId: event.eventId,
      sequence: sequenceStr,
      type: "settle",
      targetNodeId: target.id,
      color: "var(--status-success)",
      durationMs: 1500,
      timestamp,
    };
  }

  return null;
}

export function computeQualityState(
  graph: GraphSnapshot,
  events: TheaterEvent[] = [],
  options?: { asOf?: string; isStale?: boolean; reason?: string }
): QualityState {
  const reasons: string[] = [];
  const degraded = Boolean(graph.degraded);
  if (graph.degraded) {
    reasons.push(`Graph degraded: ${graph.degraded.reason}`);
  }
  const truncated = Boolean(graph.truncated);
  if (truncated) {
    reasons.push("Graph nodes or edges truncated within bounds");
  }
  const empty = graph.nodes.length === 0;
  if (empty) {
    reasons.push("Graph contains zero nodes");
  }
  const stale = Boolean(options?.isStale);
  if (stale) {
    reasons.push(options?.reason ?? "Graph data is stale or agent heartbeat expired");
  }

  return {
    degraded,
    truncated,
    stale,
    empty,
    reasons,
    generatedAt: graph.generatedAt ?? new Date().toISOString(),
    ...(options?.asOf ? { asOf: options.asOf } : {}),
  };
}

export function createTheaterFrame(input: {
  scope: TheaterScope;
  graph: GraphSnapshot;
  events: TheaterEvent[];
  cursor?: { firstSequence?: string; lastSequence?: string; nextSequence?: string };
  quality?: Partial<QualityState>;
  capabilities?: Partial<TheaterCapabilities>;
}): TheaterFrame {
  const computedQuality = computeQualityState(input.graph, input.events);
  const quality: QualityState = {
    ...computedQuality,
    ...input.quality,
    reasons: [...new Set([...computedQuality.reasons, ...(input.quality?.reasons ?? [])])],
  };
  const firstSequence = input.cursor?.firstSequence ?? (input.events.length > 0 ? input.events[0]?.sequence : undefined);
  const lastSequence = input.cursor?.lastSequence ?? (input.events.length > 0 ? input.events[input.events.length - 1]?.sequence : undefined);

  return {
    schemaVersion: THEATER_FRAME_SCHEMA_VERSION,
    scope: input.scope,
    graph: input.graph,
    events: input.events,
    cursor: {
      ...(firstSequence ? { firstSequence } : {}),
      ...(lastSequence ? { lastSequence } : {}),
      ...(input.cursor?.nextSequence ? { nextSequence: input.cursor.nextSequence } : {}),
    },
    quality,
    capabilities: {
      live: input.capabilities?.live ?? true,
      replay: input.capabilities?.replay ?? true,
      expand: input.capabilities?.expand ?? true,
      trace: input.capabilities?.trace ?? true,
      renderer3d: input.capabilities?.renderer3d ?? true,
    },
  };
}

export function validateTheaterFrame(frame: unknown): { ok: boolean; errors: string[] } {
  try {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new Error("frame must be an object");
    const value = frame as TheaterFrame;
    if (value.schemaVersion !== THEATER_FRAME_SCHEMA_VERSION) throw new Error("schemaVersion is invalid");
    if (!value.scope || typeof value.scope.projectId !== "string") throw new Error("scope.projectId is required");
    const graphValidation = validateGraphSnapshot(value.graph);
    if (!graphValidation.ok) throw new Error(`invalid graph: ${graphValidation.errors.join(", ")}`);
    if (!Array.isArray(value.events)) throw new Error("events must be an array");
    if (!value.quality || typeof value.quality.degraded !== "boolean") throw new Error("quality state is invalid");
    if (!value.capabilities || typeof value.capabilities.renderer3d !== "boolean") throw new Error("capabilities are invalid");
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
