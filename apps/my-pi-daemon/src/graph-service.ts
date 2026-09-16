import type { SqliteCoordinationStore } from "@my-pi/coordination-store";
import type { AgentSession, ChangeReceipt, ProjectId } from "@my-pi/contracts";
import {
  normalizeGraphSnapshot,
  traceGraphSnapshot,
  type GraphBounds,
  type GraphKind,
  type GraphSnapshot,
} from "@my-pi/graph-model";
import {
  projectCodeGraph,
  projectImpactGraph,
  projectLineageGraph,
  projectWorkGraph,
} from "@my-pi/graph-projection";
import type { ImpactResult } from "@my-pi/impact-engine";
import type { WorkDependency } from "@my-pi/contracts";
import { graphDepthParam, optionalString, requiredString } from "./request-params.js";

export function degradedGraph(kind: GraphKind, bounds: Partial<GraphBounds>, reason: string): GraphSnapshot {
  return normalizeGraphSnapshot({
    graphVersion: `${kind}:v1`,
    kind,
    nodes: [],
    edges: [],
    bounds,
    degraded: { provider: "coordination-store", reason },
  });
}

async function projectionValues<T>(store: SqliteCoordinationStore, kind: string, projectId: ProjectId): Promise<T[]> {
  return (await store.listProjections<T>(kind, projectId)).map((record) => record.value);
}

export async function lineageSnapshot(store: SqliteCoordinationStore, projectId: ProjectId, subjectId: string, bounds: Partial<GraphBounds>): Promise<GraphSnapshot> {
  let proposal = await store.getProjection<import("@my-pi/contracts").ChangeProposal>("change_proposal", subjectId);
  let receipt = await store.getProjection<ChangeReceipt>("change_receipt", subjectId);
  let evaluationRun = await store.getProjection<import("@my-pi/contracts").EvaluationRun>("evaluation_run", subjectId);
  if (!proposal && receipt) proposal = await store.getProjection<import("@my-pi/contracts").ChangeProposal>("change_proposal", String(receipt.proposalId));
  if (!receipt && proposal) {
    receipt = (await projectionValues<ChangeReceipt>(store, "change_receipt", projectId)).find((candidate) => String(candidate.proposalId) === String(proposal?.id));
  }
  if (!evaluationRun && receipt) {
    evaluationRun = (await projectionValues<import("@my-pi/contracts").EvaluationRun>(store, "evaluation_run", projectId)).find((candidate) => candidate.changeReceiptId === receipt?.id);
  }
  if (!evaluationRun && proposal?.intentId) {
    evaluationRun = (await projectionValues<import("@my-pi/contracts").EvaluationRun>(store, "evaluation_run", projectId)).find((candidate) => candidate.intentId === proposal?.intentId);
  }
  const feedbackPacket = evaluationRun ? await store.getFeedbackPacket<import("@my-pi/contracts").FeedbackPacket>(projectId, String(evaluationRun.id)) : undefined;
  const retryCycle = evaluationRun ? await store.getRetryCycle<import("@my-pi/contracts").RetryCycle>(projectId, String(evaluationRun.id)) : undefined;
  const acceptance = evaluationRun ? await store.getEvaluationDecision<import("@my-pi/contracts").AcceptanceDecision>(projectId, String(evaluationRun.id)) : undefined;
  const snapshot = projectLineageGraph({ proposal, receipt, evaluationRun, feedbackPacket, retryCycle, acceptance, bounds });
  return proposal || receipt || evaluationRun
    ? snapshot
    : { ...snapshot, degraded: { provider: "coordination-store", reason: "lineage subject was not found" } };
}

export async function buildGraphSnapshot(store: SqliteCoordinationStore, projectId: ProjectId, kind: GraphKind, params: Record<string, unknown>, bounds: Partial<GraphBounds>): Promise<GraphSnapshot> {
  if (kind === "code") {
    const worktreeId = optionalString(params, "worktreeId");
    if (!worktreeId) return degradedGraph(kind, bounds, "code graph requires worktreeId");
    const state = await store.getCodeState(projectId, worktreeId);
    return projectCodeGraph({ entities: state.entities, edges: state.edges, bounds });
  }
  if (kind === "work") {
    const [workItems, dependencies, intents, sessions] = await Promise.all([
      projectionValues<import("@my-pi/contracts").WorkItem>(store, "work_item", projectId),
      projectionValues<WorkDependency>(store, "work_dependency", projectId),
      projectionValues<import("@my-pi/contracts").Intent>(store, "intent", projectId),
      projectionValues<AgentSession>(store, "agent_session", projectId),
    ]);
    return projectWorkGraph({ workItems, dependencies, intents, sessions, bounds });
  }
  if (kind === "impact") {
    const subjectId = optionalString(params, "subjectId");
    if (!subjectId) return degradedGraph(kind, bounds, "impact graph requires subjectId");
    const result = await store.getProjection<ImpactResult>("impact_result", subjectId);
    if (!result) return degradedGraph(kind, bounds, "impact result was not found");
    const intent = await store.getProjection<import("@my-pi/contracts").Intent>("intent", subjectId);
    const session = intent ? await store.getProjection<AgentSession>("agent_session", String(intent.agentSessionId)) : undefined;
    const codeState = session?.worktreeId ? await store.getCodeState(projectId, String(session.worktreeId)) : undefined;
    const [workItems, sessions] = await Promise.all([
      projectionValues<import("@my-pi/contracts").WorkItem>(store, "work_item", projectId),
      projectionValues<AgentSession>(store, "agent_session", projectId),
    ]);
    return projectImpactGraph({ result, intent, entities: codeState?.entities, workItems, sessions, bounds });
  }
  const subjectId = optionalString(params, "subjectId");
  if (!subjectId) return degradedGraph(kind, bounds, "lineage graph requires subjectId");
  return lineageSnapshot(store, projectId, subjectId, bounds);
}

export function expandGraphSnapshot(snapshot: GraphSnapshot, nodeId: string, depth: number, bounds: Partial<GraphBounds>): GraphSnapshot {
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  if (!nodeIds.has(nodeId)) return degradedGraph(snapshot.kind, bounds, "graph expansion node was not found in the bounded snapshot");
  const adjacent = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
    adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
  }
  const selected = new Set([nodeId]);
  let frontier = [nodeId];
  for (let level = 0; level < depth; level++) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const candidate of [...(adjacent.get(current) ?? [])].sort()) {
        if (!selected.has(candidate)) {
          selected.add(candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  const nodes = snapshot.nodes.filter((node) => selected.has(node.id));
  const edges = snapshot.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target));
  return normalizeGraphSnapshot({
    graphVersion: snapshot.graphVersion,
    kind: snapshot.kind,
    nodes,
    edges,
    bounds,
    truncated: snapshot.truncated || nodes.length !== snapshot.nodes.length || edges.length !== snapshot.edges.length,
    degraded: snapshot.degraded,
  });
}

export async function buildGraphTrace(store: SqliteCoordinationStore, projectId: ProjectId, kind: GraphKind, params: Record<string, unknown>, bounds: Partial<GraphBounds>) {
  const snapshot = await buildGraphSnapshot(store, projectId, kind, params, {
    maxNodes: 10_000,
    maxEdges: 50_000,
    maxAttributeBytes: bounds.maxAttributeBytes,
  });
  return traceGraphSnapshot({
    snapshot,
    fromNodeId: requiredString(params, "fromNodeId"),
    toNodeId: requiredString(params, "toNodeId"),
    maxDepth: graphDepthParam(params),
    bounds,
  });
}
