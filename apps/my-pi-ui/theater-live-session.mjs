import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CoordinationClient } from "@my-pi/coordination-client";
import { createPortalServer } from "./dist/server.js";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = process.env.LIVE_RT;
if (!runtimeDir) throw new Error("LIVE_RT (test-mode daemon runtime dir) is required");

const client = await CoordinationClient.fromRuntimeDir(runtimeDir);
const health = await client.health();
const projectId = health.projectId;

const handle = await createPortalServer({ reader: client, projectId, host: "127.0.0.1", port: 0 });
const base = handle.url.replace(/\/?\?session=.*/, "");
const theaterUrl = `${base}/?session=${handle.token}&view=theater3d`;
writeFileSync(join(here, ".theater-live-session-url"), JSON.stringify({ pid: process.pid, projectId, theaterUrl }, null, 2), "utf8");
console.log(JSON.stringify({ pid: process.pid, projectId, theaterUrl }, null, 2));

const now = () => new Date().toISOString();
let seqIndex = 0;
async function emit(eventType, actor, payload) {
  seqIndex += 1;
  return client.call("append_event", { projectId, eventType, occurredAt: now(), actor, payload });
}

const sessionA = "session_live_impl01";
const sessionB = "session_live_rev02";
const wi = (id, title, state = "ready") => ({ id, projectId, title, state, version: state === "ready" ? 0 : 1, createdAt: now(), updatedAt: now() });

const schedule = [
  [0, "ProjectOpened", { kind: "system", name: "my-pi-live" }, { id: projectId, schemaVersion: "1", createdAt: now() }],
  [600, "AgentJoined", { kind: "agent_session", id: sessionA }, { id: sessionA, projectId, worktreeId: "wt-live", host: "opencode", status: "active", joinedAt: now(), heartbeatAt: now() }],
  [1200, "AgentJoined", { kind: "agent_session", id: sessionB }, { id: sessionB, projectId, worktreeId: "wt-live", host: "opencode-reviewer", status: "active", joinedAt: now(), heartbeatAt: now() }],
  // work items for this session's batch
  [2000, "WorkItemCreated", { kind: "system", name: "my-pi-live" }, wi("work_C1_redact", "C1 free-text sensitive-path masking")],
  [2600, "WorkItemCreated", { kind: "system", name: "my-pi-live" }, wi("work_C2_inspector", "C2 inspector honesty")],
  [3200, "WorkItemCreated", { kind: "system", name: "my-pi-live" }, wi("work_C3_subject", "C3 impact/lineage subject scoping")],
  [3800, "WorkItemCreated", { kind: "system", name: "my-pi-live" }, wi("work_C5_alias", "C5 measure alias")],
  [4400, "WorkItemCreated", { kind: "system", name: "my-pi-live" }, wi("work_GATE", "x-harness admission gate")],
  [5200, "IntentDeclared", { kind: "agent_session", id: sessionA }, { id: "intent_live_1", projectId, agentSessionId: sessionA, kind: "implementation", summary: "Close trust/honesty defects", targets: [], state: "active", createdAt: now() }],
  [6000, "WorkItemClaimed", { kind: "agent_session", id: sessionA }, { ...wi("work_C1_redact", "C1 free-text sensitive-path masking"), state: "active", assignee: sessionA, version: 1 }],
  [6800, "WorkItemClaimed", { kind: "agent_session", id: sessionA }, { ...wi("work_C2_inspector", "C2 inspector honesty"), state: "active", assignee: sessionA, version: 1 }],
  [7600, "WorkItemClaimed", { kind: "agent_session", id: sessionB }, { ...wi("work_C3_subject", "C3 impact/lineage subject scoping"), state: "active", assignee: sessionB, version: 1 }],
  [8400, "WorkItemBlocked", { kind: "agent_session", id: sessionB }, { ...wi("work_C3_subject", "C3 impact/lineage subject scoping"), state: "blocked", assignee: sessionB, version: 2 }],
  [9600, "WorkItemUnblocked", { kind: "agent_session", id: sessionB }, { ...wi("work_C3_subject", "C3 impact/lineage subject scoping"), state: "active", assignee: sessionB, version: 3 }],
  [10400, "WorkItemCompleted", { kind: "agent_session", id: sessionA }, { ...wi("work_C1_redact", "C1 free-text sensitive-path masking"), state: "done", assignee: sessionA, version: 2 }],
  [11200, "WorkItemCompleted", { kind: "agent_session", id: sessionA }, { ...wi("work_C2_inspector", "C2 inspector honesty"), state: "done", assignee: sessionA, version: 2 }],
  [12000, "WorkItemCompleted", { kind: "agent_session", id: sessionB }, { ...wi("work_C3_subject", "C3 impact/lineage subject scoping"), state: "done", assignee: sessionB, version: 4 }],
  [12800, "WorkItemClaimed", { kind: "agent_session", id: sessionA }, { ...wi("work_C5_alias", "C5 measure alias"), state: "active", assignee: sessionA, version: 1 }],
  [13600, "WorkItemCompleted", { kind: "agent_session", id: sessionA }, { ...wi("work_C5_alias", "C5 measure alias"), state: "done", assignee: sessionA, version: 2 }],
  [14400, "WorkItemClaimed", { kind: "agent_session", id: sessionB }, { ...wi("work_GATE", "x-harness admission gate"), state: "active", assignee: sessionB, version: 1 }],
];

// Fire the scripted session, then keep heartbeats flowing so the theater stays live.
for (const [delay, eventType, actor, payload] of schedule) {
  setTimeout(() => { emit(eventType, actor, payload).catch((error) => console.error("emit failed", eventType, String(error))); }, delay);
}
let beat = 0;
setInterval(() => {
  beat += 1;
  const actor = beat % 3 === 0 ? sessionB : sessionA;
  emit("AgentHeartbeat", { kind: "agent_session", id: actor }, { id: actor, projectId, worktreeId: "wt-live", sessionId: actor, status: "active", host: actor === sessionA ? "opencode" : "opencode-reviewer", heartbeatAt: now() })
    .catch(() => undefined);
}, 2000);

await new Promise(() => undefined);
