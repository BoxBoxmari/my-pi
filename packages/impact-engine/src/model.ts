import type { CodeEdge, CodeEdgeKind, CodeEntity, Intent, WorkDependency, WorkItem } from "@my-pi/contracts";
import type { EventId, IntentId } from "@my-pi/contracts";

export interface ImpactBounds {
  maxDepth?: number;
  maxEntities?: number;
  allowedEdgeKinds?: CodeEdgeKind[];
  minimumConfidence?: "exact" | "strong" | "medium" | "weak";
}

export interface ImpactInput {
  subject: IntentId | EventId;
  intent?: Intent;
  entities: CodeEntity[];
  edges: CodeEdge[];
  workItems: WorkItem[];
  dependencies?: WorkDependency[];
  activeIntents?: Intent[];
  bounds?: ImpactBounds;
}

export type ImpactReasonCode =
  | "explicit_work_dependency"
  | "same_work_item"
  | "exact_scope_overlap"
  | "graph_edge"
  | "direct_target_agent";

export interface ImpactReason {
  code: ImpactReasonCode;
  score: number;
  explanation: string;
  entityPath?: string[];
}

export interface AffectedWorkItem {
  workItemId: WorkItem["id"];
  score: number;
  reasons: ImpactReason[];
}

export interface AffectedAgent {
  agentSessionId: NonNullable<WorkItem["assignee"]>;
  score: number;
  reasons: ImpactReason[];
}

export interface AffectedEntity {
  entityId: CodeEntity["id"];
  score: number;
  reasons: ImpactReason[];
}

export interface ImpactResult {
  subject: IntentId | EventId;
  affectedWorkItems: AffectedWorkItem[];
  affectedAgents: AffectedAgent[];
  affectedEntities: AffectedEntity[];
  confidence: number;
  reasons: ImpactReason[];
  graphVersion: string;
  truncated: boolean;
}
