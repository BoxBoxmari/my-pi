import {
  createAgentSessionId,
  createContextArtifactId,
  createIntentId,
  createProjectId,
  createWorkItemId,
  err,
  type AgentSession,
  type ContextArtifact,
  type ChangeReceipt,
  type AcceptanceDecision,
  type EvaluationRun,
  type EvaluationSpec,
  type EvaluationSpecId,
  type Intent,
  type Project,
  type ProjectId,
  type Repository,
  type Scope,
  type WorkDependency,
  type WorkItem,
  type Worktree,
} from "@my-pi/contracts";
import type { CoordinationStore } from "@my-pi/coordination-store";
import { ContextRouter } from "@my-pi/context-router";
import { ImpactEngine } from "@my-pi/impact-engine";
import { dependencyBlockers } from "./work-graph.js";
import { DEFAULT_LEASE_MS, leaseFor, sessionExpired } from "./session-leases.js";
import { validateJoinInput, type JoinInput, type JoinResult } from "./join.js";
import { validateClaimInput, type ClaimInput } from "./claim.js";
import { validateIntentInput, type DeclareIntentInput, type IntentDraft } from "./intent.js";
import { artifactFromInput, validatePublishInput, type PublishInput } from "./publish.js";
import { type CoordinationSyncRequest, type CoordinationSyncResult } from "./sync.js";
import type { CompleteInput } from "./complete.js";

export interface CoordinationRuntimeOptions {
  now?: () => Date;
  leaseMs?: number;
}

export interface CompleteResult {
  workItem: WorkItem;
  releasedIntentIds: string[];
  releasedScopeIds: string[];
  unblockedWorkItemIds: string[];
  currentSequence: bigint;
}

export class CoordinationRuntime {
  readonly projectId: ProjectId;
  private readonly now: () => Date;
  private readonly leaseMs: number;

  constructor(private readonly store: CoordinationStore, projectId?: ProjectId, options: CoordinationRuntimeOptions = {}) {
    this.projectId = projectId ?? createProjectId();
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  async join(input: JoinInput): Promise<JoinResult> {
    validateJoinInput(input, this.projectId);
    return this.store.transact((tx) => {
      const now = this.now();
      let currentSequence = 0n;
      if (!tx.getProjection<Project>("project", this.projectId)) {
        const project: Project = {
          id: this.projectId,
          schemaVersion: "1",
          ...(input.project?.displayName === undefined ? {} : { displayName: input.project.displayName }),
          createdAt: now.toISOString(),
          ...(input.project?.policyRef === undefined ? {} : { policyRef: input.project.policyRef }),
        };
        currentSequence = tx.appendEvent({ projectId: this.projectId, eventType: "ProjectOpened", occurredAt: now.toISOString(), actor: { kind: "system", name: "my-pi-daemon" }, payload: project }).sequence;
      }
      tx.putProjection("repository", input.repository.id, input.repository, this.projectId, now.toISOString());
      tx.putProjection("worktree", input.worktree.id, input.worktree, this.projectId, now.toISOString());
      const session: AgentSession = {
        id: createAgentSessionId(),
        projectId: this.projectId,
        worktreeId: input.worktree.id,
        host: input.host,
        ...(input.clientInstance === undefined ? {} : { clientInstance: input.clientInstance }),
        ...(input.role === undefined ? {} : { role: input.role }),
        status: "active",
        joinedAt: now.toISOString(),
        heartbeatAt: now.toISOString(),
      };
      const event = tx.appendEvent({ projectId: this.projectId, eventType: "AgentJoined", occurredAt: now.toISOString(), actor: { kind: "agent_session", id: session.id }, payload: session });
      const lease = leaseFor(now, this.leaseMs);
      return { projectHandle: { projectId: this.projectId }, agentSessionId: session.id, currentSequence: event.sequence > currentSequence ? event.sequence : currentSequence, lease };
    });
  }

  async createWorkItem(input: { title: string; summary?: string; evaluationSpecId?: EvaluationSpecId; dependencies?: Array<Omit<WorkDependency, "from"> & { from?: WorkDependency["from"] }> }): Promise<WorkItem> {
    if (!input.title || input.title.length > 500) throw err.invalidArgument("work item title is required and bounded");
    return this.store.transact((tx) => {
      if (!tx.getProjection<Project>("project", this.projectId)) throw err.projectNotFound();
      if (input.evaluationSpecId !== undefined) {
        const spec = tx.getProjection<EvaluationSpec>("evaluation_spec", input.evaluationSpecId);
        if (!spec || spec.projectId !== this.projectId) throw err.evaluationSpecInvalid("work item evaluation spec is not owned by this project");
      }
      const now = this.now().toISOString();
      const item: WorkItem = { id: createWorkItemId(), projectId: this.projectId, title: input.title, ...(input.summary === undefined ? {} : { summary: input.summary }), ...(input.evaluationSpecId === undefined ? {} : { evaluationSpecId: input.evaluationSpecId }), state: "ready", version: 0, createdAt: now, updatedAt: now };
      tx.appendEvent({ projectId: this.projectId, eventType: "WorkItemCreated", occurredAt: now, actor: { kind: "system", name: "coordination-runtime" }, payload: item });
      for (const dependency of input.dependencies ?? []) {
        if (dependency.from !== undefined && dependency.from !== item.id) throw err.invalidArgument("new work item dependency must point from the new work item");
        if (!dependency.to || typeof dependency.to !== "string" || !["depends_on", "blocks", "implements", "verifies"].includes(dependency.type)) throw err.invalidArgument("work item dependency shape is invalid");
        const target = tx.getProjection<WorkItem>("work_item", dependency.to);
        if (!target || target.projectId !== this.projectId) throw err.workItemNotFound("work item dependency target was not found in this project");
        const storedDependency: WorkDependency = { from: item.id, to: dependency.to, type: dependency.type };
        tx.putProjection("work_dependency", `${storedDependency.from}:${storedDependency.to}:${storedDependency.type}`, storedDependency, this.projectId, now);
      }
      return item;
    });
  }

  async claim(input: ClaimInput): Promise<WorkItem> {
    validateClaimInput(input);
    const result = await this.store.transact<{ item: WorkItem; blockedBy?: string[] }>((tx) => {
      const session = tx.getProjection<AgentSession>("agent_session", input.agentSessionId);
      if (!session) throw err.agentSessionNotFound();
      if (sessionExpired(session, this.now())) throw err.agentSessionExpired();
      let item = tx.getProjection<WorkItem>("work_item", input.workItemId);
      if (!item) throw err.workItemNotFound();
      if (item.assignee === input.agentSessionId && (item.state === "claimed" || item.state === "active")) return { item };
      if (item.version !== input.expectedVersion) throw err.workItemConflict("work item version does not match expectedVersion");
      if (item.evaluationSpecId !== undefined && (item.state === "implementation_complete" || item.state === "awaiting_evaluation" || item.state === "accepted" || item.state === "review_required" || item.state === "done")) {
        throw err.workItemConflict(`work item cannot be claimed from evaluation state ${item.state}`);
      }
      const dependencies = tx.listProjections<WorkDependency>("work_dependency", this.projectId).map((record) => record.value);
      const items = new Map(tx.listProjections<WorkItem>("work_item", this.projectId).map((record) => [record.value.id, record.value] as const));
      const blockers = dependencyBlockers(item, dependencies, items);
      if (blockers.length > 0) {
        if (item.state !== "blocked") {
          item = { ...item, state: "blocked", assignee: input.agentSessionId, version: item.version + 1, updatedAt: this.now().toISOString() };
          tx.appendEvent({ projectId: this.projectId, eventType: "WorkItemBlocked", occurredAt: item.updatedAt, actor: { kind: "agent_session", id: input.agentSessionId }, payload: item });
        }
        return { blockedBy: blockers.map((blocker) => blocker.id), item };
      }
      if (item.assignee && item.assignee !== input.agentSessionId && !input.allowShared) throw err.workItemConflict("work item is already assigned to another agent");
      const updated: WorkItem = { ...item, state: "active", assignee: input.agentSessionId, version: item.version + 1, updatedAt: this.now().toISOString() };
      tx.appendEvent({ projectId: this.projectId, eventType: "WorkItemClaimed", occurredAt: updated.updatedAt, actor: { kind: "agent_session", id: input.agentSessionId }, payload: updated });
      return { item: updated };
    });
    if (result.blockedBy && result.blockedBy.length > 0) throw err.workItemBlocked(`work item is blocked by ${result.blockedBy.join(", ")}`);
    return result.item;
  }

  async declareIntent(input: DeclareIntentInput): Promise<IntentDraft> {
    validateIntentInput(input);
    const intent = await this.store.transact((tx) => {
      const session = tx.getProjection<AgentSession>("agent_session", input.agentSessionId);
      if (!session) throw err.agentSessionNotFound();
      if (sessionExpired(session, this.now())) throw err.agentSessionExpired();
      if (input.workItemId !== undefined) {
        const item = tx.getProjection<WorkItem>("work_item", input.workItemId);
        if (!item || item.projectId !== this.projectId) throw err.workItemNotFound();
        if (item.assignee !== undefined && item.assignee !== input.agentSessionId) throw err.workItemConflict("only the assigned agent can declare an intent for this work item");
      }
      const createdAt = this.now().toISOString();
      const intent: Intent = { id: createIntentId(), projectId: this.projectId, agentSessionId: input.agentSessionId, ...(input.workItemId === undefined ? {} : { workItemId: input.workItemId }), kind: input.kind, summary: input.summary, targets: input.targets, state: "active", createdAt, ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }) };
      tx.appendEvent({ projectId: this.projectId, eventType: "IntentDeclared", occurredAt: createdAt, actor: { kind: "agent_session", id: input.agentSessionId }, payload: intent });
      return intent;
    });
    await this.emitImpact(intent);
    return intent;
  }

  async publish(input: PublishInput): Promise<ContextArtifact> {
    validatePublishInput(input);
    return this.store.transact((tx) => {
      const session = tx.getProjection<AgentSession>("agent_session", input.agentSessionId);
      if (!session) throw err.agentSessionNotFound();
      if (sessionExpired(session, this.now())) throw err.agentSessionExpired();
      if (input.workItemId !== undefined) {
        const item = tx.getProjection<WorkItem>("work_item", input.workItemId);
        if (!item || item.projectId !== this.projectId) throw err.workItemNotFound();
        if (item.assignee !== undefined && item.assignee !== input.agentSessionId) throw err.workItemConflict("only the assigned agent can publish for this work item");
      }
      const createdAt = this.now().toISOString();
      const artifact = artifactFromInput(input, this.projectId, createContextArtifactId(), createdAt);
      tx.appendEvent({ projectId: this.projectId, eventType: "ContextPublished", occurredAt: createdAt, actor: { kind: "agent_session", id: input.agentSessionId }, payload: artifact });
      return artifact;
    });
  }

  async sync(input: CoordinationSyncRequest): Promise<CoordinationSyncResult> {
    if (!Number.isSafeInteger(input.maxEvents ?? 100) || (input.maxEvents ?? 100) < 1 || (input.maxEvents ?? 100) > 1000) throw err.invalidArgument("maxEvents must be between 1 and 1000");
    if (input.maxBytes !== undefined && (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 4 * 1024 * 1024)) throw err.invalidArgument("maxBytes is out of bounds");
    await this.store.transact((tx) => {
      const session = tx.getProjection<AgentSession>("agent_session", input.agentSessionId);
      if (!session) throw err.agentSessionNotFound();
      if (sessionExpired(session, this.now())) throw err.agentSessionExpired();
      const now = this.now().toISOString();
      const updated = { ...session, heartbeatAt: now };
      // Heartbeat freshness is projection state, not a durable lifecycle event.
      // Polling must not grow the event log linearly with coord_sync traffic.
      tx.putProjection("agent_session", session.id, { ...updated, sessionId: session.id }, this.projectId, now);
    });
    const workItems = await this.store.listProjections<WorkItem>("work_item", this.projectId);
    const dependencyRecords = await this.store.listProjections<WorkDependency>("work_dependency", this.projectId);
    const dependencies = dependencyRecords.map((record) => record.value);
    const assigned = workItems.map((record) => record.value).filter((item) => item.assignee === input.agentSessionId);
    const workItemIds = new Set(assigned.map((item) => item.id));
    const dependencyWorkItemIds = new Set(dependencies.filter((dependency) => workItemIds.has(dependency.from) && dependency.type === "depends_on").map((dependency) => dependency.to));
    const page = await this.store.listEvents({ projectId: this.projectId, afterSequence: input.sinceSequence ?? 0n, limit: input.maxEvents, maxBytes: input.maxBytes });
    // Impact is materialized when an intent or code-state update is observed.
    // Sync only reads bounded events and routes persisted ImpactDetected records;
    // it never reloads the full graph for every poll.
    const routed = new ContextRouter().route({
      agentSessionId: input.agentSessionId,
      currentWorkItemIds: [...workItemIds],
      dependencyWorkItemIds: [...dependencyWorkItemIds],
      sinceSequence: input.sinceSequence ?? 0n,
      events: page.events,
      maxEvents: input.maxEvents,
      maxBytes: input.maxBytes,
    });
    const items = new Map(workItems.map((record) => [record.value.id, record.value] as const));
    const blockedBy = assigned.flatMap((item) => dependencyBlockers(item, dependencies, items).map((blocker) => ({ id: blocker.id, title: blocker.title })));
    return { projectId: this.projectId, throughSequence: routed.throughSequence, highPriority: routed.highPriority, normalPriority: routed.normalPriority, blockedBy, warnings: page.hasMore ? ["sync result is bounded; more events remain"] : [] };
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    return this.store.transact((tx) => {
      const item = tx.getProjection<WorkItem>("work_item", input.workItemId);
      if (!item) throw err.workItemNotFound();
      if (item.assignee !== input.agentSessionId) throw err.workItemConflict("only the assigned agent can complete a work item");
      if (item.state === "done") return { workItem: item, releasedIntentIds: [], releasedScopeIds: [], unblockedWorkItemIds: [], currentSequence: 0n };
      if (item.evaluationSpecId !== undefined) {
        if (item.state === "accepted") {
          if (!item.acceptedEvaluationRunId) throw err.evaluationNotAccepted("accepted work item is missing its evaluation run reference");
          if (input.evaluationRunId !== undefined && input.evaluationRunId !== item.acceptedEvaluationRunId) throw err.evaluationNotAccepted("completion references a different evaluation run");
        } else if (item.state === "review_required") {
          throw err.evaluationNotAccepted("work item requires review before another completion attempt");
        } else if (item.state === "awaiting_evaluation") {
          return { workItem: item, releasedIntentIds: [], releasedScopeIds: [], unblockedWorkItemIds: [], currentSequence: 0n };
        } else {
          const now = this.now().toISOString();
          let currentSequence = 0n;
          let implementationComplete = item;
          if (item.state !== "implementation_complete") {
            implementationComplete = { ...item, state: "implementation_complete" as const, version: item.version + 1, updatedAt: now };
            currentSequence = tx.appendEvent({ projectId: this.projectId, eventType: "WorkItemImplementationComplete", occurredAt: now, actor: { kind: "agent_session", id: input.agentSessionId }, payload: implementationComplete }).sequence;
          }
          const awaiting = { ...implementationComplete, state: "awaiting_evaluation" as const, version: implementationComplete.version + 1, updatedAt: now };
          currentSequence = tx.appendEvent({ projectId: this.projectId, eventType: "WorkItemAwaitingEvaluation", occurredAt: now, actor: { kind: "agent_session", id: input.agentSessionId }, payload: awaiting }).sequence;
          return { workItem: awaiting, releasedIntentIds: [], releasedScopeIds: [], unblockedWorkItemIds: [], currentSequence };
        }
      }
      const now = this.now().toISOString();
      const completed = { ...item, state: "done" as const, version: item.version + 1, updatedAt: now };
      let currentSequence = tx.appendEvent({ projectId: this.projectId, eventType: "WorkItemCompleted", occurredAt: now, actor: { kind: "agent_session", id: input.agentSessionId }, payload: completed }).sequence;
      const releasedIntentIds: string[] = [];
      for (const record of tx.listProjections<Intent>("intent", this.projectId)) {
        const intent = record.value;
        if (intent.agentSessionId !== input.agentSessionId || intent.workItemId !== input.workItemId || intent.state !== "active") continue;
        const closed = { ...intent, state: "completed" as const };
        releasedIntentIds.push(intent.id);
        currentSequence = tx.appendEvent({ projectId: this.projectId, eventType: "IntentSuperseded", occurredAt: now, actor: { kind: "agent_session", id: input.agentSessionId }, payload: closed }).sequence;
      }
      const releasedScopeIds: string[] = [];
      for (const record of tx.listProjections<Scope>("scope", this.projectId)) {
        const scope = record.value;
        if (scope.agentSessionId !== input.agentSessionId || scope.releasedAt) continue;
        releasedScopeIds.push(scope.id);
        currentSequence = tx.appendEvent({ projectId: this.projectId, eventType: "ScopeReleased", occurredAt: now, actor: { kind: "agent_session", id: input.agentSessionId }, payload: { ...scope, releasedAt: now } }).sequence;
      }
      const dependencies = tx.listProjections<WorkDependency>("work_dependency", this.projectId).map((record) => record.value);
      const allItems = new Map(tx.listProjections<WorkItem>("work_item", this.projectId).map((record) => [record.value.id, record.value] as const));
      allItems.set(completed.id, completed);
      const unblockedWorkItemIds: string[] = [];
      for (const record of tx.listProjections<WorkItem>("work_item", this.projectId)) {
        const candidate = record.value;
        if (candidate.state !== "blocked") continue;
        if (dependencyBlockers(candidate, dependencies, allItems).length > 0) continue;
        const ready = { ...candidate, state: "ready" as const, version: candidate.version + 1, updatedAt: now };
        unblockedWorkItemIds.push(candidate.id);
        currentSequence = tx.appendEvent({ projectId: this.projectId, eventType: "WorkItemUnblocked", occurredAt: now, actor: { kind: "system", name: "coordination-runtime" }, payload: ready }).sequence;
      }
      return { workItem: completed, releasedIntentIds, releasedScopeIds, unblockedWorkItemIds, currentSequence };
    });
  }

  /** Apply the already-persisted evaluation decision to its bound WorkItem. */
  async applyEvaluationDecision(runId: EvaluationRun["id"]): Promise<WorkItem> {
    return this.store.transact((tx) => {
      const run = tx.getProjection<EvaluationRun>("evaluation_run", runId);
      if (!run || run.state !== "completed") throw err.evaluationNotAccepted("evaluation run is not completed");
      const decision = tx.getProjection<AcceptanceDecision>("evaluation_decision", runId);
      if (!decision) throw err.evaluationInconclusive("evaluation run has no acceptance decision");
      const spec = tx.getProjection<EvaluationSpec>("evaluation_spec", run.specId);
      if (!spec || spec.projectId !== this.projectId) throw err.evaluationSpecInvalid("evaluation spec is not owned by this project");
      const item = tx.getProjection<WorkItem>("work_item", run.workItemId);
      if (!item) throw err.workItemNotFound();
      if (item.evaluationSpecId === undefined) return item;
      if (item.evaluationSpecId !== run.specId) throw err.evaluationSpecInvalid("evaluation run does not match the WorkItem evaluation spec");
      if (item.state !== "awaiting_evaluation") throw err.evaluationNotAccepted(`work item is not awaiting evaluation (state=${item.state})`);
      const now = this.now().toISOString();
      if (decision.decision === "accepted") {
        const accepted: WorkItem = { ...item, state: "accepted", acceptedEvaluationRunId: run.id, version: item.version + 1, updatedAt: now };
        tx.appendEvent({ projectId: this.projectId, eventType: "WorkItemEvaluationAccepted", occurredAt: now, actor: { kind: "system", name: "evaluation-runtime" }, payload: accepted });
        return accepted;
      }
      const nextState = decision.decision === "rejected" ? "needs_retry" : "review_required";
      const updated: WorkItem = { ...item, state: nextState, version: item.version + 1, updatedAt: now };
      tx.appendEvent({ projectId: this.projectId, eventType: decision.decision === "rejected" ? "WorkItemEvaluationRejected" : "WorkItemEvaluationReviewRequired", occurredAt: now, actor: { kind: "system", name: "evaluation-runtime" }, payload: updated });
      return updated;
    });
  }

  private async emitImpact(intent: Intent): Promise<void> {
    if (!intent.workItemId) return;
    try {
      const session = await this.store.getProjection<AgentSession>("agent_session", intent.agentSessionId);
      if (!session?.worktreeId) return;
      const codeState = await this.store.getCodeState(this.projectId, session.worktreeId);
      if (codeState.entities.length === 0) return;
      const workItems = (await this.store.listProjections<WorkItem>("work_item", this.projectId)).map((record) => record.value);
      const dependencies = (await this.store.listProjections<WorkDependency>("work_dependency", this.projectId)).map((record) => record.value);
      const activeIntents = (await this.store.listProjections<Intent>("intent", this.projectId)).map((record) => record.value).filter((current) => current.state === "active");
      const impact = new ImpactEngine().compute({ subject: intent.id, intent, entities: codeState.entities, edges: codeState.edges, workItems, dependencies, activeIntents });
      await this.store.transact((tx) => {
        const observedAt = new Date().toISOString();
        tx.putProjection("impact_result", intent.id, { ...impact, intentId: intent.id }, this.projectId, observedAt);
        tx.appendEvent({ projectId: this.projectId, eventType: "ImpactDetected", actor: { kind: "system", name: "impact-engine" }, payload: { ...impact, intentId: intent.id } });
      });
    } catch {
      // A missing/degraded code-state provider must not block an intent declaration.
    }
  }

  /** Refresh only intents whose sessions use the changed worktree. */
  async refreshImpactsForWorktree(worktreeId: string): Promise<void> {
    const sessions = await this.store.listProjections<AgentSession>("agent_session", this.projectId);
    const activeSessionIds = new Set(sessions.filter((record) => record.value.worktreeId === worktreeId && !sessionExpired(record.value, this.now())).map((record) => record.value.id));
    const intents = await this.store.listProjections<Intent>("intent", this.projectId);
    for (const record of intents) {
      if (record.value.state === "active" && activeSessionIds.has(record.value.agentSessionId)) await this.emitImpact(record.value);
    }
  }

  async recordChangeReceipt(receipt: ChangeReceipt): Promise<ChangeReceipt> {
    if (receipt.projectId !== undefined && receipt.projectId !== this.projectId) throw err.projectNotFound("change receipt belongs to a different project");
    if (!receipt.receiptDigest) throw err.evaluationResultConflict("change receipt must include an integrity digest");
    return this.store.transact((tx) => {
      tx.putProjection("change_receipt", receipt.id, receipt, this.projectId, receipt.completedAt ?? receipt.publishedAt);
      tx.appendEvent({
        projectId: this.projectId,
        eventType: receipt.status === "APPLIED" ? "ChangeApplied" : receipt.status === "PARTIAL" ? "ChangePartiallyApplied" : "ChangeRejected",
        actor: { kind: "system", name: "coordination-runtime" },
        payload: receipt,
      });
      return receipt;
    });
  }
}
