import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type IpcRequest,
} from "@my-pi/coordination-client";
import {
  CoordinationRuntime,
  type ClaimInput,
  type CompleteInput,
  type DeclareIntentInput,
  type JoinInput,
  type PublishInput,
  type CoordinationSyncRequest,
} from "@my-pi/coordination-runtime";
import { CodeStateIndexer, type IndexContext } from "@my-pi/code-state";
import { DeterministicProvider, EvaluationRuntime } from "@my-pi/evaluation-runtime";
import {
  CURRENT_SCHEMA_VERSION as STORE_SCHEMA_VERSION,
  SqliteCoordinationStore,
  type AuditRecord,
} from "@my-pi/coordination-store";
import { createEventId, isMyPiError, type AcceptancePolicy, type ActorRef, type AgentSession, type ChangeReceipt, type ContextArtifactKind, type EvaluationResult, type IntentKind, type ProjectId, type Repository, type ScopeRef, type WorkDependency, type Worktree } from "@my-pi/contracts";
import { resolveDaemonConfig, type DaemonConfig } from "./config.js";
import { DaemonLifecycle } from "./lifecycle.js";
import type { DaemonHealth } from "./health.js";
import { IpcServer } from "./ipc-server.js";
import { acquireProjectLock, ProjectAlreadyRunningError } from "./project-lock.js";

interface CliOptions {
  workspaceRoot?: string;
  runtimeDir?: string;
  databasePath?: string;
  allowNonGit: boolean;
  protocolVersion?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { allowNonGit: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--workspace") options.workspaceRoot = argv[++index];
    else if (arg === "--runtime-dir") options.runtimeDir = argv[++index];
    else if (arg === "--database") options.databasePath = argv[++index];
    else if (arg === "--allow-non-git") options.allowNonGit = true;
    else if (arg === "--protocol-version") options.protocolVersion = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log("my-pi-daemon --workspace <git-root> [--runtime-dir <dir>] [--database <path>] [--allow-non-git]");
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.workspaceRoot) throw new Error("--workspace is required");
  return options;
}

function recordParams(request: IpcRequest): Record<string, unknown> {
  return request.params;
}

function requiredString(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) throw new Error(`${name} must be a bounded non-empty string`);
  return value;
}

function optionalString(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 1024) throw new Error(`${name} must be a bounded string`);
  return value;
}

function actor(params: Record<string, unknown>): ActorRef {
  const value = params.actor;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("actor must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "system" && typeof candidate.name === "string") return { kind: "system", name: candidate.name };
  if (candidate.kind === "agent_session" && typeof candidate.id === "string") return { kind: "agent_session", id: candidate.id as never };
  if (candidate.kind === "principal" && typeof candidate.id === "string") return { kind: "principal", id: candidate.id as never };
  throw new Error("actor shape is invalid");
}

function sequenceParam(value: unknown): bigint | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("afterSequence must be a decimal string");
  return BigInt(value);
}

function requiredNumber(params: Record<string, unknown>, name: string): number {
  const value = params[name];
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  return value as number;
}

function objectParam(params: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = params[name];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function arrayParam<T>(params: Record<string, unknown>, name: string): T[] {
  const value = params[name];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value as T[];
}

function assertProject(params: Record<string, unknown>, expectedProjectId: ProjectId): void {
  const projectId = requiredString(params, "projectId");
  if (projectId !== expectedProjectId) throw Object.assign(new Error("request project does not match this daemon"), { code: "ERR_PROJECT_NOT_FOUND" });
}

function jsonEvent(event: { sequence: bigint; [key: string]: unknown }): Record<string, unknown> {
  return { ...event, sequence: event.sequence.toString() };
}

async function writeMetadata(config: DaemonConfig, health: DaemonHealth): Promise<void> {
  const temporary = `${config.metadataPath}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(health, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, config.metadataPath);
  await chmod(config.metadataPath, 0o600).catch(() => undefined);
}

async function dispatchRequest(request: IpcRequest, runtime: CoordinationRuntime, evaluation: EvaluationRuntime, store: SqliteCoordinationStore, health: () => DaemonHealth, expectedProjectId: ProjectId, workspaceRoot: string): Promise<unknown> {
  const params = recordParams(request);
  switch (request.method) {
    case "health":
      return health();
    case "coord_join": {
      const repository = objectParam(params, "repository") as unknown as Repository;
      const worktree = objectParam(params, "worktree") as unknown as Worktree;
      const project = params.project === undefined ? undefined : objectParam(params, "project");
      const result = await runtime.join({
        ...(project === undefined ? {} : { project: { displayName: typeof project.displayName === "string" ? project.displayName : undefined, policyRef: project.policyRef as never } }),
        repository,
        worktree,
        host: requiredString(params, "host"),
        clientInstance: optionalString(params, "clientInstance"),
        role: optionalString(params, "role"),
      } satisfies JoinInput);
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
      const session = await store.getProjection<AgentSession>("agent_session", requiredString(params, "agentSessionId"));
      const codeState = session?.worktreeId ? await store.getCodeState(expectedProjectId, session.worktreeId).catch(() => undefined) : undefined;
      const result = await runtime.sync({
        agentSessionId: requiredString(params, "agentSessionId") as never,
        sinceSequence: sequenceParam(params.sinceSequence),
        maxEvents: params.maxEvents as number | undefined,
        maxBytes: params.maxBytes as number | undefined,
        codeState,
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
    case "change_record":
      return runtime.recordChangeReceipt(objectParam(params, "receipt") as unknown as ChangeReceipt);
    case "code_state_index": {
      assertProject(params, expectedProjectId);
      const context: IndexContext = {
        projectId: expectedProjectId,
        repositoryId: requiredString(params, "repositoryId") as never,
        worktreeId: requiredString(params, "worktreeId") as never,
        repositoryIdentity: requiredString(params, "repositoryIdentity"),
        root: workspaceRoot,
        signal: new AbortController().signal,
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
    case "eval_register_spec":
      return evaluation.registerSpec({ name: requiredString(params, "name"), criteria: arrayParam(params, "criteria") as never, acceptancePolicy: params.acceptancePolicy as Partial<AcceptancePolicy> | undefined });
    case "eval_request":
      return evaluation.requestRun({ specId: requiredString(params, "specId") as never, workItemId: requiredString(params, "workItemId") as never, intentId: optionalString(params, "intentId") as never, changeReceiptId: optionalString(params, "changeReceiptId") as never, repositoryStateRef: requiredString(params, "repositoryStateRef"), attempt: params.attempt as number | undefined });
    case "eval_record": {
      const value = objectParam(params, "result") as unknown as EvaluationResult;
      return evaluation.recordResult(requiredString(params, "runId") as never, { providerResultId: requiredString(params, "providerResultId"), providerId: requiredString(params, "providerId"), criterionId: requiredString(params, "criterionId"), result: value });
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

async function handleRequest(request: IpcRequest, runtime: CoordinationRuntime, evaluation: EvaluationRuntime, store: SqliteCoordinationStore, health: () => DaemonHealth, expectedProjectId: ProjectId, workspaceRoot: string): Promise<unknown> {
  try {
    const result = await dispatchRequest(request, runtime, evaluation, store, health, expectedProjectId, workspaceRoot);
    await recordAudit(store, request, expectedProjectId, "OK");
    return result;
  } catch (error) {
    await recordAudit(store, request, expectedProjectId, isMyPiError(error) ? error.code : ((error as { code?: unknown }).code as string | undefined) ?? "ERR_UNKNOWN");
    throw error;
  }
}

export async function runDaemon(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const config = await resolveDaemonConfig({
    workspaceRoot: options.workspaceRoot!,
    runtimeDir: options.runtimeDir,
    databasePath: options.databasePath,
    allowNonGit: options.allowNonGit,
    protocolVersion: options.protocolVersion,
  });
  const lock = await acquireProjectLock(config.lockPath);
  const lifecycle = new DaemonLifecycle();
  const startedAt = new Date().toISOString();
  const store = new SqliteCoordinationStore(config.databasePath);
  const coordination = new CoordinationRuntime(store, config.projectId);
  const evaluation = new EvaluationRuntime(store, config.projectId, [new DeterministicProvider()]);
  let ipc: IpcServer | undefined;
  let stopping = false;
  const health = (): DaemonHealth => ({
    schemaVersion: "1",
    protocolVersion: config.protocolVersion,
    storeSchemaVersion: STORE_SCHEMA_VERSION,
    state: lifecycle.state,
    projectId: config.projectId,
    projectKey: config.project.projectKey,
    projectRoot: config.project.root,
    projectCanonicalIdentity: config.project.canonicalIdentity,
    endpoint: config.endpoint,
    pid: process.pid,
    startedAt,
    rssBytes: process.memoryUsage().rss,
    store: lifecycle.state === "stopping" ? "closed" : "ready",
  });
  try {
    await store.init();
    ipc = new IpcServer(config.endpoint, (request) => handleRequest(request, coordination, evaluation, store, health, config.projectId, config.workspaceRoot), config.maxFrameBytes, config.protocolVersion);
    await ipc.listen();
    lifecycle.set("ready");
    await writeMetadata(config, health());
    console.error(`[my-pi-daemon] ready project=${config.project.projectKey} transport=${config.endpoint.transport} pid=${process.pid}`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        if (stopping) return;
        stopping = true;
        resolve();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } finally {
    lifecycle.set("stopping");
    await ipc?.close();
    await store.close();
    await unlink(config.metadataPath).catch(() => undefined);
    await lock.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runDaemon().catch((error) => {
    if (error instanceof ProjectAlreadyRunningError) {
      console.error(`[my-pi-daemon] ${error.message}`);
    } else if (isMyPiError(error)) {
      console.error(`[my-pi-daemon] ${error.code}: ${error.message}`);
    } else {
      console.error(`[my-pi-daemon] ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  });
}
