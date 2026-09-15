import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  CoordinationClient,
  readDaemonMetadata,
  type DaemonMetadata,
} from "@my-pi/coordination-client";

const ROOT = path.resolve(".");
const DAEMON = path.join(ROOT, "apps", "my-pi-daemon", "dist", "main.js");

interface WireEvent {
  projectId: string;
  sequence: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor: { kind: string; id?: string; name?: string };
  payload?: unknown;
}

interface GraphEventsWire {
  events: WireEvent[];
  throughSequence: string;
  hasMore: boolean;
  mode: string;
  kind?: string;
  degraded?: { provider: string; reason: string };
}

interface AuditWire {
  id: string;
  projectId: string;
  occurredAt: string;
  operation: string;
  resultCode?: string;
}

function startDaemon(runtimeDir: string): ChildProcess {
  const args = [DAEMON, "--workspace", ROOT, "--runtime-dir", runtimeDir, "--test-mode"];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  (child as ChildProcess & { diagnosticStderr?: () => string }).diagnosticStderr = () => stderr;
  return child;
}

async function waitForReady(runtimeDir: string, processHandle: ChildProcess): Promise<DaemonMetadata> {
  const started = Date.now();
  for (;;) {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (metadata?.state === "ready") return metadata;
    if (processHandle.exitCode !== null) throw new Error(`daemon exited before ready: ${processHandle.exitCode}: ${(processHandle as ChildProcess & { diagnosticStderr?: () => string }).diagnosticStderr?.() ?? "no stderr"}`);
    if (Date.now() - started > 10_000) throw new Error("daemon did not become ready within 10 seconds");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopDaemon(processHandle: ChildProcess): Promise<void> {
  if (processHandle.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    const finish = () => {
      processHandle.off("exit", finish);
      processHandle.off("close", finish);
      resolve();
    };
    processHandle.once("exit", finish);
    processHandle.once("close", finish);
  });
  processHandle.kill("SIGTERM");
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
}

async function withDaemon(run: (client: CoordinationClient, projectId: string) => Promise<void>): Promise<void> {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-graph-events-test-"));
  let daemon: ChildProcess | undefined;
  try {
    daemon = startDaemon(runtimeDir);
    const metadata = await waitForReady(runtimeDir, daemon);
    const client = new CoordinationClient({ endpoint: metadata.endpoint, maxAttempts: 2 });
    await run(client, metadata.projectId);
  } finally {
    if (daemon) await stopDaemon(daemon).catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
}

function appendEvent(client: CoordinationClient, projectId: string, eventType: string, payload: unknown, occurredAt = "2026-09-15T00:00:00.000Z"): Promise<WireEvent> {
  return client.call<WireEvent>("append_event", {
    projectId,
    eventType,
    occurredAt,
    actor: { kind: "system", name: "graph-events-test" },
    payload,
  });
}

function graphEvents(client: CoordinationClient, params: Record<string, unknown>): Promise<GraphEventsWire> {
  return client.call<GraphEventsWire>("graph_events", params);
}

function invalidArgumentError(message: RegExp) {
  return (error: unknown): boolean => {
    const candidate = error as { code?: string; message?: string };
    return candidate.code === "ERR_INVALID_ARGUMENT" && message.test(candidate.message ?? "");
  };
}

test("graph_events kind=work excludes CodeGraphUpdated and has no degraded", async () => {
  await withDaemon(async (client, projectId) => {
    await appendEvent(client, projectId, "WorkItemCreated", { workItemId: "wi-1" });
    await appendEvent(client, projectId, "CodeGraphUpdated", { worktreeId: "wt-1", changedPath: "src/a.ts" });
    await appendEvent(client, projectId, "ProjectOpened", { note: "seed" });
    await appendEvent(client, projectId, "IntentDeclared", { intentId: "in-1" });

    const res = await graphEvents(client, { projectId, kind: "work", mode: "live", maxEvents: 100 });
    assert.equal(res.kind, "work");
    assert.equal(res.mode, "live");
    assert.equal(res.degraded, undefined);
    const types = res.events.map((event) => event.eventType);
    assert.ok(types.includes("WorkItemCreated"));
    assert.ok(types.includes("IntentDeclared"));
    assert.ok(!types.includes("CodeGraphUpdated"));
    assert.ok(!types.includes("ProjectOpened"));
    assert.ok(res.events.every((event) => typeof event.sequence === "string"));
    assert.equal(typeof res.throughSequence, "string");
    assert.equal(res.hasMore, false);
  });
});

test("graph_events rejects mode other than live|replay and unknown kind", async () => {
  await withDaemon(async (client, projectId) => {
    await appendEvent(client, projectId, "WorkItemCreated", { workItemId: "wi-1" });
    await assert.rejects(
      graphEvents(client, { projectId, mode: "catchup" }),
      invalidArgumentError(/mode must be live or replay/),
    );
    await assert.rejects(
      graphEvents(client, { projectId, kind: "no-such-kind" }),
      invalidArgumentError(/kind is invalid/),
    );
    const ok = await graphEvents(client, { projectId, kind: "work", mode: "replay" });
    assert.equal(ok.mode, "replay");
  });
});

test("graph_events degraded for omitted kind; code without worktreeId degraded; with worktreeId payload-filtered", async () => {
  await withDaemon(async (client, projectId) => {
    await appendEvent(client, projectId, "WorkItemCreated", { workItemId: "wi-1" });
    await appendEvent(client, projectId, "CodeGraphUpdated", { worktreeId: "wt-a", changedPath: "src/a.ts" });
    await appendEvent(client, projectId, "CodeGraphUpdated", { worktreeId: "wt-b", changedPath: "src/b.ts" });
    await appendEvent(client, projectId, "ContractChanged", { contractId: "c-1" });

    const noKind = await graphEvents(client, { projectId, mode: "live", maxEvents: 100 });
    assert.equal(noKind.kind, undefined);
    assert.equal(noKind.degraded?.provider, "graph-events");
    assert.match(noKind.degraded?.reason ?? "", /kind omitted: returning the full project event stream/);
    assert.equal(noKind.events.length, 4);

    const codeNoWorktree = await graphEvents(client, { projectId, kind: "code", mode: "live", maxEvents: 100 });
    assert.equal(codeNoWorktree.degraded?.provider, "graph-events");
    assert.equal(codeNoWorktree.degraded?.reason, "code events require worktreeId");
    assert.deepEqual(codeNoWorktree.events.map((event) => event.eventType), ["CodeGraphUpdated", "CodeGraphUpdated", "ContractChanged"]);

    const codeScoped = await graphEvents(client, { projectId, kind: "code", worktreeId: "wt-a", mode: "live", maxEvents: 100 });
    assert.notEqual(codeScoped.degraded?.reason, "code events require worktreeId");
    assert.equal(codeScoped.degraded?.provider, "graph-events");
    assert.match(codeScoped.degraded?.reason ?? "", /scope filtering incomplete/);
    const payloads = codeScoped.events.map((event) => (event.payload ?? {}) as { worktreeId?: string });
    assert.equal(payloads.filter((payload) => payload.worktreeId === "wt-b").length, 0);
    assert.equal(payloads.filter((payload) => payload.worktreeId === "wt-a").length, 1);
    assert.equal(payloads.filter((payload) => payload.worktreeId === undefined).length, 1);
  });
});

test("graph_events wire payload contains no raw secret material", async () => {
  await withDaemon(async (client, projectId) => {
    const seeded = await appendEvent(client, projectId, "WorkItemCreated", {
      workItemId: "wi-secret",
      token: "NEVER_ON_WIRE_TOKEN_ABC123",
      note: "rotate ghp_ABCDEFGHIJKLMNOPQRST1234 next",
      files: [{ path: "/home/dev/.ssh/id_rsa" }],
      log: "auth handshake bearer: XYZSECRET42 failed",
    });
    const res = await graphEvents(client, { projectId, kind: "work", mode: "live", maxEvents: 100 });
    const body = JSON.stringify(res, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
    assert.ok(body.includes("[REDACTED]"));
    assert.ok(body.includes("[PATH:REDACTED]"));
    assert.ok(body.includes("[REDACTED:SECRET]"));
    for (const leak of ["NEVER_ON_WIRE_TOKEN_ABC123", "ghp_ABCDEFGHIJKLMNOPQRST1234", "id_rsa", "XYZSECRET42"]) {
      assert.ok(!body.includes(leak), `graph_events wire must not contain ${leak}`);
    }
    const wireEvent = res.events.find((event) => event.eventId === seeded.eventId);
    assert.ok(wireEvent);
    assert.equal(wireEvent.sequence, seeded.sequence);
    assert.equal(typeof wireEvent.sequence, "string");
    assert.equal(wireEvent.eventType, "WorkItemCreated");
    assert.equal((wireEvent.payload as { workItemId?: string }).workItemId, "wi-secret");
  });
});

test("graph_events records audit but performs zero coordination/graph mutation", async () => {
  await withDaemon(async (client, projectId) => {
    await appendEvent(client, projectId, "WorkItemCreated", { workItemId: "wi-1" });
    await appendEvent(client, projectId, "CodeGraphUpdated", { worktreeId: "wt-1", changedPath: "src/a.ts" });
    await appendEvent(client, projectId, "ImpactDetected", { intentId: "in-1" });

    const eventsBefore = await client.call<{ events: Array<{ eventId: string; sequence: string }> }>("list_events", { projectId, limit: 1_000 });
    const workGraphBefore = JSON.stringify(await client.graphSnapshot({ projectId, kind: "work", maxNodes: 500, maxEdges: 1_000 }));
    const codeStateBefore = JSON.stringify(await client.call("code_state_snapshot", { projectId, worktreeId: "wt-none" }));
    const auditBefore = await client.call<AuditWire[]>("audit_list", { projectId });

    const res = await graphEvents(client, { projectId, kind: "work", mode: "live", maxEvents: 100 });
    assert.ok(res.events.length > 0);

    const auditAfter = await client.call<AuditWire[]>("audit_list", { projectId });
    const seenIds = new Set(auditBefore.map((record) => record.id));
    const fresh = auditAfter.filter((record) => !seenIds.has(record.id));
    assert.equal(auditAfter.length, auditBefore.length + 2);
    assert.equal(fresh.filter((record) => record.operation === "graph_events").length, 1);
    assert.ok(fresh.every((record) => record.resultCode === "OK"));

    const eventsAfter = await client.call<{ events: Array<{ eventId: string; sequence: string }> }>("list_events", { projectId, limit: 1_000 });
    assert.deepEqual(eventsAfter.events, eventsBefore.events);
    const workGraphAfter = JSON.stringify(await client.graphSnapshot({ projectId, kind: "work", maxNodes: 500, maxEdges: 1_000 }));
    assert.equal(workGraphAfter, workGraphBefore);
    const codeStateAfter = JSON.stringify(await client.call("code_state_snapshot", { projectId, worktreeId: "wt-none" }));
    assert.equal(codeStateAfter, codeStateBefore);
  });
});

test("graph_events mode=replay from/to returns ordered, type-scoped, bounded window with string-seq edges", async () => {
  await withDaemon(async (client, projectId) => {
    await appendEvent(client, projectId, "WorkItemCreated", { workItemId: "wi-1" });
    await appendEvent(client, projectId, "CodeGraphUpdated", { worktreeId: "wt-a", changedPath: "src/a.ts" });
    await appendEvent(client, projectId, "ProjectOpened", { note: "seed" });
    await appendEvent(client, projectId, "IntentDeclared", { intentId: "in-1" });
    await appendEvent(client, projectId, "CodeGraphUpdated", { worktreeId: "wt-b", changedPath: "src/b.ts" });
    await appendEvent(client, projectId, "WorkItemClaimed", { workItemId: "wi-1" });
    await appendEvent(client, projectId, "WorkItemCompleted", { workItemId: "wi-1" });

    const window = await graphEvents(client, { projectId, kind: "work", mode: "replay", fromSequence: "3", toSequence: "6", maxEvents: 100 });
    assert.equal(window.mode, "replay");
    assert.deepEqual(window.events.map((event) => event.sequence), ["4", "6"]);
    assert.deepEqual(window.events.map((event) => event.eventType), ["IntentDeclared", "WorkItemClaimed"]);
    assert.ok(window.events.every((event) => typeof event.sequence === "string"));
    assert.ok(window.events.every((event) => /^\d+$/.test(event.sequence)));
    assert.equal(window.throughSequence, "6");
    assert.equal(typeof window.throughSequence, "string");
    assert.equal(window.hasMore, false);

    const edges = await graphEvents(client, { projectId, kind: "work", mode: "replay", fromSequence: "4", toSequence: "4", maxEvents: 100 });
    assert.deepEqual(edges.events.map((event) => event.sequence), ["4"]);

    const bounded = await graphEvents(client, { projectId, kind: "work", mode: "replay", fromSequence: "3", toSequence: "6", maxEvents: 1 });
    assert.deepEqual(bounded.events.map((event) => event.sequence), ["4"]);
    assert.equal(bounded.hasMore, true);
    assert.equal(bounded.throughSequence, "4");
    const resume = await graphEvents(client, { projectId, kind: "work", mode: "replay", afterSequence: bounded.throughSequence, toSequence: "6", maxEvents: 100 });
    assert.deepEqual(resume.events.map((event) => event.sequence), ["6"]);
    const overlap = new Set(resume.events.map((event) => event.eventId).filter((eventId) => bounded.events.some((event) => event.eventId === eventId)));
    assert.equal(overlap.size, 0);
  });
});

test("graph_events wire masks sensitive paths embedded in free-text reason and actor fields", async () => {
  await withDaemon(async (client, projectId) => {
    const seeded = await client.call<WireEvent>("append_event", {
      projectId,
      eventType: "WorkItemCreated",
      occurredAt: "2026-09-15T00:00:00.000Z",
      actor: { kind: "agent_session", id: "svc/zeta9/aws/credentials" },
      payload: {
        workItemId: "wi-pathtext",
        reason: "rotated C:/Users/x/.ssh/id_rsa",
        note: "loaded /deploy/.env.zeta9",
      },
    });
    const res = await graphEvents(client, { projectId, kind: "work", mode: "live", maxEvents: 100 });
    const body = JSON.stringify(res);
    assert.ok(body.includes("[PATH:REDACTED]"), "graph_events wire must carry the PATH mask");
    for (const leak of ["zeta9", "id_zkey", "id_rsa", "/.ssh", "\\.ssh", "/.aws", "\\.aws", ".env.zeta9", "C:/Users/x"]) {
      assert.ok(!body.includes(leak), `graph_events wire must not contain ${leak}`);
    }
    const wireEvent = res.events.find((event) => event.eventId === seeded.eventId);
    assert.ok(wireEvent);
    assert.equal(wireEvent.eventId, seeded.eventId);
    assert.equal(wireEvent.sequence, seeded.sequence);
    assert.equal(wireEvent.actor.id, "[PATH:REDACTED]");
    const payload = wireEvent.payload as Record<string, string>;
    assert.equal(payload.reason, "[PATH:REDACTED]");
    assert.equal(payload.note, "[PATH:REDACTED]");
    assert.equal(payload.workItemId, "wi-pathtext");

    const named = await client.call<WireEvent>("append_event", {
      projectId,
      eventType: "WorkItemCreated",
      occurredAt: "2026-09-15T00:00:01.000Z",
      actor: { kind: "system", name: "read /home/zeta9/.ssh/id_zkey" },
      payload: { workItemId: "wi-pathtext-2" },
    });
    const res2 = await graphEvents(client, { projectId, kind: "work", mode: "live", maxEvents: 100 });
    const namedWire = res2.events.find((event) => event.eventId === named.eventId);
    assert.ok(namedWire, "system-actor event must be present on the wire");
    assert.equal(namedWire.actor.name, "[PATH:REDACTED]");
    assert.ok(!JSON.stringify(res2).includes("zeta9"), "actor.name path fragment must not survive");
  });
});

test("graph_events kind=impact subjectId filters ImpactDetected and keeps unkeyed events with degraded incomplete", async () => {
  await withDaemon(async (client, projectId) => {
    await appendEvent(client, projectId, "ImpactDetected", { intentId: "in-a", subject: "in-a" });
    await appendEvent(client, projectId, "ImpactDetected", { intentId: "in-b", subject: "in-b" });
    await appendEvent(client, projectId, "ScopeDeclared", { id: "sc-1", agentSessionId: "s-1" });

    const res = await graphEvents(client, { projectId, kind: "impact", subjectId: "in-a", mode: "live", maxEvents: 100 });
    const intents = res.events.map((event) => ((event.payload ?? {}) as { intentId?: string }).intentId);
    assert.ok(intents.includes("in-a"), "subject-matching event must be kept");
    assert.ok(!intents.includes("in-b"), "other-subject event must be dropped");
    assert.ok(res.events.some((event) => event.eventType === "ScopeDeclared"), "unkeyed event must be kept");
    assert.match(res.degraded?.reason ?? "", /scope filtering incomplete/);
  });
});

test("graph_events impact/lineage without subjectId degrades and does not silently narrow the stream", async () => {
  await withDaemon(async (client, projectId) => {
    await appendEvent(client, projectId, "ImpactDetected", { intentId: "in-a" });
    await appendEvent(client, projectId, "ImpactDetected", { intentId: "in-b" });
    const res = await graphEvents(client, { projectId, kind: "impact", mode: "live", maxEvents: 100 });
    assert.equal(res.events.length, 2);
    assert.match(res.degraded?.reason ?? "", /impact events require subjectId/);
  });
});

test("graph_events subjectId is never silently ignored, and lineage receipts filter by id/proposalId", async () => {
  await withDaemon(async (client, projectId) => {
    await appendEvent(client, projectId, "WorkItemCreated", { workItemId: "wi-1" });
    const workScoped = await graphEvents(client, { projectId, kind: "work", subjectId: "wi-1", mode: "live", maxEvents: 100 });
    assert.match(workScoped.degraded?.reason ?? "", /subjectId ignored for kind=work/);
    assert.ok(workScoped.events.some((event) => event.eventType === "WorkItemCreated"));

    await appendEvent(client, projectId, "ChangeApplied", { id: "rcpt-1", proposalId: "pr-1" });
    await appendEvent(client, projectId, "ChangeApplied", { id: "rcpt-2", proposalId: "pr-2" });
    const lineage = await graphEvents(client, { projectId, kind: "lineage", subjectId: "rcpt-1", mode: "live", maxEvents: 100 });
    const ids = lineage.events.map((event) => ((event.payload ?? {}) as { id?: string }).id);
    assert.ok(ids.includes("rcpt-1"), "subject-matching receipt must be kept");
    assert.ok(!ids.includes("rcpt-2"), "other-subject receipt must be dropped");
  });
});
