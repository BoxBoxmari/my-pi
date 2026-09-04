import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoordinationEvent } from "@my-pi/contracts";
import { ContextRouter } from "@my-pi/context-router";

function event(sequence: bigint, type: string, payload: Record<string, unknown>): CoordinationEvent {
  return { schemaVersion: "1", projectId: "project-test" as never, sequence, eventId: `event-${sequence}` as never, eventType: type, occurredAt: "2026-09-04T00:00:00.000Z", actor: { kind: "system", name: "test" }, payload };
}

test("PN6 context router delivers dependency context and excludes unrelated events", () => {
  const result = new ContextRouter().route({
    agentSessionId: "session-b" as never,
    currentWorkItemIds: ["work-frontend" as never],
    dependencyWorkItemIds: ["work-backend" as never],
    events: [
      event(1n, "WorkItemClaimed", { id: "work-backend", assignee: "session-a" }),
      event(2n, "ContextPublished", { id: "artifact-1", workItemId: "work-backend" }),
      event(3n, "WorkItemClaimed", { id: "work-unrelated", assignee: "session-c" }),
      event(4n, "WorkItemClaimed", { id: "work-frontend", assignee: "session-b" }),
    ],
    maxEvents: 20,
    maxBytes: 64 * 1024,
  });
  assert.equal(result.truncated, false);
  assert.ok(result.normalPriority.some((item) => item.reason === "dependency_work_item"));
  assert.ok(result.highPriority.some((item) => item.reason === "same_agent"));
  assert.equal(result.highPriority.some((item) => JSON.stringify(item.event.payload).includes("work-unrelated")), false);
});

test("PN6 context router applies event and byte bounds", () => {
  const result = new ContextRouter().route({
    agentSessionId: "session-a" as never,
    currentWorkItemIds: ["work-a" as never],
    events: [event(1n, "WorkItemClaimed", { id: "work-a", data: "x".repeat(1_000) }), event(2n, "WorkItemClaimed", { id: "work-a" })],
    maxEvents: 1,
    maxBytes: 64,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.highPriority.length, 0);
});

test("PN6 context router deduplicates events and collapses superseded artifacts", () => {
  const oldArtifact = event(1n, "ContextPublished", { id: "artifact-old", workItemId: "work-backend" });
  const currentArtifact = event(2n, "ContextPublished", { id: "artifact-current", workItemId: "work-backend", supersedes: "artifact-old" });
  const duplicate = { ...currentArtifact, sequence: 3n };
  const result = new ContextRouter().route({
    agentSessionId: "session-dependent" as never,
    currentWorkItemIds: [],
    dependencyWorkItemIds: ["work-backend" as never],
    events: [oldArtifact, currentArtifact, duplicate],
    maxEvents: 10,
    maxBytes: 64 * 1024,
  });
  assert.equal(result.normalPriority.length, 1);
  assert.equal(result.normalPriority[0]?.event.eventId, currentArtifact.eventId);
  assert.equal(result.throughSequence, 3n);
});
