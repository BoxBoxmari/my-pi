import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createAgentSessionId,
  createProjectId,
  isMyPiError,
  type AgentSession,
  type Project,
} from "@my-pi/contracts";
import { SqliteCoordinationStore, type IdempotencyInput } from "@my-pi/coordination-store";

async function makeDatabase(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-coordination-"));
  return { dir, file: path.join(dir, "coordination.sqlite") };
}

function codeIs(code: string) {
  return (error: unknown): boolean => isMyPiError(error) && error.code === code;
}

function actor() {
  return { kind: "system" as const, name: "coordination-store-test" };
}

test("SQLite store uses WAL and persists event/project/session projections across reopen", async () => {
  const { dir, file } = await makeDatabase();
  const project: Project = {
    id: createProjectId(),
    schemaVersion: "1",
    displayName: "my-pi",
    createdAt: "2026-09-04T00:00:00.000Z",
  };
  const session: AgentSession = {
    id: createAgentSessionId(),
    projectId: project.id,
    host: "test-host",
    status: "active",
    joinedAt: "2026-09-04T00:00:00.000Z",
    heartbeatAt: "2026-09-04T00:00:00.000Z",
  };
  const store = new SqliteCoordinationStore(file);
  try {
    await store.init();
    const db = new DatabaseSync(file);
    const journal = db.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
    assert.equal(Object.values(journal)[0], "wal");
    db.close();

    const opened = await store.appendEvent({ projectId: project.id, eventType: "ProjectOpened", actor: actor(), payload: project });
    const joined = await store.appendEvent({ projectId: project.id, eventType: "AgentJoined", actor: actor(), payload: session });
    await store.appendEvent({
      projectId: project.id,
      eventType: "AgentHeartbeat",
      actor: actor(),
      payload: { sessionId: session.id, heartbeatAt: "2026-09-04T00:01:00.000Z", status: "idle" },
    });

    assert.equal(opened.sequence, 1n);
    assert.equal(joined.sequence, 2n);
    const page = await store.listEvents({ projectId: project.id, afterSequence: 1n });
    assert.deepEqual(page.events.map((event) => event.sequence), [2n, 3n]);
    assert.equal(page.throughSequence, 3n);
    assert.equal(page.hasMore, false);
    assert.deepEqual(await store.getProjection<Project>("project", project.id), project);
    const projectedSession = await store.getProjection<AgentSession>("agent_session", session.id);
    assert.equal(projectedSession?.status, "idle");
    assert.equal(projectedSession?.heartbeatAt, "2026-09-04T00:01:00.000Z");

    await store.close();
    const reopened = new SqliteCoordinationStore(file);
    await reopened.init();
    try {
      const recovered = await reopened.listEvents({ projectId: project.id });
      assert.deepEqual(recovered.events.map((event) => event.sequence), [1n, 2n, 3n]);
      assert.equal((await reopened.getProjection<Project>("project", project.id))?.displayName, "my-pi");
      assert.equal((await reopened.getProjection<AgentSession>("agent_session", session.id))?.status, "idle");
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("one store authority produces a deterministic monotonic sequence for eight concurrent writers", async () => {
  const { dir, file } = await makeDatabase();
  const projectId = createProjectId();
  const store = new SqliteCoordinationStore(file);
  try {
    await store.init();
    const events = await Promise.all(Array.from({ length: 8 }, (_, index) => store.appendEvent({
      projectId,
      eventType: "AgentHeartbeat",
      actor: actor(),
      payload: { index },
    })));
    assert.deepEqual(events.map((event) => event.sequence).sort((a, b) => Number(a - b)), [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
    const page = await store.listEvents({ projectId });
    assert.equal(page.events.length, 8);
    assert.deepEqual(page.events.map((event) => event.sequence), [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("idempotency accepts the same request and rejects a digest or operation conflict", async () => {
  const { dir, file } = await makeDatabase();
  const store = new SqliteCoordinationStore(file);
  const input: IdempotencyInput = {
    clientId: "session-test",
    key: "request-1",
    operationKind: "coord_join",
    requestDigest: "sha256:one",
  };
  try {
    await store.init();
    assert.equal(await store.checkIdempotency(input), undefined);
    await store.recordIdempotency({ ...input, resultRef: "event-1", resultDigest: "sha256:result" });
    assert.deepEqual(await store.checkIdempotency(input), { ...input, resultRef: "event-1", resultDigest: "sha256:result" });
    await store.recordIdempotency({ ...input, resultRef: "event-1", resultDigest: "sha256:result" });
    await assert.rejects(
      store.checkIdempotency({ ...input, requestDigest: "sha256:two" }),
      codeIs("ERR_IDEMPOTENCY_CONFLICT"),
    );
    await assert.rejects(
      store.checkIdempotency({ ...input, operationKind: "coord_claim" }),
      codeIs("ERR_IDEMPOTENCY_CONFLICT"),
    );
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("transaction rollback prevents an event from escaping a failed projection transaction", async () => {
  const { dir, file } = await makeDatabase();
  const projectId = createProjectId();
  const store = new SqliteCoordinationStore(file);
  try {
    await store.init();
    await assert.rejects(
      store.transact((transaction) => {
        transaction.appendEvent({ projectId, eventType: "ProjectOpened", actor: actor(), payload: { id: projectId } });
        throw new Error("synthetic projection failure");
      }),
      codeIs("ERR_COORDINATION_STORE_FAILURE"),
    );
    const page = await store.listEvents({ projectId });
    assert.equal(page.events.length, 0);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("future schema versions fail closed before the store opens", async () => {
  const { dir, file } = await makeDatabase();
  const seed = new DatabaseSync(file);
  try {
    seed.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    seed.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(99, "2026-09-04T00:00:00.000Z");
  } finally {
    seed.close();
  }

  const store = new SqliteCoordinationStore(file);
  try {
    await assert.rejects(store.init(), codeIs("ERR_SCHEMA_MIGRATION_REQUIRED"));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("audit records persist separately from coordination event sequence", async () => {
  const { dir, file } = await makeDatabase();
  const projectId = createProjectId();
  const store = new SqliteCoordinationStore(file);
  try {
    await store.init();
    await store.appendAudit({ id: "audit-1", projectId, occurredAt: "2026-09-04T00:00:00.000Z", operation: "coord.join", resultCode: "OK", actorRef: "untrusted-client-name" });
    await store.appendEvent({ projectId, eventType: "ProjectOpened", actor: actor(), payload: { id: projectId } });
    assert.deepEqual((await store.listAudit(projectId)).map((event) => event.id), ["audit-1"]);
    assert.equal((await store.listEvents({ projectId })).events.length, 1);
    await store.close();
    const reopened = new SqliteCoordinationStore(file);
    await reopened.init();
    try {
      const records = await reopened.listAudit(projectId);
      assert.equal(records[0]?.operation, "coord.join");
      assert.equal("content" in (records[0] ?? {}), false);
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("evaluation lookup uses run-scoped indexed records instead of project-wide projection scans", async () => {
  const { dir, file } = await makeDatabase();
  const projectId = createProjectId();
  const store = new SqliteCoordinationStore(file);
  try {
    await store.init();
    await store.transact((tx) => {
      tx.putProjection("project", projectId, { id: projectId, schemaVersion: "1", createdAt: "2026-09-04T00:00:00.000Z" }, projectId);
      tx.putProjection("evaluation_run", "evalrun-indexed", { id: "evalrun-indexed", projectId, specId: "evalspec-indexed", specVersion: 1, repositoryStateRef: "state-indexed", workItemId: "work-indexed", attempt: 1, state: "completed" }, projectId);
      for (let index = 0; index < 100; index++) {
        tx.putProjection("evaluation_result", `evalrun-indexed:criterion-${index}`, { runId: "evalrun-indexed", criterionId: `criterion-${index}`, providerResultId: `provider-${index}`, resultDigest: `digest-${index}`, recordedAt: "2026-09-04T00:00:00.000Z" }, projectId);
      }
    });
    const selected = await store.listEvaluationResults<{ criterionId: string }>(projectId, "evalrun-indexed");
    assert.equal(selected.length, 100);
    assert.equal(selected[0]?.criterionId, "criterion-0");

    const db = new DatabaseSync(file);
    try {
      const indexes = db.prepare("PRAGMA index_list('evaluation_results')").all() as Array<{ name?: unknown }>;
      assert.ok(indexes.some((index) => index.name === "evaluation_results_run_criterion_idx"));
    } finally {
      db.close();
    }
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("evaluation query migration backfills projection records from schema version four", async () => {
  const { dir, file } = await makeDatabase();
  const projectId = createProjectId();
  const expectedResult = { runId: "evalrun-legacy", criterionId: "check", providerResultId: "provider-legacy", resultDigest: "digest-legacy", recordedAt: "2026-09-04T00:00:00.000Z" };
  const legacy = new DatabaseSync(file);
  try {
    for (const version of [1, 2, 3, 4]) {
      legacy.exec(await readFile(path.join(process.cwd(), "packages", "coordination-store", "migrations", `000${version}_${version === 1 ? "initial" : version === 2 ? "code_state" : version === 3 ? "evaluation" : "audit"}.sql`), "utf8"));
      legacy.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, "2026-09-04T00:00:00.000Z");
    }
    const run = { id: "evalrun-legacy", projectId, specId: "evalspec-legacy", specVersion: 1, repositoryStateRef: "state-legacy", workItemId: "work-legacy", attempt: 1, state: "completed" };
    legacy.prepare("INSERT INTO projection_records(kind, id, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)").run("evaluation_run", run.id, projectId, JSON.stringify(run), "2026-09-04T00:00:00.000Z");
    legacy.prepare("INSERT INTO projection_records(kind, id, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)").run("evaluation_result", `${run.id}:check`, projectId, JSON.stringify(expectedResult), "2026-09-04T00:00:00.000Z");
  } finally {
    legacy.close();
  }

  const store = new SqliteCoordinationStore(file);
  try {
    await store.init();
    const results = await store.listEvaluationResults<{ runId: string; providerResultId: string }>(projectId, "evalrun-legacy");
    assert.deepEqual(results, [expectedResult]);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
