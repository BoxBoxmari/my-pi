import type { AgentSessionId, ProjectId, RepositoryId, WorktreeId } from "@my-pi/contracts";
import type { DataClassification } from "./classification.js";
import type { PolicyDecisionKind } from "./decision-point.js";

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorRef?: string;
  agentSessionId?: AgentSessionId;
  projectId?: ProjectId;
  repositoryId?: RepositoryId;
  worktreeId?: WorktreeId;
  operation: string;
  policyDecision?: PolicyDecisionKind;
  resourceRef?: string;
  changeRef?: string;
  resultCode?: string;
  requestId?: string;
  correlationId?: string;
  classification?: DataClassification;
}

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
  list(limit?: number): Promise<AuditEvent[]>;
}

export class BoundedAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  constructor(private readonly maxEvents = 10_000) {}

  async append(event: AuditEvent): Promise<void> {
    if (!event.id || !event.operation || event.operation.length > 128) throw new Error("audit event operation is required and bounded");
    this.events.push({ ...event });
    while (this.events.length > this.maxEvents) this.events.shift();
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("audit limit is out of bounds");
    return this.events.slice(-limit).reverse().map((event) => ({ ...event }));
  }
}
