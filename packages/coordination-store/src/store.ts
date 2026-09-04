import type { ActorRef, CodeEdge, CodeEntity, CoordinationEvent, EventId, ProjectId } from "@my-pi/contracts";

export interface AppendEventInput<T = unknown> {
  projectId: ProjectId;
  eventId?: EventId;
  eventType: string;
  occurredAt?: string;
  actor: ActorRef;
  correlationId?: string;
  causationId?: string;
  payload: T;
}

export interface EventQuery {
  projectId: ProjectId;
  afterSequence?: bigint;
  limit?: number;
  maxBytes?: number;
}

export interface EventPage {
  events: CoordinationEvent[];
  throughSequence: bigint;
  hasMore: boolean;
}

export interface IdempotencyInput {
  clientId: string;
  key: string;
  operationKind: string;
  requestDigest: string;
}

export interface StoredIdempotency extends IdempotencyInput {
  resultRef?: string;
  resultDigest?: string;
  expiresAt?: string;
}

export interface ProjectionRecord<T = unknown> {
  id: string;
  projectId?: string;
  value: T;
  updatedAt: string;
}

export interface CodeStateDeltaInput {
  projectId: ProjectId;
  repositoryId: string;
  worktreeId: string;
  changedPath: string;
  entities: CodeEntity[];
  edges: CodeEdge[];
  removedStableKeys: string[];
  observedAt: string;
  providerHealth?: Record<string, { status: string; message?: string }>;
}

export interface CodeStateSnapshot {
  entities: CodeEntity[];
  edges: CodeEdge[];
}

export interface AuditRecord {
  id: string;
  projectId: ProjectId;
  occurredAt: string;
  actorRef?: string;
  agentSessionId?: string;
  operation: string;
  policyDecision?: "ALLOW" | "DENY" | "REVIEW_REQUIRED" | "ALLOW_WITH_CONSTRAINTS";
  resourceRef?: string;
  changeRef?: string;
  resultCode?: string;
  requestId?: string;
  correlationId?: string;
  classification?: string;
}

/** Synchronous transaction view; SQLite transactions must not span an await. */
export interface CoordinationTransaction {
  appendEvent<T>(input: AppendEventInput<T>): CoordinationEvent<T>;
  getProjection<T>(kind: string, id: string): T | undefined;
  listProjections<T>(kind: string, projectId: string): ProjectionRecord<T>[];
  putProjection<T>(kind: string, id: string, value: T, projectId?: string, updatedAt?: string): void;
  applyCodeStateDelta(input: CodeStateDeltaInput): void;
  appendAudit(record: AuditRecord): void;
  getIdempotency(input: IdempotencyInput): StoredIdempotency | undefined;
  putIdempotency(record: StoredIdempotency): void;
  listEvaluationResults<T>(projectId: ProjectId, runId: string): T[];
  getEvaluationDecision<T>(projectId: ProjectId, runId: string): T | undefined;
  getFeedbackPacket<T>(projectId: ProjectId, runId: string): T | undefined;
  getRetryCycle<T>(projectId: ProjectId, runId: string): T | undefined;
}

export interface CoordinationStore {
  init(): Promise<void>;
  transact<T>(fn: (transaction: CoordinationTransaction) => T): Promise<T>;
  appendEvent<T>(input: AppendEventInput<T>): Promise<CoordinationEvent<T>>;
  listEvents(query: EventQuery): Promise<EventPage>;
  getProjection<T>(kind: string, id: string): Promise<T | undefined>;
  listProjections<T>(kind: string, projectId: string): Promise<ProjectionRecord<T>[]>;
  applyCodeStateDelta(input: CodeStateDeltaInput): Promise<void>;
  getCodeState(projectId: ProjectId, worktreeId: string): Promise<CodeStateSnapshot>;
  appendAudit(record: AuditRecord): Promise<void>;
  listAudit(projectId: ProjectId, limit?: number): Promise<AuditRecord[]>;
  checkIdempotency(input: IdempotencyInput): Promise<StoredIdempotency | undefined>;
  recordIdempotency(record: StoredIdempotency): Promise<void>;
  listEvaluationResults<T>(projectId: ProjectId, runId: string): Promise<T[]>;
  getEvaluationDecision<T>(projectId: ProjectId, runId: string): Promise<T | undefined>;
  getFeedbackPacket<T>(projectId: ProjectId, runId: string): Promise<T | undefined>;
  getRetryCycle<T>(projectId: ProjectId, runId: string): Promise<T | undefined>;
  close(): Promise<void>;
}
