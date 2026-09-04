import { DatabaseSync } from "node:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createEventId,
  err,
  type CoordinationEvent,
  type EventId,
  type ProjectId,
} from "@my-pi/contracts";
import { normalizeCoordinationStoreError } from "./errors.js";
import { applyMigrations } from "./migrations.js";
import { applyCodeStateDelta, applyEventProjection, getCodeState, getEvaluationDecision, getFeedbackPacket, getProjection, getRetryCycle, listEvaluationResults, listProjections, parseJson, putProjection, serializeJson } from "./projections.js";
import type {
  AppendEventInput,
  CoordinationStore,
  CoordinationTransaction,
  CodeStateDeltaInput,
  CodeStateSnapshot,
  AuditRecord,
  EventPage,
  EventQuery,
  IdempotencyInput,
  StoredIdempotency,
} from "./store.js";

type EventRow = {
  project_id: string;
  sequence: number;
  event_id: string;
  event_type: string;
  occurred_at: string;
  actor_json: string;
  correlation_id?: string | null;
  causation_id?: string | null;
  payload_json: string;
};

type IdempotencyRow = {
  client_id: string;
  idempotency_key: string;
  operation_kind: string;
  request_digest: string;
  result_ref?: string | null;
  result_digest?: string | null;
  expires_at?: string | null;
};

const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 1000;
const DEFAULT_EVENT_BYTES = 256 * 1024;
const MAX_EVENT_BYTES = 4 * 1024 * 1024;
const BUSY_TIMEOUT_MS = 5_000;

export class SqliteCoordinationStore implements CoordinationStore {
  private db?: DatabaseSync;
  private inTransaction = false;

  constructor(readonly databasePath: string) {}

  async init(): Promise<void> {
    if (this.db) return;
    try {
      if (this.databasePath !== ":memory:") {
        const absolute = path.resolve(this.databasePath);
        await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
      }
      const db = new DatabaseSync(this.databasePath);
      try {
        db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
        await applyMigrations(db);
        if (this.databasePath !== ":memory:") await chmod(this.databasePath, 0o600).catch(() => undefined);
        this.db = db;
      } catch (error) {
        db.close();
        throw error;
      }
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async transact<T>(fn: (transaction: CoordinationTransaction) => T): Promise<T> {
    const db = this.requireDb();
    if (this.inTransaction) throw err.coordinationStoreFailure("nested coordination transactions are not supported");
    this.inTransaction = true;
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = fn(this.transactionView(db));
      if (result && typeof (result as unknown as { then?: unknown }).then === "function") {
        throw err.invalidArgument("coordination transaction callbacks must be synchronous");
      }
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original failure; SQLite may already have rolled back.
      }
      throw normalizeCoordinationStoreError(error);
    } finally {
      this.inTransaction = false;
    }
  }

  async appendEvent<T>(input: AppendEventInput<T>): Promise<CoordinationEvent<T>> {
    return this.transact((transaction) => transaction.appendEvent(input));
  }

  async listEvents(query: EventQuery): Promise<EventPage> {
    const db = this.requireDb();
    const limit = this.boundedInteger(query.limit ?? DEFAULT_EVENT_LIMIT, 1, MAX_EVENT_LIMIT, "event limit");
    const maxBytes = this.boundedInteger(query.maxBytes ?? DEFAULT_EVENT_BYTES, 1, MAX_EVENT_BYTES, "event byte limit");
    const after = this.sequenceNumber(query.afterSequence ?? 0n);
    try {
      const rows = db.prepare(
        `SELECT project_id, sequence, event_id, event_type, occurred_at, actor_json, correlation_id, causation_id, payload_json
         FROM event_log WHERE project_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`,
      ).all(query.projectId, after, limit + 1) as EventRow[];
      const events: CoordinationEvent[] = [];
      let bytes = 0;
      for (const row of rows.slice(0, limit)) {
        const event = this.eventFromRow(row);
        const eventBytes = Buffer.byteLength(serializeJson(event), "utf8");
        if (events.length === 0 && eventBytes > maxBytes) throw err.outputLimit("a single coordination event exceeds the requested byte limit");
        if (bytes + eventBytes > maxBytes) break;
        bytes += eventBytes;
        events.push(event);
      }
      const throughSequence = events.length > 0 ? events[events.length - 1]!.sequence : (query.afterSequence ?? 0n);
      return { events, throughSequence, hasMore: rows.length > events.length };
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async getProjection<T>(kind: string, id: string): Promise<T | undefined> {
    try {
      return getProjection<T>(this.requireDb(), kind, id);
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async listProjections<T>(kind: string, projectId: string) {
    try {
      return listProjections<T>(this.requireDb(), kind, projectId);
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async applyCodeStateDelta(input: CodeStateDeltaInput): Promise<void> {
    await this.transact((transaction) => transaction.applyCodeStateDelta(input));
  }

  async getCodeState(projectId: ProjectId, worktreeId: string): Promise<CodeStateSnapshot> {
    try {
      return getCodeState(this.requireDb(), projectId, worktreeId);
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    await this.transact((transaction) => transaction.appendAudit(record));
  }

  async listAudit(projectId: ProjectId, limit = 100): Promise<AuditRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw err.invalidArgument("audit limit must be between 1 and 1000");
    const rows = this.requireDb().prepare(
      `SELECT id, project_id, occurred_at, actor_ref, agent_session_id, operation, policy_decision, resource_ref, change_ref, result_code, request_id, correlation_id, classification
       FROM audit_events WHERE project_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    ).all(projectId, limit) as Array<Record<string, unknown>>;
    return rows.flatMap((row) => typeof row.id === "string" && typeof row.project_id === "string" && typeof row.occurred_at === "string" && typeof row.operation === "string"
      ? [{ id: row.id, projectId: row.project_id as ProjectId, occurredAt: row.occurred_at, ...(typeof row.actor_ref === "string" ? { actorRef: row.actor_ref } : {}), ...(typeof row.agent_session_id === "string" ? { agentSessionId: row.agent_session_id } : {}), operation: row.operation, ...(typeof row.policy_decision === "string" ? { policyDecision: row.policy_decision as AuditRecord["policyDecision"] } : {}), ...(typeof row.resource_ref === "string" ? { resourceRef: row.resource_ref } : {}), ...(typeof row.change_ref === "string" ? { changeRef: row.change_ref } : {}), ...(typeof row.result_code === "string" ? { resultCode: row.result_code } : {}), ...(typeof row.request_id === "string" ? { requestId: row.request_id } : {}), ...(typeof row.correlation_id === "string" ? { correlationId: row.correlation_id } : {}), ...(typeof row.classification === "string" ? { classification: row.classification } : {}) }]
      : []);
  }

  async checkIdempotency(input: IdempotencyInput): Promise<StoredIdempotency | undefined> {
    return this.transact((transaction) => transaction.getIdempotency(input));
  }

  async recordIdempotency(record: StoredIdempotency): Promise<void> {
    await this.transact((transaction) => {
      transaction.putIdempotency(record);
    });
  }

  async listEvaluationResults<T>(projectId: ProjectId, runId: string): Promise<T[]> {
    try {
      return listEvaluationResults<T>(this.requireDb(), projectId, runId);
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async getEvaluationDecision<T>(projectId: ProjectId, runId: string): Promise<T | undefined> {
    try {
      return getEvaluationDecision<T>(this.requireDb(), projectId, runId);
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async getFeedbackPacket<T>(projectId: ProjectId, runId: string): Promise<T | undefined> {
    try {
      return getFeedbackPacket<T>(this.requireDb(), projectId, runId);
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async getRetryCycle<T>(projectId: ProjectId, runId: string): Promise<T | undefined> {
    try {
      return getRetryCycle<T>(this.requireDb(), projectId, runId);
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    }
  }

  async close(): Promise<void> {
    const db = this.db;
    this.db = undefined;
    if (!db) return;
    try {
      if (this.inTransaction) db.exec("ROLLBACK");
      db.close();
    } catch (error) {
      throw normalizeCoordinationStoreError(error);
    } finally {
      this.inTransaction = false;
    }
  }

  private transactionView(db: DatabaseSync): CoordinationTransaction {
    return {
      appendEvent: <T>(input: AppendEventInput<T>) => this.appendEventInTransaction(db, input),
      getProjection: <T>(kind: string, id: string) => getProjection<T>(db, kind, id),
      listProjections: <T>(kind: string, projectId: string) => listProjections<T>(db, kind, projectId),
      putProjection: <T>(kind: string, id: string, value: T, projectId?: string, updatedAt?: string) => putProjection(db, kind, id, value, projectId, updatedAt),
      applyCodeStateDelta: (input: CodeStateDeltaInput) => applyCodeStateDelta(db, input),
      appendAudit: (record: AuditRecord) => this.appendAuditInTransaction(db, record),
      getIdempotency: (input: IdempotencyInput) => this.getIdempotencyInTransaction(db, input),
      putIdempotency: (record: StoredIdempotency) => this.putIdempotencyInTransaction(db, record),
      listEvaluationResults: <T>(projectId: ProjectId, runId: string) => listEvaluationResults<T>(db, projectId, runId),
      getEvaluationDecision: <T>(projectId: ProjectId, runId: string) => getEvaluationDecision<T>(db, projectId, runId),
      getFeedbackPacket: <T>(projectId: ProjectId, runId: string) => getFeedbackPacket<T>(db, projectId, runId),
      getRetryCycle: <T>(projectId: ProjectId, runId: string) => getRetryCycle<T>(db, projectId, runId),
    };
  }

  private appendEventInTransaction<T>(db: DatabaseSync, input: AppendEventInput<T>): CoordinationEvent<T> {
    if (!input.projectId || !input.eventType || input.eventType.length > 128) throw err.invalidArgument("projectId and a bounded eventType are required");
    const sequence = this.nextSequence(db, input.projectId);
    const eventId = input.eventId ?? createEventId();
    const event: CoordinationEvent<T> = {
      schemaVersion: "1",
      projectId: input.projectId,
      sequence,
      eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      actor: input.actor,
      payload: input.payload,
    };
    db.prepare(
      `INSERT INTO event_log (project_id, sequence, event_id, event_type, occurred_at, actor_json, correlation_id, causation_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.projectId,
      Number(sequence),
      event.eventId,
      event.eventType,
      event.occurredAt,
      serializeJson(event.actor),
      event.correlationId ?? null,
      event.causationId ?? null,
      serializeJson(event.payload),
    );
    applyEventProjection(db, event);
    return event;
  }

  private nextSequence(db: DatabaseSync, projectId: string): bigint {
    const row = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM event_log WHERE project_id = ?").get(projectId) as { sequence?: unknown };
    const current = Number(row.sequence ?? 0);
    if (!Number.isSafeInteger(current) || current >= Number.MAX_SAFE_INTEGER) throw err.outputLimit("coordination event sequence exceeded safe integer range");
    return BigInt(current + 1);
  }

  private eventFromRow(row: EventRow): CoordinationEvent {
    return {
      schemaVersion: "1",
      projectId: row.project_id as CoordinationEvent["projectId"],
      sequence: BigInt(row.sequence),
      eventId: row.event_id as EventId,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      actor: parseJson(row.actor_json),
      ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
      ...(row.causation_id ? { causationId: row.causation_id } : {}),
      payload: parseJson(row.payload_json),
    };
  }

  private getIdempotencyInTransaction(db: DatabaseSync, input: IdempotencyInput): StoredIdempotency | undefined {
    if (!input.clientId || !input.key || !input.operationKind || !input.requestDigest) throw err.invalidArgument("idempotency metadata is required");
    db.prepare("DELETE FROM idempotency_keys WHERE expires_at IS NOT NULL AND expires_at <= ?").run(new Date().toISOString());
    const row = db.prepare(
      `SELECT client_id, idempotency_key, operation_kind, request_digest, result_ref, result_digest, expires_at
       FROM idempotency_keys WHERE client_id = ? AND idempotency_key = ?`,
    ).get(input.clientId, input.key) as IdempotencyRow | undefined;
    if (!row) return undefined;
    if (row.request_digest !== input.requestDigest || row.operation_kind !== input.operationKind) {
      throw err.idempotencyConflict("idempotency key was already used for a different request");
    }
    return {
      clientId: row.client_id,
      key: row.idempotency_key,
      operationKind: row.operation_kind,
      requestDigest: row.request_digest,
      ...(row.result_ref ? { resultRef: row.result_ref } : {}),
      ...(row.result_digest ? { resultDigest: row.result_digest } : {}),
      ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    };
  }

  private putIdempotencyInTransaction(db: DatabaseSync, record: StoredIdempotency): void {
    const existing = this.getIdempotencyInTransaction(db, record);
    if (existing) return;
    db.prepare(
      `INSERT INTO idempotency_keys (client_id, idempotency_key, operation_kind, request_digest, result_ref, result_digest, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(record.clientId, record.key, record.operationKind, record.requestDigest, record.resultRef ?? null, record.resultDigest ?? null, record.expiresAt ?? null);
  }

  private appendAuditInTransaction(db: DatabaseSync, record: AuditRecord): void {
    if (!record.id || !record.projectId || !record.operation || record.operation.length > 128) throw err.invalidArgument("audit record identity and operation are required and bounded");
    db.prepare(
      `INSERT INTO audit_events (id, project_id, occurred_at, actor_ref, agent_session_id, operation, policy_decision, resource_ref, change_ref, result_code, request_id, correlation_id, classification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(record.id, record.projectId, record.occurredAt, record.actorRef ?? null, record.agentSessionId ?? null, record.operation, record.policyDecision ?? null, record.resourceRef ?? null, record.changeRef ?? null, record.resultCode ?? null, record.requestId ?? null, record.correlationId ?? null, record.classification ?? null);
  }

  private boundedInteger(value: number, min: number, max: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw err.invalidArgument(`${label} must be between ${min} and ${max}`);
    return value;
  }

  private sequenceNumber(value: bigint): number {
    if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw err.invalidArgument("event sequence cursor is invalid");
    return Number(value);
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw err.coordinationStoreFailure("coordination store is not initialized");
    return this.db;
  }
}
