import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createProjectId,
  createRepositoryId,
  createWorktreeId,
  type ContextArtifact,
  type Scope,
} from "@my-pi/contracts";
import { SqliteCoordinationStore } from "@my-pi/coordination-store";
import { CoordinationRuntime } from "@my-pi/coordination-runtime";
import { EvaluationRuntime } from "../../evaluation-runtime/dist/index.js";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-runtime-"));
  const store = new SqliteCoordinationStore(path.join(dir, "coordination.sqlite"));
  await store.init();
  const projectId = createProjectId();
  const runtime = new CoordinationRuntime(store, projectId, { now: () => new Date("2026-09-04T00:00:00.000Z") });
  return { dir, store, runtime, projectId };
}

async function join(runtime: CoordinationRuntime, worktreeId: string, host: string) {
  const repositoryId = createRepositoryId();
  return runtime.join({
    repository: { id: repositoryId as never, projectId: runtime.projectId, vcs: "git", canonicalIdentity: "git:local:my-pi" },
    worktree: { id: worktreeId as never, repositoryId: repositoryId as never, root: `C:/work/${host}`, branch: host, observedAt: "2026-09-04T00:00:00.000Z" },
    host,
    clientInstance: `${host}-client`,
  });
}

test("PN4 end-to-end: dependency claim, typed publication, selective sync, and unblock", async () => {
  const { dir, store, runtime } = await setup();
  try {
    const agentA = await join(runtime, createWorktreeId(), "agent-a");
    const agentB = await join(runtime, createWorktreeId(), "agent-b");
    const agentC = await join(runtime, createWorktreeId(), "agent-c");
    const backend = await runtime.createWorkItem({ title: "backend contract" });
    const frontend = await runtime.createWorkItem({
      title: "frontend integration",
      dependencies: [{ to: backend.id, type: "depends_on" }],
    });

    const claimedBackend = await runtime.claim({ agentSessionId: agentA.agentSessionId, workItemId: backend.id, expectedVersion: 0 });
    assert.equal(claimedBackend.state, "active");

    await assert.rejects(
      runtime.claim({ agentSessionId: agentB.agentSessionId, workItemId: frontend.id, expectedVersion: 0 }),
      (error: unknown) => (error as { code?: string }).code === "ERR_WORK_ITEM_BLOCKED",
    );
    const blocked = await store.getProjection<typeof frontend>("work_item", frontend.id);
    assert.equal(blocked?.state, "blocked");
    assert.equal(blocked?.assignee, agentB.agentSessionId);

    await runtime.declareIntent({
      agentSessionId: agentA.agentSessionId,
      workItemId: backend.id,
      kind: "change_contract",
      summary: "publish the backend interface contract",
      targets: [{ type: "path", value: "packages/contracts/src" }],
    });
    const artifact = await runtime.publish({
      agentSessionId: agentA.agentSessionId,
      workItemId: backend.id,
      kind: "interface_contract",
      contentDigest: "sha256:contract1234",
      classification: "internal",
      retention: "until-superseded",
    });
    assert.equal((artifact as ContextArtifact).kind, "interface_contract");

    const bSync = await runtime.sync({ agentSessionId: agentB.agentSessionId, sinceSequence: 0n });
    assert.ok(bSync.normalPriority.some((item) => item.reason === "dependency_work_item" || item.reason === "published_artifact"));
    assert.ok(!bSync.normalPriority.some((item) => item.event.payload && JSON.stringify(item.event.payload).includes(agentC.agentSessionId)));

    const cSync = await runtime.sync({ agentSessionId: agentC.agentSessionId, sinceSequence: 0n });
    assert.equal(cSync.highPriority.length, 1);
    assert.equal(cSync.normalPriority.length, 0);

    const completed = await runtime.complete({ agentSessionId: agentA.agentSessionId, workItemId: backend.id });
    assert.deepEqual(completed.unblockedWorkItemIds, [frontend.id]);
    const ready = await store.getProjection<typeof frontend>("work_item", frontend.id);
    assert.equal(ready?.state, "ready");
    assert.equal(ready?.version, 2);

    const claimedFrontend = await runtime.claim({ agentSessionId: agentB.agentSessionId, workItemId: frontend.id, expectedVersion: 2 });
    assert.equal(claimedFrontend.state, "active");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN4 claim rejects stale versions and complete releases active scopes", async () => {
  const { dir, store, runtime } = await setup();
  try {
    const agent = await join(runtime, createWorktreeId(), "agent-single");
    const item = await runtime.createWorkItem({ title: "scoped task" });
    await runtime.claim({ agentSessionId: agent.agentSessionId, workItemId: item.id, expectedVersion: 0 });
    const otherAgent = await join(runtime, createWorktreeId(), "agent-other");
    await assert.rejects(
      runtime.claim({ agentSessionId: otherAgent.agentSessionId, workItemId: item.id, expectedVersion: 0 }),
      (error: unknown) => (error as { code?: string }).code === "ERR_WORK_ITEM_CONFLICT",
    );

    const scope: Scope = {
      id: `scope_test_${item.id.slice(-6)}` as never,
      projectId: runtime.projectId,
      agentSessionId: agent.agentSessionId,
      mode: "shared",
      refs: [{ type: "path", value: "src" }],
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    await store.transact((tx) => tx.putProjection("scope", scope.id, scope, runtime.projectId, scope.createdAt));
    const completed = await runtime.complete({ agentSessionId: agent.agentSessionId, workItemId: item.id });
    assert.deepEqual(completed.releasedScopeIds, [scope.id]);
    const released = await store.getProjection<Scope>("scope", scope.id);
    assert.equal(typeof released?.releasedAt, "string");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN4 coordination validates dependency targets and WorkItem ownership", async () => {
  const { dir, store, runtime } = await setup();
  try {
    const owner = await join(runtime, createWorktreeId(), "owner");
    const other = await join(runtime, createWorktreeId(), "other");
    const item = await runtime.createWorkItem({ title: "owned work" });
    await runtime.claim({ agentSessionId: owner.agentSessionId, workItemId: item.id, expectedVersion: 0 });
    await assert.rejects(
      runtime.declareIntent({ agentSessionId: other.agentSessionId, workItemId: item.id, kind: "modify", summary: "unauthorized intent", targets: [{ type: "path", value: "src" }] }),
      (error: unknown) => (error as { code?: string }).code === "ERR_WORK_ITEM_CONFLICT",
    );
    await assert.rejects(
      runtime.createWorkItem({ title: "invalid dependency", dependencies: [{ to: "work-missing" as never, type: "depends_on" }] }),
      (error: unknown) => (error as { code?: string }).code === "ERR_WORK_ITEM_NOT_FOUND",
    );
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN7 change receipt is stored and surfaced as an applied/rejected coordination event", async () => {
  const { dir, store, runtime } = await setup();
  try {
    await join(runtime, createWorktreeId(), "receipt-agent");
    const receipt = {
      id: "receipt_test_123456" as never,
      proposalId: "proposal_test_123456" as never,
      projectId: runtime.projectId,
      status: "APPLIED" as const,
      resources: [{ path: "src/example.ts", absent: false }],
      publishedAt: "2026-09-04T00:00:00.000Z",
    };
    await runtime.recordChangeReceipt(receipt);
    assert.deepEqual(await store.getProjection("change_receipt", receipt.id), receipt);
    const events = await store.listEvents({ projectId: runtime.projectId, limit: 100 });
    assert.ok(events.events.some((event) => event.eventType === "ChangeApplied"));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN8 gated WorkItems wait for evaluation, expose retry state, and only then become done", async () => {
  const { dir, store, runtime } = await setup();
  try {
    const agent = await join(runtime, createWorktreeId(), "evaluation-gated-agent");
    const evaluation = new EvaluationRuntime(store, runtime.projectId);
    const spec = await evaluation.registerSpec({
      name: "gated completion",
      criteria: [{ id: "target", kind: "artifact", required: true, severity: "critical", evaluatorRef: "test", expected: "accepted" }],
    });
    const item = await runtime.createWorkItem({ title: "gated implementation", evaluationSpecId: spec.id });
    await runtime.claim({ agentSessionId: agent.agentSessionId, workItemId: item.id, expectedVersion: 0 });

    const awaiting = await runtime.complete({ agentSessionId: agent.agentSessionId, workItemId: item.id });
    assert.equal(awaiting.workItem.state, "awaiting_evaluation");
    assert.deepEqual(await runtime.complete({ agentSessionId: agent.agentSessionId, workItemId: item.id }), { workItem: awaiting.workItem, releasedIntentIds: [], releasedScopeIds: [], unblockedWorkItemIds: [], currentSequence: 0n });

    const failedRun = await evaluation.requestRun({ specId: spec.id, workItemId: item.id, repositoryStateRef: "tree:attempt-1", attempt: 1 });
    await evaluation.recordResult(failedRun.id, {
      providerResultId: "gated-fail",
      providerId: "test",
      criterionId: "target",
      result: { criterionId: "target", outcome: "fail", observed: "attempt-1", reasonCode: "TARGET_NOT_READY", evidence: [{ provider: "test", digest: "sha256:attempt-1", targetStateRef: "tree:attempt-1", observedAt: "2026-09-04T00:00:00.000Z" }] },
    });
    const failed = await evaluation.completeRun(failedRun.id);
    assert.equal(failed.decision?.decision, "rejected");
    const needsRetry = await runtime.applyEvaluationDecision(failedRun.id);
    assert.equal(needsRetry.state, "needs_retry");
    assert.equal((await store.getProjection<typeof item>("work_item", item.id))?.state, "needs_retry");

    const reactivated = await runtime.claim({ agentSessionId: agent.agentSessionId, workItemId: item.id, expectedVersion: needsRetry.version });
    assert.equal(reactivated.state, "active");
    const retryAwaiting = await runtime.complete({ agentSessionId: agent.agentSessionId, workItemId: item.id });
    assert.equal(retryAwaiting.workItem.state, "awaiting_evaluation");
    const passedRun = await evaluation.requestRun({ specId: spec.id, workItemId: item.id, repositoryStateRef: "tree:attempt-2", attempt: 2 });
    await evaluation.recordResult(passedRun.id, {
      providerResultId: "gated-pass",
      providerId: "test",
      criterionId: "target",
      result: { criterionId: "target", outcome: "pass", observed: "accepted", evidence: [{ provider: "test", digest: "sha256:attempt-2", targetStateRef: "tree:attempt-2", observedAt: "2026-09-04T00:00:00.000Z" }] },
    });
    const passed = await evaluation.completeRun(passedRun.id);
    assert.equal(passed.decision?.decision, "accepted");
    const accepted = await runtime.applyEvaluationDecision(passedRun.id);
    assert.equal(accepted.state, "accepted");
    assert.equal(accepted.acceptedEvaluationRunId, passedRun.id);
    const evaluationSync = await runtime.sync({ agentSessionId: agent.agentSessionId, sinceSequence: 0n });
    assert.ok(evaluationSync.highPriority.some((item) => item.event.eventType === "AcceptanceDecided" && item.event.payload && JSON.stringify(item.event.payload).includes(passedRun.id)));
    const done = await runtime.complete({ agentSessionId: agent.agentSessionId, workItemId: item.id, evaluationRunId: passedRun.id });
    assert.equal(done.workItem.state, "done");
    assert.ok(done.releasedIntentIds.length >= 0);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PN6 intent declaration emits a bounded impact result and routes it to the affected agent", async () => {
  const { dir, store, runtime } = await setup();
  try {
    const worktreeA = createWorktreeId();
    const agentA = await join(runtime, worktreeA, "impact-source");
    const agentB = await join(runtime, createWorktreeId(), "impact-dependent");
    const source = await runtime.createWorkItem({ title: "change shared contract" });
    const dependent = await runtime.createWorkItem({ title: "update dependent consumer" });
    await runtime.claim({ agentSessionId: agentA.agentSessionId, workItemId: source.id, expectedVersion: 0 });
    await runtime.claim({ agentSessionId: agentB.agentSessionId, workItemId: dependent.id, expectedVersion: 0 });
    await store.applyCodeStateDelta({
      projectId: runtime.projectId,
      repositoryId: "repo-impact-test",
      worktreeId: worktreeA,
      changedPath: "src/backend.ts",
      entities: [
        { id: "entity-backend" as never, projectId: runtime.projectId, repositoryId: "repo-impact-test", worktreeId: worktreeA, kind: "file", stableKey: "backend", displayName: "backend.ts", path: "src/backend.ts", observedAt: "2026-09-04T00:00:00.000Z", provider: "ast" },
        { id: "entity-frontend" as never, projectId: runtime.projectId, repositoryId: "repo-impact-test", worktreeId: worktreeA, kind: "file", stableKey: "frontend", displayName: "frontend.ts", path: "src/frontend.ts", observedAt: "2026-09-04T00:00:00.000Z", provider: "ast" },
      ],
      edges: [{ from: "entity-frontend" as never, to: "entity-backend" as never, kind: "imports", confidence: "strong", provider: "ast", observedAt: "2026-09-04T00:00:00.000Z" }],
      removedStableKeys: [],
      observedAt: "2026-09-04T00:00:00.000Z",
    });
    await runtime.declareIntent({ agentSessionId: agentB.agentSessionId, workItemId: dependent.id, kind: "modify", summary: "update the dependent consumer", targets: [{ type: "path", value: "src/frontend.ts" }] });
    const sourceIntent = await runtime.declareIntent({ agentSessionId: agentA.agentSessionId, workItemId: source.id, kind: "change_contract", summary: "change the shared backend contract", targets: [{ type: "path", value: "src/backend.ts" }] });
    const events = await store.listEvents({ projectId: runtime.projectId, limit: 100 });
    const impact = events.events.find((event) => event.eventType === "ImpactDetected");
    assert.ok(impact);
    assert.equal((impact.payload as { subject: string }).subject, sourceIntent.id);
    assert.ok((impact.payload as { affectedWorkItems: Array<{ workItemId: string }> }).affectedWorkItems.some((item) => item.workItemId === dependent.id));
    const sync = await runtime.sync({ agentSessionId: agentB.agentSessionId, sinceSequence: 0n });
    assert.ok(sync.highPriority.some((item) => item.event.eventType === "ImpactDetected" && item.reason === "impact_result"));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
