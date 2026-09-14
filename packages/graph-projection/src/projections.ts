import type {
  AcceptanceDecision,
  AgentSession,
  ChangeProposal,
  ChangeReceipt,
  CodeEdge,
  CodeEntity,
  FeedbackPacket,
  Intent,
  RetryCycle,
  WorkDependency,
  WorkItem,
  EvaluationRun,
} from "@my-pi/contracts";
import type { ImpactResult } from "@my-pi/impact-engine";
import {
  normalizeGraphSnapshot,
  type GraphAttributes,
  type GraphEdge,
  type GraphEvidenceRef,
  type GraphNode,
  type GraphSnapshot,
  type GraphBounds,
} from "@my-pi/graph-model";

export interface CodeGraphProjectionInput {
  entities: readonly CodeEntity[];
  edges: readonly CodeEdge[];
  bounds?: Partial<GraphBounds>;
  graphVersion?: string;
}

export interface ImpactGraphProjectionInput {
  result: ImpactResult;
  intent?: Intent;
  entities?: readonly CodeEntity[];
  workItems?: readonly WorkItem[];
  sessions?: readonly AgentSession[];
  bounds?: Partial<GraphBounds>;
}

export interface WorkGraphProjectionInput {
  workItems: readonly WorkItem[];
  dependencies?: readonly WorkDependency[];
  intents?: readonly Intent[];
  sessions?: readonly AgentSession[];
  bounds?: Partial<GraphBounds>;
}

export interface LineageGraphProjectionInput {
  proposal?: ChangeProposal;
  receipt?: ChangeReceipt;
  evaluationRun?: EvaluationRun;
  feedbackPacket?: FeedbackPacket;
  retryCycle?: RetryCycle;
  acceptance?: AcceptanceDecision;
  bounds?: Partial<GraphBounds>;
}

const SENSITIVE_RELATIVE_PATH = /(^|\/)(?:\.env(?:\.[^/]*)?|\.aws|\.ssh|\.npmrc|\.netrc|\.git-credentials|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|[^/]+\.(?:pem|key|p12|pfx))(?:\/|$)/i;

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function safeRelativePath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..") || SENSITIVE_RELATIVE_PATH.test(normalized)) return undefined;
  return normalized;
}

function safeStableKey(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/");
  const pathLike = normalized.replaceAll(/[|:]/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..") || SENSITIVE_RELATIVE_PATH.test(pathLike)) return undefined;
  return normalized;
}

function evidence(type: GraphEvidenceRef["type"], id: string, locator?: string): GraphEvidenceRef[] {
  return [{ type, id, ...(locator === undefined ? {} : { locator }) }];
}

function attributes(entries: Record<string, string | number | boolean | null | undefined>): GraphAttributes {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)) as GraphAttributes;
}

function node(id: string, kind: string, label: string, values: Record<string, string | number | boolean | null | undefined>, refs: GraphEvidenceRef[] = [], provenance: "authoritative" | "derived" = "authoritative"): GraphNode {
  return {
    id,
    kind,
    label: asText(label, id),
    ...(Object.keys(values).length === 0 ? {} : { attributes: attributes(values) }),
    ...(refs.length === 0 ? {} : { evidence: refs }),
    provenance,
  };
}

function edge(id: string, kind: string, source: string, target: string, values: Record<string, string | number | boolean | null | undefined>, refs: GraphEvidenceRef[] = [], provenance: "authoritative" | "derived" = "authoritative"): GraphEdge {
  return {
    id,
    kind,
    source,
    target,
    ...(Object.keys(values).length === 0 ? {} : { attributes: attributes(values) }),
    ...(refs.length === 0 ? {} : { evidence: refs }),
    provenance,
  };
}

function entityNodeId(id: CodeEntity["id"]): string {
  return `entity:${String(id)}`;
}

function workNodeId(id: WorkItem["id"]): string {
  return `work:${String(id)}`;
}

function intentNodeId(id: Intent["id"] | string): string {
  return `intent:${String(id)}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const selected = new Map<string, T>();
  for (const value of [...values].sort((left, right) => compareText(key(left), key(right)))) {
    const valueKey = key(value);
    if (!selected.has(valueKey)) selected.set(valueKey, value);
  }
  return [...selected.values()];
}

export function projectCodeGraph(input: CodeGraphProjectionInput): GraphSnapshot {
  const visibleEntities = uniqueBy(
    input.entities.filter((entity) => safeRelativePath(entity.path) !== undefined || entity.path === undefined),
    (entity) => String(entity.id),
  );
  const entityIds = new Set(visibleEntities.map((entity) => String(entity.id)));
  const nodes = visibleEntities.map((entity) => {
    const path = safeRelativePath(entity.path);
    const stableKey = safeStableKey(entity.stableKey);
    return node(entityNodeId(entity.id), entity.kind, entity.displayName, {
      stableKey,
      provider: entity.provider,
      ...(path === undefined ? {} : { path }),
      ...(entity.symbolKind === undefined ? {} : { symbolKind: entity.symbolKind }),
    }, evidence("record", String(entity.id), path), "authoritative");
  });
  const edges = uniqueBy(input.edges, (candidate) => `${String(candidate.from)}\0${candidate.kind}\0${String(candidate.to)}\0${candidate.provider}`)
    .filter((candidate) => entityIds.has(String(candidate.from)) && entityIds.has(String(candidate.to)))
    .map((candidate) => edge(
      `code-edge:${String(candidate.from)}:${candidate.kind}:${String(candidate.to)}`,
      candidate.kind,
      entityNodeId(candidate.from),
      entityNodeId(candidate.to),
      { confidence: candidate.confidence, provider: candidate.provider },
      evidence("record", `edge:${String(candidate.from)}:${candidate.kind}:${String(candidate.to)}`, candidate.provider),
    ));
  return normalizeGraphSnapshot({ graphVersion: input.graphVersion ?? "code:v1", kind: "code", nodes, edges, bounds: input.bounds });
}

export function projectImpactGraph(input: ImpactGraphProjectionInput): GraphSnapshot {
  const result = input.result;
  const rootId = intentNodeId(result.subject);
  const entityById = new Map((input.entities ?? []).map((item) => [String(item.id), item]));
  const workById = new Map((input.workItems ?? []).map((item) => [String(item.id), item]));
  const sessionById = new Map((input.sessions ?? []).map((item) => [String(item.id), item]));
  const nodes: GraphNode[] = [node(rootId, "intent", input.intent?.summary ?? String(result.subject), { confidence: result.confidence, graphVersion: result.graphVersion, truncated: result.truncated }, evidence("record", String(result.subject)))];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set([rootId]);
  const addNode = (value: GraphNode) => { if (!seenNodes.has(value.id)) { seenNodes.add(value.id); nodes.push(value); } };
  for (const affected of result.affectedEntities) {
    const entity = entityById.get(String(affected.entityId));
    const path = safeRelativePath(entity?.path);
    if (entity?.path !== undefined && path === undefined) continue;
    addNode(node(entityNodeId(affected.entityId), entity?.kind ?? "entity", entity?.displayName ?? String(affected.entityId), { score: affected.score, ...(path === undefined ? {} : { path }) }, evidence("record", String(affected.entityId), path)));
    edges.push(edge(`impact-entity:${String(result.subject)}:${String(affected.entityId)}`, "affects", rootId, entityNodeId(affected.entityId), { score: affected.score, reasons: affected.reasons.map((reason) => reason.code).sort().join(",") }, evidence("derived", `impact:${String(result.subject)}:${String(affected.entityId)}`), "derived"));
  }
  for (const affected of result.affectedWorkItems) {
    const item = workById.get(String(affected.workItemId));
    const id = workNodeId(affected.workItemId);
    addNode(node(id, "work_item", item?.title ?? String(affected.workItemId), { score: affected.score, ...(item?.state === undefined ? {} : { state: item.state }) }, evidence("record", String(affected.workItemId))));
    edges.push(edge(`impact-work:${String(result.subject)}:${String(affected.workItemId)}`, "affects", rootId, id, { score: affected.score, reasons: affected.reasons.map((reason) => reason.code).sort().join(",") }, evidence("derived", `impact:${String(result.subject)}:${String(affected.workItemId)}`), "derived"));
  }
  for (const affected of result.affectedAgents) {
    const session = sessionById.get(String(affected.agentSessionId));
    const id = `agent:${String(affected.agentSessionId)}`;
    addNode(node(id, "agent_session", session?.clientInstance ?? String(affected.agentSessionId), { score: affected.score, ...(session?.host === undefined ? {} : { host: session.host }) }, evidence("record", String(affected.agentSessionId))));
    edges.push(edge(`impact-agent:${String(result.subject)}:${String(affected.agentSessionId)}`, "routes_to", rootId, id, { score: affected.score, reasons: affected.reasons.map((reason) => reason.code).sort().join(",") }, evidence("derived", `impact:${String(result.subject)}:${String(affected.agentSessionId)}`), "derived"));
  }
  return normalizeGraphSnapshot({ graphVersion: result.graphVersion, kind: "impact", nodes, edges, truncated: result.truncated, bounds: input.bounds });
}

export function projectWorkGraph(input: WorkGraphProjectionInput): GraphSnapshot {
  const nodes: GraphNode[] = input.workItems.map((item) => node(workNodeId(item.id), "work_item", item.title, { state: item.state, version: item.version }, evidence("record", String(item.id))));
  const edges: GraphEdge[] = [];
  const nodeIds = new Set(nodes.map((item) => item.id));
  const addPlaceholder = (id: string) => {
    const graphId = workNodeId(id as WorkItem["id"]);
    if (!nodeIds.has(graphId)) {
      nodeIds.add(graphId);
      nodes.push(node(graphId, "work_item", id, { missing: true }, evidence("derived", `missing-work:${id}`), "derived"));
    }
  };
  const addAgentPlaceholder = (id: string) => {
    const graphId = `agent:${id}`;
    if (!nodeIds.has(graphId)) {
      nodeIds.add(graphId);
      nodes.push(node(graphId, "agent_session", id, { missing: true }, evidence("derived", `missing-agent:${id}`), "derived"));
    }
  };
  for (const dependency of input.dependencies ?? []) {
    addPlaceholder(String(dependency.from));
    addPlaceholder(String(dependency.to));
    edges.push(edge(`dependency:${String(dependency.from)}:${dependency.type}:${String(dependency.to)}`, dependency.type, workNodeId(dependency.from), workNodeId(dependency.to), {}, evidence("record", `dependency:${String(dependency.from)}:${String(dependency.to)}`)));
  }
  for (const intent of input.intents ?? []) {
    const id = intentNodeId(intent.id);
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      nodes.push(node(id, "intent", intent.summary, { state: intent.state, kind: intent.kind }, evidence("record", String(intent.id))));
    }
    if (intent.workItemId !== undefined) {
      addPlaceholder(String(intent.workItemId));
      edges.push(edge(`intent-work:${String(intent.id)}:${String(intent.workItemId)}`, "declared_for", id, workNodeId(intent.workItemId), {}, evidence("record", String(intent.id))));
    }
    if (intent.agentSessionId !== undefined) {
      addAgentPlaceholder(String(intent.agentSessionId));
      edges.push(edge(`intent-agent:${String(intent.id)}:${String(intent.agentSessionId)}`, "executed_by", id, `agent:${String(intent.agentSessionId)}`, {}, evidence("record", String(intent.id))));
    }
  }
  for (const session of input.sessions ?? []) {
    const id = `agent:${String(session.id)}`;
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      nodes.push(node(id, "agent_session", session.clientInstance ?? String(session.id), { host: session.host, status: session.status }, evidence("record", String(session.id))));
    }
  }
  return normalizeGraphSnapshot({ graphVersion: "work:v1", kind: "work", nodes, edges, bounds: input.bounds });
}

export function projectLineageGraph(input: LineageGraphProjectionInput): GraphSnapshot {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const add = (item: GraphNode) => nodes.push(item);
  if (input.proposal) add(node(`proposal:${String(input.proposal.id)}`, "change_proposal", String(input.proposal.id), { resources: input.proposal.resources.length, proposedAt: input.proposal.proposedAt }, evidence("record", String(input.proposal.id))));
  if (input.receipt) add(node(`receipt:${String(input.receipt.id)}`, "change_receipt", String(input.receipt.id), { status: input.receipt.status, publishedAt: input.receipt.publishedAt }, evidence("record", String(input.receipt.id))));
  if (input.evaluationRun) add(node(`evaluation:${String(input.evaluationRun.id)}`, "evaluation_run", String(input.evaluationRun.id), { state: input.evaluationRun.state, attempt: input.evaluationRun.attempt }, evidence("record", String(input.evaluationRun.id))));
  if (input.feedbackPacket) add(node(`feedback:${String(input.feedbackPacket.id)}`, "feedback_packet", input.feedbackPacket.conciseSummary, { failedCriteria: input.feedbackPacket.failedCriteria.length, priorPasses: input.feedbackPacket.priorPassesThatMustNotRegress?.length ?? 0 }, evidence("record", String(input.feedbackPacket.id))));
  if (input.retryCycle) add(node(`retry:${String(input.retryCycle.id)}`, "retry_cycle", String(input.retryCycle.id), { state: input.retryCycle.state, attempt: input.retryCycle.attempt, maxAttempts: input.retryCycle.maxAttempts }, evidence("record", String(input.retryCycle.id))));
  if (input.acceptance) add(node(`acceptance:${String(input.acceptance.runId)}:${input.acceptance.decisionDigest}`, "acceptance", input.acceptance.decision, { decision: input.acceptance.decision, reasons: input.acceptance.reasons.join(",") }, evidence("record", input.acceptance.decisionDigest)));
  const link = (source: string, target: string, kind: string) => edges.push(edge(`lineage:${source}:${kind}:${target}`, kind, source, target, {}, evidence("derived", `lineage:${source}:${target}`), "derived"));
  if (input.proposal && input.receipt) link(`proposal:${String(input.proposal.id)}`, `receipt:${String(input.receipt.id)}`, "published_as");
  if (input.receipt && input.evaluationRun) link(`receipt:${String(input.receipt.id)}`, `evaluation:${String(input.evaluationRun.id)}`, "evaluated");
  if (input.evaluationRun && input.feedbackPacket) link(`evaluation:${String(input.evaluationRun.id)}`, `feedback:${String(input.feedbackPacket.id)}`, "feedback");
  if (input.feedbackPacket && input.retryCycle) link(`feedback:${String(input.feedbackPacket.id)}`, `retry:${String(input.retryCycle.id)}`, "retries");
  if (input.retryCycle && input.acceptance) link(`retry:${String(input.retryCycle.id)}`, `acceptance:${String(input.acceptance.runId)}:${input.acceptance.decisionDigest}`, "decided");
  return normalizeGraphSnapshot({ graphVersion: "lineage:v1", kind: "lineage", nodes, edges, bounds: input.bounds });
}
