import type { DatabaseSync } from "node:sqlite";
import { createEventId, err, type CodeEdge, type CodeEntity, type CoordinationEvent, type FileFingerprint } from "@my-pi/contracts";
import type { CodeStateDeltaInput, CodeStateSnapshot } from "./store.js";

type JsonRecord = Record<string, unknown>;

export function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, nested) =>
    typeof nested === "bigint" ? { __myPiBigInt: nested.toString() } : nested,
  );
  if (serialized === undefined) throw err.invalidArgument("coordination payload must be JSON serializable");
  return serialized;
}

export function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value, (_key, nested) => {
      if (nested && typeof nested === "object" && "__myPiBigInt" in nested) {
        return BigInt(String((nested as JsonRecord).__myPiBigInt));
      }
      return nested;
    }) as T;
  } catch (error) {
    throw err.coordinationStoreFailure(`invalid persisted JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function stringField(value: JsonRecord | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function numberField(value: JsonRecord | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isSafeInteger(field) ? field : undefined;
}

export function putProjection<T>(db: DatabaseSync, kind: string, id: string, value: T, projectId?: string, updatedAt = new Date().toISOString()): void {
  const payloadJson = serializeJson(value);
  db.prepare(
    `INSERT INTO projection_records (kind, id, project_id, payload_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind, id) DO UPDATE SET project_id=excluded.project_id, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
  ).run(kind, id, projectId ?? null, payloadJson, updatedAt);

  if (kind === "project") {
    db.prepare(
      `INSERT INTO projects (id, payload_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
    ).run(id, payloadJson, updatedAt);
  } else if (kind === "agent_session") {
    if (!projectId) throw err.invalidArgument("agent_session projection requires projectId");
    db.prepare(
      `INSERT INTO agent_sessions (id, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
    ).run(id, projectId, payloadJson, updatedAt);
  }

  const record = asRecord(value);
  const evaluationSpecId = stringField(record, "id");
  const evaluationSpecVersion = numberField(record, "version");
  const evaluationSpecDigest = stringField(record, "specDigest");
  const evaluationSpecCreatedAt = stringField(record, "createdAt");
  if (kind === "evaluation_spec" && projectId && evaluationSpecId && evaluationSpecVersion !== undefined && evaluationSpecDigest && evaluationSpecCreatedAt) {
    db.prepare(
      `INSERT INTO evaluation_specs (id, project_id, version, spec_digest, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, version=excluded.version, spec_digest=excluded.spec_digest, payload_json=excluded.payload_json, created_at=excluded.created_at`,
    ).run(evaluationSpecId!, projectId, evaluationSpecVersion!, evaluationSpecDigest!, payloadJson, evaluationSpecCreatedAt!);
  } else {
    const evaluationRunId = stringField(record, "id");
    const evaluationRunSpecId = stringField(record, "specId");
    const evaluationRunSpecVersion = numberField(record, "specVersion");
    const evaluationRunTarget = stringField(record, "repositoryStateRef");
    const evaluationRunWorkItem = stringField(record, "workItemId");
    const evaluationRunAttempt = numberField(record, "attempt");
    const evaluationRunState = stringField(record, "state");
    if (kind === "evaluation_run" && projectId && evaluationRunId && evaluationRunSpecId && evaluationRunSpecVersion !== undefined && evaluationRunTarget && evaluationRunWorkItem && evaluationRunAttempt !== undefined && evaluationRunState) {
    db.prepare(
      `INSERT INTO evaluation_runs (id, project_id, spec_id, spec_version, target_state_ref, work_item_id, attempt, state, payload_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, spec_id=excluded.spec_id, spec_version=excluded.spec_version, target_state_ref=excluded.target_state_ref, work_item_id=excluded.work_item_id, attempt=excluded.attempt, state=excluded.state, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
      ).run(evaluationRunId!, projectId, evaluationRunSpecId!, evaluationRunSpecVersion!, evaluationRunTarget!, evaluationRunWorkItem!, evaluationRunAttempt!, evaluationRunState!, payloadJson, updatedAt);
    } else {
      const evaluationResultRunId = stringField(record, "runId");
      const evaluationResultCriterionId = stringField(record, "criterionId");
      const evaluationResultProviderResultId = stringField(record, "providerResultId");
      const evaluationResultDigest = stringField(record, "resultDigest");
      const evaluationResultRecordedAt = stringField(record, "recordedAt");
      if (kind === "evaluation_result" && projectId && evaluationResultRunId && evaluationResultCriterionId && evaluationResultProviderResultId && evaluationResultDigest && evaluationResultRecordedAt) {
    db.prepare(
      `INSERT INTO evaluation_results (run_id, criterion_id, provider_result_id, result_digest, payload_json, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, criterion_id, provider_result_id) DO UPDATE SET result_digest=excluded.result_digest, payload_json=excluded.payload_json, recorded_at=excluded.recorded_at`,
        ).run(evaluationResultRunId!, evaluationResultCriterionId!, evaluationResultProviderResultId!, evaluationResultDigest!, payloadJson, evaluationResultRecordedAt!);
      } else {
        const evaluationDecisionRunId = stringField(record, "runId");
        const evaluationDecision = stringField(record, "decision");
        const evaluationDecisionDigest = stringField(record, "decisionDigest");
        if (kind === "evaluation_decision" && projectId && evaluationDecisionRunId && evaluationDecision && evaluationDecisionDigest) {
    db.prepare(
      `INSERT INTO acceptance_decisions (run_id, decision, decision_digest, payload_json, decided_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET decision=excluded.decision, decision_digest=excluded.decision_digest, payload_json=excluded.payload_json, decided_at=excluded.decided_at`,
          ).run(evaluationDecisionRunId!, evaluationDecision!, evaluationDecisionDigest!, payloadJson, updatedAt);
        } else {
          const feedbackId = stringField(record, "id");
          const feedbackRunId = stringField(record, "runId");
          if (kind === "feedback_packet" && projectId && feedbackId && feedbackRunId) {
    db.prepare(
      `INSERT INTO feedback_packets (id, run_id, payload_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, payload_json=excluded.payload_json, created_at=excluded.created_at`,
            ).run(feedbackId!, feedbackRunId!, payloadJson, updatedAt);
          } else {
            const retryId = stringField(record, "id");
            const retryRunId = stringField(record, "runId");
            const retryAttempt = numberField(record, "attempt");
            const retryMaxAttempts = numberField(record, "maxAttempts");
            const retryState = stringField(record, "state");
            if (kind === "retry_cycle" && projectId && retryId && retryRunId && retryAttempt !== undefined && retryMaxAttempts !== undefined && retryState) {
    db.prepare(
      `INSERT INTO retry_cycles (id, run_id, attempt, max_attempts, state, payload_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, attempt=excluded.attempt, max_attempts=excluded.max_attempts, state=excluded.state, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
              ).run(retryId!, retryRunId!, retryAttempt!, retryMaxAttempts!, retryState!, payloadJson, updatedAt);
            }
          }
        }
      }
    }
  }
}

export function listEvaluationResults<T>(db: DatabaseSync, projectId: string, runId: string): T[] {
  const rows = db.prepare(
    `SELECT r.payload_json
     FROM evaluation_results r
     JOIN evaluation_runs run ON run.id = r.run_id
     WHERE run.project_id = ? AND r.run_id = ?
     ORDER BY r.criterion_id, r.provider_result_id`,
  ).all(projectId, runId) as Array<{ payload_json?: unknown }>;
  return rows.flatMap((row) => typeof row.payload_json === "string" ? [parseJson<T>(row.payload_json)] : []);
}

export function getEvaluationDecision<T>(db: DatabaseSync, projectId: string, runId: string): T | undefined {
  const row = db.prepare(
    `SELECT d.payload_json
     FROM acceptance_decisions d
     JOIN evaluation_runs run ON run.id = d.run_id
     WHERE run.project_id = ? AND d.run_id = ?`,
  ).get(projectId, runId) as { payload_json?: unknown } | undefined;
  return typeof row?.payload_json === "string" ? parseJson<T>(row.payload_json) : undefined;
}

export function getFeedbackPacket<T>(db: DatabaseSync, projectId: string, runId: string): T | undefined {
  const row = db.prepare(
    `SELECT f.payload_json
     FROM feedback_packets f
     JOIN evaluation_runs run ON run.id = f.run_id
     WHERE run.project_id = ? AND f.run_id = ?
     ORDER BY f.created_at DESC, f.id DESC LIMIT 1`,
  ).get(projectId, runId) as { payload_json?: unknown } | undefined;
  return typeof row?.payload_json === "string" ? parseJson<T>(row.payload_json) : undefined;
}

export function getRetryCycle<T>(db: DatabaseSync, projectId: string, runId: string): T | undefined {
  const row = db.prepare(
    `SELECT r.payload_json
     FROM retry_cycles r
     JOIN evaluation_runs run ON run.id = r.run_id
     WHERE run.project_id = ? AND r.run_id = ?
     ORDER BY r.attempt DESC, r.updated_at DESC, r.id DESC LIMIT 1`,
  ).get(projectId, runId) as { payload_json?: unknown } | undefined;
  return typeof row?.payload_json === "string" ? parseJson<T>(row.payload_json) : undefined;
}

export function getProjection<T>(db: DatabaseSync, kind: string, id: string): T | undefined {
  const row = db.prepare("SELECT payload_json FROM projection_records WHERE kind = ? AND id = ?").get(kind, id) as { payload_json?: unknown } | undefined;
  if (!row || typeof row.payload_json !== "string") return undefined;
  return parseJson<T>(row.payload_json);
}

export function listProjections<T>(db: DatabaseSync, kind: string, projectId: string): Array<{ id: string; projectId?: string; value: T; updatedAt: string }> {
  const rows = db.prepare(
    "SELECT id, project_id, payload_json, updated_at FROM projection_records WHERE kind = ? AND project_id = ? ORDER BY id",
  ).all(kind, projectId) as Array<{ id?: unknown; project_id?: unknown; payload_json?: unknown; updated_at?: unknown }>;
  return rows.flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.payload_json !== "string" || typeof row.updated_at !== "string") return [];
    return [{
      id: row.id,
      ...(typeof row.project_id === "string" ? { projectId: row.project_id } : {}),
      value: parseJson<T>(row.payload_json),
      updatedAt: row.updated_at,
    }];
  });
}

export function applyCodeStateDelta(db: DatabaseSync, input: CodeStateDeltaInput): void {
  const oldRows = db.prepare(
    "SELECT id FROM code_entities WHERE project_id = ? AND worktree_id = ? AND path = ?",
  ).all(input.projectId, input.worktreeId, input.changedPath) as Array<{ id?: unknown }>;
  const entityIds = oldRows.flatMap((row) => typeof row.id === "string" ? [row.id] : []);
  for (const id of entityIds) {
    db.prepare("DELETE FROM code_edges WHERE project_id = ? AND worktree_id = ? AND (from_id = ? OR to_id = ?)").run(input.projectId, input.worktreeId, id, id);
  }
  db.prepare("DELETE FROM code_entities WHERE project_id = ? AND worktree_id = ? AND path = ?").run(input.projectId, input.worktreeId, input.changedPath);
  for (const stableKey of input.removedStableKeys) {
    const rows = db.prepare("SELECT id FROM code_entities WHERE project_id = ? AND worktree_id = ? AND stable_key = ?").all(input.projectId, input.worktreeId, stableKey) as Array<{ id?: unknown }>;
    for (const row of rows) {
      if (typeof row.id !== "string") continue;
      db.prepare("DELETE FROM code_edges WHERE project_id = ? AND worktree_id = ? AND (from_id = ? OR to_id = ?)").run(input.projectId, input.worktreeId, row.id, row.id);
    }
    db.prepare("DELETE FROM code_entities WHERE project_id = ? AND worktree_id = ? AND stable_key = ?").run(input.projectId, input.worktreeId, stableKey);
  }

  for (const entity of input.entities) {
    db.prepare(
      `INSERT INTO code_entities (id, project_id, repository_id, worktree_id, kind, stable_key, display_name, path, symbol_kind, fingerprint_json, observed_at, provider)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, repository_id=excluded.repository_id, worktree_id=excluded.worktree_id, kind=excluded.kind, stable_key=excluded.stable_key, display_name=excluded.display_name, path=excluded.path, symbol_kind=excluded.symbol_kind, fingerprint_json=excluded.fingerprint_json, observed_at=excluded.observed_at, provider=excluded.provider`,
    ).run(
      entity.id,
      entity.projectId,
      entity.repositoryId,
      entity.worktreeId ?? input.worktreeId,
      entity.kind,
      entity.stableKey,
      entity.displayName,
      entity.path ?? null,
      entity.symbolKind ?? null,
      entity.fingerprint === undefined ? null : serializeJson(entity.fingerprint),
      entity.observedAt,
      entity.provider,
    );
  }
  for (const edge of input.edges) {
    db.prepare(
      `INSERT INTO code_edges (project_id, repository_id, worktree_id, from_id, to_id, edge_kind, confidence, provider, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, worktree_id, from_id, to_id, edge_kind, provider) DO UPDATE SET repository_id=excluded.repository_id, confidence=excluded.confidence, observed_at=excluded.observed_at`,
    ).run(input.projectId, input.repositoryId, input.worktreeId, edge.from, edge.to, edge.kind, edge.confidence, edge.provider, edge.observedAt);
  }
  db.prepare(
    `INSERT INTO code_index_runs (id, project_id, repository_id, worktree_id, changed_path, observed_at, status, entity_count, edge_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(createEventId(), input.projectId, input.repositoryId, input.worktreeId, input.changedPath, input.observedAt, "completed", input.entities.length, input.edges.length);
  for (const [provider, health] of Object.entries(input.providerHealth ?? {})) {
    db.prepare(
      `INSERT INTO code_provider_health (project_id, worktree_id, provider, status, message, observed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, worktree_id, provider) DO UPDATE SET status=excluded.status, message=excluded.message, observed_at=excluded.observed_at`,
    ).run(input.projectId, input.worktreeId, provider, health.status, health.message ?? null, input.observedAt);
  }
}

export function getCodeState(db: DatabaseSync, projectId: string, worktreeId: string): CodeStateSnapshot {
  const entityRows = db.prepare(
    "SELECT id, project_id, repository_id, worktree_id, kind, stable_key, display_name, path, symbol_kind, fingerprint_json, observed_at, provider FROM code_entities WHERE project_id = ? AND worktree_id = ? ORDER BY stable_key LIMIT 100000",
  ).all(projectId, worktreeId) as Array<Record<string, unknown>>;
  const entities = entityRows.flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.project_id !== "string" || typeof row.repository_id !== "string" || typeof row.kind !== "string" || typeof row.stable_key !== "string" || typeof row.display_name !== "string" || typeof row.observed_at !== "string" || typeof row.provider !== "string") return [];
    return [{
      id: row.id as CodeEntity["id"],
      projectId: row.project_id as CodeEntity["projectId"],
      repositoryId: row.repository_id as CodeEntity["repositoryId"],
      ...(typeof row.worktree_id === "string" ? { worktreeId: row.worktree_id as CodeEntity["worktreeId"] } : {}),
      kind: row.kind as CodeEntity["kind"],
      stableKey: row.stable_key,
      displayName: row.display_name,
      ...(typeof row.path === "string" ? { path: row.path } : {}),
      ...(typeof row.symbol_kind === "string" ? { symbolKind: row.symbol_kind } : {}),
      ...(typeof row.fingerprint_json === "string" ? { fingerprint: parseJson<FileFingerprint>(row.fingerprint_json) } : {}),
      observedAt: row.observed_at,
      provider: row.provider as CodeEntity["provider"],
    }];
  });
  const edgeRows = db.prepare(
    "SELECT from_id, to_id, edge_kind, confidence, provider, observed_at FROM code_edges WHERE project_id = ? AND worktree_id = ? ORDER BY from_id, to_id LIMIT 200000",
  ).all(projectId, worktreeId) as Array<Record<string, unknown>>;
  const edges = edgeRows.flatMap((row) => {
    if (typeof row.from_id !== "string" || typeof row.to_id !== "string" || typeof row.edge_kind !== "string" || typeof row.confidence !== "string" || typeof row.provider !== "string" || typeof row.observed_at !== "string") return [];
    return [{ from: row.from_id as CodeEdge["from"], to: row.to_id as CodeEdge["to"], kind: row.edge_kind as CodeEdge["kind"], confidence: row.confidence as CodeEdge["confidence"], provider: row.provider, observedAt: row.observed_at }];
  });
  return { entities, edges };
}

export function applyEventProjection(db: DatabaseSync, event: CoordinationEvent): void {
  const payload = asRecord(event.payload);
  if (!payload) return;

  if (event.eventType === "ProjectOpened") {
    putProjection(db, "project", stringField(payload, "id") ?? event.projectId, event.payload, event.projectId, event.occurredAt);
    return;
  }

  if (event.eventType === "AgentJoined") {
    const id = stringField(payload, "id");
    if (id) putProjection(db, "agent_session", id, event.payload, stringField(payload, "projectId") ?? event.projectId, event.occurredAt);
    return;
  }

  if (event.eventType === "AgentHeartbeat" || event.eventType === "AgentExpired") {
    const id = stringField(payload, "sessionId") ?? stringField(payload, "id");
    if (!id) return;
    const previous = getProjection<JsonRecord>(db, "agent_session", id) ?? {};
    const merged = { ...previous, ...payload };
    putProjection(db, "agent_session", id, merged, stringField(merged, "projectId") ?? event.projectId, event.occurredAt);
    return;
  }

  const projectionByEvent: Record<string, { kind: string; idField: string }> = {
    WorkItemCreated: { kind: "work_item", idField: "id" },
    WorkItemClaimed: { kind: "work_item", idField: "id" },
    WorkItemBlocked: { kind: "work_item", idField: "id" },
    WorkItemUnblocked: { kind: "work_item", idField: "id" },
    WorkItemImplementationComplete: { kind: "work_item", idField: "id" },
    WorkItemAwaitingEvaluation: { kind: "work_item", idField: "id" },
    WorkItemEvaluationAccepted: { kind: "work_item", idField: "id" },
    WorkItemEvaluationRejected: { kind: "work_item", idField: "id" },
    WorkItemEvaluationReviewRequired: { kind: "work_item", idField: "id" },
    WorkItemCompleted: { kind: "work_item", idField: "id" },
    IntentDeclared: { kind: "intent", idField: "id" },
    IntentSuperseded: { kind: "intent", idField: "id" },
    ScopeDeclared: { kind: "scope", idField: "id" },
    ScopeReleased: { kind: "scope", idField: "id" },
    ContextPublished: { kind: "context_artifact", idField: "id" },
    ImpactDetected: { kind: "impact_result", idField: "intentId" },
    ChangeApplied: { kind: "change_receipt", idField: "id" },
    ChangePartiallyApplied: { kind: "change_receipt", idField: "id" },
    ChangeRejected: { kind: "change_receipt", idField: "id" },
  };
  const projection = projectionByEvent[event.eventType];
  const id = projection ? stringField(payload, projection.idField) : undefined;
  if (projection && id) {
    putProjection(db, projection.kind, id, event.payload, stringField(payload, "projectId") ?? event.projectId, event.occurredAt);
  }
}
