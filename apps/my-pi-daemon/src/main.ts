import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverProjectIdentity,
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
import { verifyReceipt } from "@my-pi/change-runtime";
import { DeterministicProvider, EvaluationRuntime } from "@my-pi/evaluation-runtime";
import {
  CURRENT_SCHEMA_VERSION as STORE_SCHEMA_VERSION,
  SqliteCoordinationStore,
  type AuditRecord,
} from "@my-pi/coordination-store";
import { createEventId, err, fingerprintBytes, isMyPiError, type AcceptancePolicy, type ActorRef, type AgentSession, type ChangeReceipt, type ContextArtifactKind, type EvaluationResult, type IntentKind, type ProjectId, type Repository, type ScopeRef, type WorkDependency, type Worktree } from "@my-pi/contracts";
import { resolveDaemonConfig, type DaemonConfig } from "./config.js";
import { DaemonLifecycle } from "./lifecycle.js";
import type { DaemonHealth } from "./health.js";
import { IpcServer } from "./ipc-server.js";
import { acquireProjectLock, ProjectAlreadyRunningError } from "./project-lock.js";
import { CodeStateManager } from "./code-state-manager.js";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";

interface CliOptions {
  workspaceRoot?: string;
  runtimeDir?: string;
  databasePath?: string;
  allowNonGit: boolean;
  testMode: boolean;
  protocolVersion?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { allowNonGit: false, testMode: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--workspace") options.workspaceRoot = argv[++index];
    else if (arg === "--runtime-dir") options.runtimeDir = argv[++index];
    else if (arg === "--database") options.databasePath = argv[++index];
    else if (arg === "--allow-non-git") options.allowNonGit = true;
    else if (arg === "--test-mode") options.testMode = true;
    else if (arg === "--protocol-version") options.protocolVersion = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log("my-pi-daemon --workspace <git-root> [--runtime-dir <dir>] [--database <path>] [--allow-non-git] [--test-mode]");
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

async function verifyJoinInput(params: Record<string, unknown>, expectedProjectId: ProjectId, daemonProject: DaemonConfig["project"], store: SqliteCoordinationStore, testMode: boolean): Promise<{ project?: JoinInput["project"]; repository: Repository; worktree: Worktree }> {
  const repository = objectParam(params, "repository") as unknown as Repository;
  const worktree = objectParam(params, "worktree") as unknown as Worktree;
  const requestedRoot = requiredString(worktree as unknown as Record<string, unknown>, "root");
  if (repository.projectId !== expectedProjectId) throw err.projectNotFound("repository does not belong to this daemon project");
  if (worktree.repositoryId !== repository.id) throw err.invalidArgument("worktree does not belong to the supplied repository");
  const identity = await discoverProjectIdentity(requestedRoot, { allowNonGit: testMode });
  if (!testMode && identity.canonicalIdentity !== daemonProject.canonicalIdentity) throw err.projectNotFound("worktree repository identity does not match the daemon project");
  const existing = await store.getProjection<Worktree>("worktree", worktree.id);
  if (existing && (!samePath(existing.root, identity.root) || existing.repositoryId !== repository.id)) throw err.workItemConflict("worktree id is already bound to a different canonical root");
  const verifiedRepository: Repository = { ...repository, projectId: expectedProjectId, canonicalIdentity: identity.canonicalIdentity };
  const verifiedWorktree: Worktree = {
    ...worktree,
    root: identity.root,
    repositoryId: verifiedRepository.id,
    ...(identity.head === undefined ? {} : { head: identity.head }),
    ...(identity.branch === undefined ? {} : { branch: identity.branch }),
    observedAt: new Date().toISOString(),
  };
  const project = params.project === undefined ? undefined : objectParam(params, "project");
  return {
    ...(project === undefined ? {} : { project: { displayName: typeof project.displayName === "string" ? project.displayName : undefined, policyRef: project.policyRef as never } }),
    repository: verifiedRepository,
    worktree: verifiedWorktree,
  };
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function verifyReceiptState(receipt: ChangeReceipt, store: SqliteCoordinationStore, expectedProjectId: ProjectId): Promise<void> {
  if (!verifyReceipt(receipt)) throw err.evaluationResultConflict("change receipt integrity verification failed");
  if (receipt.projectId !== expectedProjectId || !receipt.worktreeId) throw err.evaluationResultConflict("change receipt is not bound to this project and worktree");
  const worktree = await store.getProjection<Worktree>("worktree", receipt.worktreeId);
  if (!worktree) throw err.workItemNotFound("change receipt worktree is not registered");
  const workspace = new WorkspaceRuntime();
  await workspace.open({ root: worktree.root });
  for (const version of receipt.outputVersions ?? []) {
    if (!version.path || path.isAbsolute(version.path) || version.path.split(/[\\/]/).includes("..")) throw err.pathOutsideWorkspace("change receipt contains an unsafe resource path");
    const resolved = await workspace.pathPolicy.resolveForRead(workspace.workspaceOrThrow, version.path);
    const actual = new Uint8Array(await readFile(resolved.absolute));
    if (version.fingerprint === undefined) throw err.evaluationResultConflict("change receipt output is missing its fingerprint");
    const observed = fingerprintBytes(actual);
    if (observed.digest !== version.fingerprint.digest || observed.size !== version.fingerprint.size) throw err.evaluationTargetStale(`change receipt output does not match the registered worktree: ${version.path}`);
  }
}

function requireTestMode(method: string, testMode: boolean): void {
  if (!testMode) throw err.permissionDenied(`${method} is available only in explicit daemon test mode`);
}

async function writeMetadata(config: DaemonConfig, health: DaemonHealth): Promise<void> {
  const temporary = `${config.metadataPath}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(health, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rename(temporary, config.metadataPath);
        await chmod(config.metadataPath, 0o600).catch(() => undefined);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!(["EPERM", "EBUSY", "ENOTEMPTY"] as string[]).includes(code ?? "") || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function dispatchRequest(request: IpcRequest, runtime: CoordinationRuntime, evaluation: EvaluationRuntime, store: SqliteCoordinationStore, health: () => DaemonHealth, expectedProjectId: ProjectId, testMode = false, daemonProject?: DaemonConfig["project"], codeStateManager?: CodeStateManager): Promise<unknown> {
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
      if (codeStateManager) {
        const worktreeRuntime = new WorkspaceRuntime();
        await worktreeRuntime.open({ root: verified.worktree.root });
        await codeStateManager.register({
          projectId: expectedProjectId,
          repositoryId: verified.repository.id,
          worktreeId: verified.worktree.id,
          repositoryIdentity: verified.repository.canonicalIdentity,
          root: verified.worktree.root,
          signal: new AbortController().signal,
          resolveReadPath: (filePath) => worktreeRuntime.pathPolicy.resolveForRead(worktreeRuntime.workspaceOrThrow, filePath, { allowMissing: true }),
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
      return runtime.recordChangeReceipt(receipt);
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

async function handleRequest(request: IpcRequest, runtime: CoordinationRuntime, evaluation: EvaluationRuntime, store: SqliteCoordinationStore, health: () => DaemonHealth, expectedProjectId: ProjectId, testMode = false, daemonProject?: DaemonConfig["project"], codeStateManager?: CodeStateManager): Promise<unknown> {
  try {
    const result = await dispatchRequest(request, runtime, evaluation, store, health, expectedProjectId, testMode, daemonProject, codeStateManager);
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
  const codeStateManager = new CodeStateManager(store, {
    onReady: async (context) => {
      await coordination.refreshImpactsForWorktree(context.worktreeId);
    },
    onDelta: async (context, delta) => {
      await store.appendEvent({
        projectId: context.projectId,
        eventType: "CodeGraphUpdated",
        actor: { kind: "system", name: "code-state-manager" },
        payload: { projectId: context.projectId, repositoryId: context.repositoryId, worktreeId: context.worktreeId, changedPath: delta.changedPath, entities: delta.entities.length, edges: delta.edges.length, providerHealth: delta.providerHealth },
      });
      await coordination.refreshImpactsForWorktree(context.worktreeId);
    },
  });
  const evaluation = new EvaluationRuntime(store, config.projectId, [new DeterministicProvider()], {
    resolveStateRef: async (input) => {
      if (!input.changeReceiptId) {
        if (options.testMode) return input.repositoryStateRef;
        throw err.evaluationTargetStale("evaluation must reference a server-verified change receipt");
      }
      const receipt = await store.getProjection<ChangeReceipt>("change_receipt", input.changeReceiptId);
      if (!receipt) throw err.evaluationTargetStale("evaluation change receipt is missing or invalid");
      await verifyReceiptState(receipt, store, config.projectId);
      const derived = `receipt:${receipt.id}:${receipt.receiptDigest}`;
      if (input.repositoryStateRef !== receipt.id && input.repositoryStateRef !== derived) throw err.evaluationTargetStale("evaluation target does not match the server-verified change receipt");
      return derived;
    },
  });
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
    codeState: codeStateManager.health(),
  });
  try {
    await store.init();
    ipc = new IpcServer(config.endpoint, (request) => handleRequest(request, coordination, evaluation, store, health, config.projectId, options.testMode, config.project, codeStateManager), config.maxFrameBytes, config.protocolVersion);
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
    await codeStateManager.stop();
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
