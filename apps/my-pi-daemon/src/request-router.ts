import type { IpcRequest } from "@my-pi/coordination-client";
import {
  CoordinationRuntime,
  type ClaimInput,
  type CompleteInput,
  type CoordinationSyncRequest,
  type DeclareIntentInput,
  type JoinInput,
  type PublishInput,
} from "@my-pi/coordination-runtime";
import { CodeStateIndexer, type IndexContext, type ProvenanceReport } from "@my-pi/code-state";
import type { EvaluationRuntime } from "@my-pi/evaluation-runtime";
import { SqliteCoordinationStore, type AuditRecord } from "@my-pi/coordination-store";
import { createEventId, err, isMyPiError, type AcceptancePolicy, type AgentSession, type ChangeReceipt, type ContextArtifactKind, type EvaluationResult, type IntentKind, type ProjectId, type Repository, type ScopeRef, type WorkDependency, type Worktree } from "@my-pi/contracts";
import { GRAPH_EVENT_TYPES_BY_KIND } from "@my-pi/graph-model";
import { redactEventForWire } from "@my-pi/observability";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { applyPayloadSubjectFilter, resolveGraphEventsScope } from "./graph-events.js";
import type { DaemonConfig } from "./config.js";
import type { DaemonHealth } from "./health.js";
import { verifyReceiptState } from "./change-service.js";
import { buildGraphSnapshot, buildGraphTrace, expandGraphSnapshot } from "./graph-service.js";
import { verifyJoinInput, type ScheduleCodeStateRegistration } from "./session-service.js";
import {
  actor,
  arrayParam,
  assertProject,
  graphBoundsParam,
  graphDepthParam,
  graphKindParam,
  jsonEvent,
  objectParam,
  optionalString,
  recordParams,
  requiredNumber,
  requiredString,
  requireTestMode,
  sequenceParam,
} from "./request-params.js";

export const SUPPORTED_OPERATIONS = [
  "health",
  "coord_join",
  "coord_claim",
  "coord_intent",
  "coord_sync",
  "coord_publish",
  "coord_complete",
  "coord_create_work_item",
  "change_record",
  "code_state_index",
  "code_state_snapshot",
  "graph_snapshot",
  "graph_expand",
  "graph_trace",
  "graph_events",
  "provenance_report",
  "eval_register_spec",
  "eval_request",
  "eval_record",
  "eval_evaluate",
  "eval_complete",
  "eval_status",
  "audit_list",
  "append_event",
  "list_events",
  "get_projection",
  "idempotency_check",
  "idempotency_record",
] as const;

export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];

export interface RouterDeps {
  runtime: CoordinationRuntime;
  evaluation: EvaluationRuntime;
  store: SqliteCoordinationStore;
  health: () => DaemonHealth;
  expectedProjectId: ProjectId;
  testMode?: boolean;
  daemonProject?: DaemonConfig["project"];
  scheduleCodeStateRegistration?: ScheduleCodeStateRegistration;
  registerProvenanceReceipt?: (receipt: ChangeReceipt) => void;
  provenanceReport?: (input: { projectId: ProjectId; worktreeId: string; path?: string; maxResults?: number }) => ProvenanceReport;
}

async function dispatchRequest(request: IpcRequest, deps: RouterDeps): Promise<unknown> {
  const { runtime, evaluation, store, health, expectedProjectId } = deps;
  const testMode = deps.testMode ?? false;
  const daemonProject = deps.daemonProject;
  const scheduleCodeStateRegistration = deps.scheduleCodeStateRegistration;
  const registerProvenanceReceipt = deps.registerProvenanceReceipt;
  const provenanceReport = deps.provenanceReport;
  const params = recordParams(request);
  switch (request.method) {
    case "health":
      return health();
    case "coord_join": {
      if (!daemonProject) throw err.coordinationStoreFailure("daemon project identity is unavailable");
      const verified = await verifyJoinInput(params, expectedProjectId, daemonProject, store, testMode);
      const result = await runtime.join({
        ...verified,
        host: requiredString(params, "host"),
        clientInstance: optionalString(params, "clientInstance"),
        role: optionalString(params, "role"),
      } satisfies JoinInput);
      if (scheduleCodeStateRegistration) {
        scheduleCodeStateRegistration({
          projectId: expectedProjectId,
          repositoryId: verified.repository.id,
          worktreeId: verified.worktree.id,
          repositoryIdentity: verified.repository.canonicalIdentity,
          root: verified.worktree.root,
        });
      }
      return { ...result, currentSequence: result.currentSequence.toString() };
    }
    case "coord_claim": {
      assertProject(params, expectedProjectId);
      const result = await runtime.claim({
        agentSessionId: requiredString(params, "agentSessionId") as never,
        workItemId: requiredString(params, "workItemId") as never,
        expectedVersion: requiredNumber(params, "expectedVersion"),
        allowShared: params.allowShared === true,
      } satisfies ClaimInput);
      return result;
    }
    case "coord_intent": {
      assertProject(params, expectedProjectId);
      const result = await runtime.declareIntent({
        agentSessionId: requiredString(params, "agentSessionId") as never,
        workItemId: optionalString(params, "workItemId") as never,
        kind: requiredString(params, "kind") as IntentKind,
        summary: requiredString(params, "summary"),
        targets: arrayParam<ScopeRef>(params, "targets"),
        expiresAt: optionalString(params, "expiresAt"),
      } satisfies DeclareIntentInput);
      return result;
    }
    case "coord_sync": {
      assertProject(params, expectedProjectId);
      const result = await runtime.sync({
        agentSessionId: requiredString(params, "agentSessionId") as never,
        sinceSequence: sequenceParam(params.sinceSequence),
        maxEvents: params.maxEvents as number | undefined,
        maxBytes: params.maxBytes as number | undefined,
      } satisfies CoordinationSyncRequest);
      return {
        ...result,
        throughSequence: result.throughSequence.toString(),
        highPriority: result.highPriority.map((item) => ({ ...item, event: jsonEvent(item.event as unknown as { sequence: bigint; [key: string]: unknown }) })),
        normalPriority: result.normalPriority.map((item) => ({ ...item, event: jsonEvent(item.event as unknown as { sequence: bigint; [key: string]: unknown }) })),
      };
    }
    case "coord_publish": {
      assertProject(params, expectedProjectId);
      const result = await runtime.publish({
        agentSessionId: requiredString(params, "agentSessionId") as never,
        workItemId: optionalString(params, "workItemId") as never,
        kind: requiredString(params, "kind") as ContextArtifactKind,
        contentDigest: requiredString(params, "contentDigest"),
        scopeIds: params.scopeIds === undefined ? undefined : arrayParam<never>(params, "scopeIds"),
        codeEntityIds: params.codeEntityIds === undefined ? undefined : arrayParam<never>(params, "codeEntityIds"),
        classification: requiredString(params, "classification"),
        retention: requiredString(params, "retention"),
        supersedes: optionalString(params, "supersedes") as never,
      } satisfies PublishInput);
      return result;
    }
    case "coord_complete": {
      assertProject(params, expectedProjectId);
      const result = await runtime.complete({
        agentSessionId: requiredString(params, "agentSessionId") as never,
        workItemId: requiredString(params, "workItemId") as never,
        evaluationRunId: optionalString(params, "evaluationRunId") as never,
      } satisfies CompleteInput);
      return { ...result, currentSequence: result.currentSequence.toString() };
    }
    case "coord_create_work_item": {
      assertProject(params, expectedProjectId);
      return runtime.createWorkItem({
        title: requiredString(params, "title"),
        summary: optionalString(params, "summary"),
        evaluationSpecId: optionalString(params, "evaluationSpecId") as never,
        dependencies: params.dependencies === undefined ? undefined : arrayParam<WorkDependency>(params, "dependencies"),
      });
    }
    case "change_record": {
      const receipt = objectParam(params, "receipt") as unknown as ChangeReceipt;
      await verifyReceiptState(receipt, store, expectedProjectId);
      const recorded = await runtime.recordChangeReceipt(receipt);
      registerProvenanceReceipt?.(recorded);
      return recorded;
    }
    case "code_state_index": {
      requireTestMode(request.method, testMode);
      assertProject(params, expectedProjectId);
      const registeredWorktree = await store.getProjection<Worktree>("worktree", requiredString(params, "worktreeId"));
      if (!registeredWorktree) throw err.workItemNotFound("code-state worktree is not registered");
      if (registeredWorktree.repositoryId !== requiredString(params, "repositoryId")) throw err.projectNotFound("code-state repository does not match the registered worktree");
      const registeredRepository = await store.getProjection<Repository>("repository", registeredWorktree.repositoryId);
      if (!registeredRepository) throw err.projectNotFound("code-state repository is not registered");
      const runtimeForTest = new WorkspaceRuntime();
      await runtimeForTest.open({ root: registeredWorktree.root });
      const context: IndexContext = {
        projectId: expectedProjectId,
        repositoryId: registeredRepository.id,
        worktreeId: registeredWorktree.id,
        repositoryIdentity: registeredRepository.canonicalIdentity,
        root: registeredWorktree.root,
        signal: new AbortController().signal,
        resolveReadPath: (filePath) => runtimeForTest.pathPolicy.resolveForRead(runtimeForTest.workspaceOrThrow, filePath, { allowMissing: true }),
      };
      const relativePath = requiredString(params, "path");
      const delta = await new CodeStateIndexer(store).indexFile(context, relativePath);
      await store.appendEvent({
        projectId: expectedProjectId,
        eventType: "CodeGraphUpdated",
        actor: { kind: "system", name: "my-pi-daemon" },
        payload: { projectId: expectedProjectId, repositoryId: context.repositoryId, worktreeId: context.worktreeId, changedPath: delta.changedPath, entities: delta.entities.length, edges: delta.edges.length, providerHealth: delta.providerHealth },
      });
      return delta;
    }
    case "code_state_snapshot": {
      assertProject(params, expectedProjectId);
      return store.getCodeState(expectedProjectId, requiredString(params, "worktreeId"));
    }
    case "graph_snapshot": {
      assertProject(params, expectedProjectId);
      const kind = graphKindParam(params);
      const bounds = graphBoundsParam(params);
      return buildGraphSnapshot(store, expectedProjectId, kind, params, bounds);
    }
    case "graph_expand": {
      assertProject(params, expectedProjectId);
      const kind = graphKindParam(params);
      const bounds = graphBoundsParam(params);
      const snapshot = await buildGraphSnapshot(store, expectedProjectId, kind, params, { maxNodes: 10_000, maxEdges: 50_000, maxAttributeBytes: bounds.maxAttributeBytes });
      return expandGraphSnapshot(snapshot, requiredString(params, "nodeId"), graphDepthParam(params), bounds);
    }
    case "graph_trace": {
      assertProject(params, expectedProjectId);
      return buildGraphTrace(store, expectedProjectId, graphKindParam(params), params, graphBoundsParam(params));
    }
    case "graph_events": {
      assertProject(params, expectedProjectId);
      const kindParam = optionalString(params, "kind");
      const scope = resolveGraphEventsScope({
        kind: kindParam,
        mode: optionalString(params, "mode"),
        worktreeId: optionalString(params, "worktreeId"),
        subjectId: optionalString(params, "subjectId"),
        eventTypeByKind: GRAPH_EVENT_TYPES_BY_KIND,
      });
      if (!scope.ok) {
        throw scope.error === "invalid-mode"
          ? err.invalidArgument("mode must be live or replay")
          : err.invalidArgument("kind is invalid");
      }
      const mode = (optionalString(params, "mode") ?? "live") as "live" | "replay";
      const maxEvents = Math.min(Math.max(params.maxEvents === undefined ? 100 : requiredNumber(params, "maxEvents"), 1), 1000);
      const maxBytes = Math.min(Math.max(params.maxBytes === undefined ? 256 * 1024 : requiredNumber(params, "maxBytes"), 1024), 1024 * 1024);
      const afterSequence = sequenceParam(params.afterSequence, "afterSequence");
      const fromSequence = sequenceParam(params.fromSequence, "fromSequence");
      const toSequence = sequenceParam(params.toSequence, "toSequence");

      const page = await store.listEvents({
        projectId: expectedProjectId,
        afterSequence,
        fromSequence,
        toSequence,
        limit: maxEvents,
        maxBytes,
        ...(scope.eventTypeIn === undefined ? {} : { eventTypeIn: scope.eventTypeIn }),
      });
      let events = page.events;
      let degraded = scope.degraded;
      if (scope.payloadWorktreeFilter !== undefined) {
        const kept: typeof events = [];
        let filteringIncomplete = false;
        for (const event of events) {
          const payload = event.payload;
          const eventWorktreeId = payload !== null && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as { worktreeId?: unknown }).worktreeId
            : undefined;
          if (typeof eventWorktreeId === "string") {
            if (eventWorktreeId === scope.payloadWorktreeFilter) kept.push(event);
          } else {
            kept.push(event);
            filteringIncomplete = true;
          }
        }
        events = kept;
        if (filteringIncomplete && degraded === undefined) {
          degraded = { provider: "graph-events", reason: "scope filtering incomplete" };
        }
      }
      if (scope.payloadSubjectFilter !== undefined) {
        const subject = applyPayloadSubjectFilter(events, scope.payloadSubjectFilter);
        events = subject.events;
        if (subject.filteringIncomplete && degraded === undefined) {
          degraded = { provider: "graph-events", reason: "scope filtering incomplete" };
        }
      }

      return {
        events: events.map((event) => jsonEvent(redactEventForWire(event) as unknown as { sequence: bigint; [key: string]: unknown })),
        throughSequence: page.throughSequence.toString(),
        hasMore: page.hasMore,
        mode,
        ...(kindParam === undefined ? {} : { kind: kindParam }),
        ...(degraded === undefined ? {} : { degraded }),
      };
    }
    case "provenance_report": {
      assertProject(params, expectedProjectId);
      const maxResults = params.maxResults === undefined ? undefined : requiredNumber(params, "maxResults");
      if (maxResults !== undefined && (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 2_048)) throw err.invalidArgument("maxResults is out of bounds");
      const result = provenanceReport?.({ projectId: expectedProjectId, worktreeId: requiredString(params, "worktreeId"), path: optionalString(params, "path"), maxResults });
      return result ?? { schemaVersion: "my-pi/provenance-report/v1", projectId: expectedProjectId, worktreeId: requiredString(params, "worktreeId"), results: [], truncated: false, degraded: { provider: "code-state", reason: "provenance reporting is unavailable" } };
    }
    case "eval_register_spec":
      return evaluation.registerSpec({ name: requiredString(params, "name"), criteria: arrayParam(params, "criteria") as never, acceptancePolicy: params.acceptancePolicy as Partial<AcceptancePolicy> | undefined });
    case "eval_request":
      return evaluation.requestRun({ specId: requiredString(params, "specId") as never, workItemId: requiredString(params, "workItemId") as never, intentId: optionalString(params, "intentId") as never, changeReceiptId: optionalString(params, "changeReceiptId") as never, repositoryStateRef: requiredString(params, "repositoryStateRef"), attempt: params.attempt as number | undefined });
    case "eval_record": {
      const value = objectParam(params, "result") as unknown as EvaluationResult;
      return evaluation.recordExternalResult(requiredString(params, "runId") as never, { providerResultId: requiredString(params, "providerResultId"), providerId: requiredString(params, "providerId"), criterionId: requiredString(params, "criterionId"), result: value });
    }
    case "eval_evaluate": {
      const observed = params.observed === undefined ? {} : objectParam(params, "observed");
      const status = await evaluation.evaluateRun(requiredString(params, "runId") as never, observed);
      await runtime.applyEvaluationDecision(status.run.id);
      return status;
    }
    case "eval_complete": {
      const status = await evaluation.completeRun(requiredString(params, "runId") as never);
      await runtime.applyEvaluationDecision(status.run.id);
      return status;
    }
    case "eval_status":
      return evaluation.status(requiredString(params, "runId") as never);
    case "audit_list":
      assertProject(params, expectedProjectId);
      return store.listAudit(expectedProjectId, params.limit === undefined ? undefined : requiredNumber(params, "limit"));
    case "append_event": {
      requireTestMode(request.method, testMode);
      assertProject(params, expectedProjectId);
      const event = await store.appendEvent({
        projectId: requiredString(params, "projectId") as ProjectId,
        ...(optionalString(params, "eventId") === undefined ? {} : { eventId: optionalString(params, "eventId") as never }),
        eventType: requiredString(params, "eventType"),
        occurredAt: optionalString(params, "occurredAt"),
        actor: actor(params),
        correlationId: optionalString(params, "correlationId"),
        causationId: optionalString(params, "causationId"),
        payload: params.payload,
      });
      return jsonEvent(event as unknown as { sequence: bigint; [key: string]: unknown });
    }
    case "list_events": {
      assertProject(params, expectedProjectId);
      const page = await store.listEvents({
        projectId: requiredString(params, "projectId") as ProjectId,
        afterSequence: sequenceParam(params.afterSequence),
        limit: params.limit as number | undefined,
        maxBytes: params.maxBytes as number | undefined,
      });
      return { events: page.events.map((event) => jsonEvent(event as unknown as { sequence: bigint; [key: string]: unknown })), throughSequence: page.throughSequence.toString(), hasMore: page.hasMore };
    }
    case "get_projection":
      assertProject(params, expectedProjectId);
      return store.getProjection(requiredString(params, "kind"), requiredString(params, "id"));
    case "idempotency_check":
      return store.checkIdempotency({
        clientId: requiredString(params, "clientId"),
        key: requiredString(params, "key"),
        operationKind: requiredString(params, "operationKind"),
        requestDigest: requiredString(params, "requestDigest"),
      });
    case "idempotency_record":
      requireTestMode(request.method, testMode);
      await store.recordIdempotency({
        clientId: requiredString(params, "clientId"),
        key: requiredString(params, "key"),
        operationKind: requiredString(params, "operationKind"),
        requestDigest: requiredString(params, "requestDigest"),
        resultRef: optionalString(params, "resultRef"),
        resultDigest: optionalString(params, "resultDigest"),
        expiresAt: optionalString(params, "expiresAt"),
      });
      return { recorded: true };
    default:
      throw Object.assign(new Error(`unsupported coordination method: ${request.method}`), { code: "ERR_INVALID_ARGUMENT" });
  }
}

async function recordAudit(store: SqliteCoordinationStore, request: IpcRequest, projectId: ProjectId, resultCode: string): Promise<void> {
  const record: AuditRecord = {
    id: createEventId(),
    projectId,
    occurredAt: new Date().toISOString(),
    actorRef: request.clientInfo.name,
    operation: request.method,
    policyDecision: resultCode === "OK" ? "ALLOW" : "DENY",
    resultCode,
    requestId: request.requestId,
  };
  await store.appendAudit(record).catch(() => undefined);
}

export interface RequestRouter {
  handle: (request: IpcRequest) => Promise<unknown>;
  supportedOperations: readonly string[];
}

/**
 * Transport-agnostic request router: operation name -> domain handler.
 * Owns no transport state and formats no wire frames; the IPC server wraps
 * `handle` with framing, protocol-version checks and timing.
 */
export function createRequestRouter(deps: RouterDeps): RequestRouter {
  const handle = async (request: IpcRequest): Promise<unknown> => {
    try {
      const result = await dispatchRequest(request, deps);
      await recordAudit(deps.store, request, deps.expectedProjectId, "OK");
      return result;
    } catch (error) {
      await recordAudit(deps.store, request, deps.expectedProjectId, isMyPiError(error) ? error.code : ((error as { code?: unknown }).code as string | undefined) ?? "ERR_UNKNOWN");
      throw error;
    }
  };
  return { handle, supportedOperations: SUPPORTED_OPERATIONS };
}
