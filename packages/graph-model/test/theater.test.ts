import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventToMotionCue,
  computeQualityState,
  createTheaterFrame,
  validateTheaterFrame,
  normalizeGraphSnapshot,
  GRAPH_KINDS,
  GRAPH_EVENT_TYPES_BY_KIND,
  type GraphSnapshot,
  type TheaterEvent,
  type TheaterFrame,
} from "../dist/index.js";
import { COORDINATION_EVENT_TYPES } from "../../coordination-runtime/dist/event-types.js";

function makeSnapshot(nodes: Array<{ id: string; kind: string; label: string }>): GraphSnapshot {
  return normalizeGraphSnapshot({
    graphVersion: "work:v1",
    kind: "work",
    nodes,
    edges: [],
    bounds: { maxNodes: 50, maxEdges: 50, maxAttributeBytes: 1024 },
  });
}

test("eventToMotionCue projects allowlisted events to valid motion cues", () => {
  const graph = makeSnapshot([
    { id: "agent:1", kind: "agent_session", label: "Agent 1" },
    { id: "work:1", kind: "work", label: "Task 1" },
  ]);

  // 1. AgentHeartbeat -> pulse
  const heartbeatEvent: TheaterEvent = {
    sequence: "1",
    projectId: "p1",
    eventId: "e1",
    eventType: "AgentHeartbeat",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: { kind: "agent_session", id: "agent:1" },
  };
  const cue1 = eventToMotionCue(heartbeatEvent, graph);
  assert.ok(cue1);
  assert.equal(cue1.type, "pulse");
  assert.equal(cue1.targetNodeId, "agent:1");

  // 2. WorkItemClaimed -> claim
  const claimEvent: TheaterEvent = {
    sequence: "2",
    projectId: "p1",
    eventId: "e2",
    eventType: "WorkItemClaimed",
    occurredAt: "2026-09-15T00:00:01.000Z",
    actor: { kind: "agent_session", id: "agent:1" },
    payload: { workItemId: "work:1" },
  };
  const cue2 = eventToMotionCue(claimEvent, graph);
  assert.ok(cue2);
  assert.equal(cue2.type, "claim");
  assert.equal(cue2.targetNodeId, "work:1");

  // 3. WorkItemBlocked -> blocked
  const blockEvent: TheaterEvent = {
    sequence: "3",
    projectId: "p1",
    eventId: "e3",
    eventType: "WorkItemBlocked",
    occurredAt: "2026-09-15T00:00:02.000Z",
    actor: { kind: "work", id: "work:1" },
  };
  const cue3 = eventToMotionCue(blockEvent, graph);
  assert.ok(cue3);
  assert.equal(cue3.type, "blocked");
  assert.equal(cue3.targetNodeId, "work:1");

  // 4. IntentDeclared -> intent
  const intentEvent: TheaterEvent = {
    sequence: "4",
    projectId: "p1",
    eventId: "e4",
    eventType: "IntentDeclared",
    occurredAt: "2026-09-15T00:00:03.000Z",
    actor: { kind: "agent_session", id: "agent:1" },
  };
  const cue4 = eventToMotionCue(intentEvent, graph);
  assert.ok(cue4);
  assert.equal(cue4.type, "intent");
  assert.equal(cue4.targetNodeId, "agent:1");

  // 5. WorkItemCompleted -> settle
  const completeEvent: TheaterEvent = {
    sequence: "5",
    projectId: "p1",
    eventId: "e5",
    eventType: "WorkItemCompleted",
    occurredAt: "2026-09-15T00:00:04.000Z",
    actor: { kind: "work", id: "work:1" },
  };
  const cue5 = eventToMotionCue(completeEvent, graph);
  assert.ok(cue5);
  assert.equal(cue5.type, "settle");
  assert.equal(cue5.targetNodeId, "work:1");

  // 6. Unknown event type -> null (pure read-only projector, no side effects)
  const unknownEvent: TheaterEvent = {
    sequence: "6",
    projectId: "p1",
    eventId: "e6",
    eventType: "CustomRandomEvent",
    occurredAt: "2026-09-15T00:00:05.000Z",
    actor: { kind: "unknown", id: "random:1" },
  };
  assert.equal(eventToMotionCue(unknownEvent, graph), null);

  // 7. Event referencing non-existent node -> null
  const missingNodeEvent: TheaterEvent = {
    sequence: "7",
    projectId: "p1",
    eventId: "e7",
    eventType: "WorkItemClaimed",
    occurredAt: "2026-09-15T00:00:06.000Z",
    actor: { kind: "agent_session", id: "non-existent" },
    payload: { workItemId: "non-existent-work" },
  };
  assert.equal(eventToMotionCue(missingNodeEvent, graph), null);
});

test("computeQualityState evaluates degraded, truncated, stale, and empty states", () => {
  const normalGraph = makeSnapshot([{ id: "node:1", kind: "file", label: "File 1" }]);
  const emptyGraph = makeSnapshot([]);
  const truncatedGraph = normalizeGraphSnapshot({
    graphVersion: "code:v1",
    kind: "code",
    bounds: { maxNodes: 1, maxEdges: 1 },
    nodes: [
      { id: "node:1", kind: "file", label: "File 1" },
      { id: "node:2", kind: "file", label: "File 2" },
    ],
    edges: [],
  });
  const degradedGraph = { ...normalGraph, degraded: { reason: "Missing worktree index" } };

  // Case 1: Healthy
  const qHealthy = computeQualityState(normalGraph);
  assert.equal(qHealthy.degraded, false);
  assert.equal(qHealthy.truncated, false);
  assert.equal(qHealthy.stale, false);
  assert.equal(qHealthy.empty, false);
  assert.equal(qHealthy.reasons.length, 0);

  // Case 2: Empty
  const qEmpty = computeQualityState(emptyGraph);
  assert.equal(qEmpty.empty, true);
  assert.ok(qEmpty.reasons.some((r) => r.includes("zero nodes")));

  // Case 3: Truncated
  const qTruncated = computeQualityState(truncatedGraph);
  assert.equal(qTruncated.truncated, true);
  assert.ok(qTruncated.reasons.some((r) => r.includes("truncated within bounds")));

  // Case 4: Degraded
  const qDegraded = computeQualityState(degradedGraph);
  assert.equal(qDegraded.degraded, true);
  assert.ok(qDegraded.reasons.some((r) => r.includes("Missing worktree index")));

  // Case 5: Stale
  const qStale = computeQualityState(normalGraph, [], { isStale: true });
  assert.equal(qStale.stale, true);
  assert.ok(qStale.reasons.some((r) => r.includes("stale")));
});

test("createTheaterFrame and validateTheaterFrame guarantee canonical contract", () => {
  const graph = makeSnapshot([{ id: "node:1", kind: "work", label: "Task 1" }]);
  const frame = createTheaterFrame({
    scope: { projectId: "test-proj", kind: "work" },
    graph,
    events: [
      {
        sequence: "10",
        projectId: "test-proj",
        eventId: "e10",
        eventType: "WorkItemClaimed",
        occurredAt: "2026-09-15T00:00:00.000Z",
        actor: { kind: "agent", id: "node:1" },
      },
    ],
    cursor: { lastSequence: "10" },
  });

  assert.equal(frame.schemaVersion, "my-pi/theater-frame/v1");
  assert.equal(frame.scope.projectId, "test-proj");
  assert.equal(frame.scope.kind, "work");
  assert.equal(frame.events.length, 1);
  assert.equal(frame.cursor.lastSequence, "10");
  assert.equal(frame.capabilities.replay, true);
  assert.equal(frame.capabilities.live, true);

  const validation = validateTheaterFrame(frame);
  assert.equal(validation.ok, true);
  assert.equal(validation.errors.length, 0);

  // Invalid frame check
  const invalidFrame = { ...frame, schemaVersion: "invalid-version" };
  const invalidResult = validateTheaterFrame(invalidFrame);
  assert.equal(invalidResult.ok, false);
  assert.ok(invalidResult.errors.some((e) => e.includes("schemaVersion")));
});

test("GRAPH_EVENT_TYPES_BY_KIND covers GRAPH_KINDS with valid CoordinationEventTypes only", () => {
  const realTypes = new Set<string>(COORDINATION_EVENT_TYPES);
  assert.ok(realTypes.size > 0);
  assert.deepEqual(Object.keys(GRAPH_EVENT_TYPES_BY_KIND).slice().sort(), [...GRAPH_KINDS].slice().sort());
  for (const kind of GRAPH_KINDS) {
    const types = GRAPH_EVENT_TYPES_BY_KIND[kind];
    assert.ok(Array.isArray(types), `${kind} event types must be an array`);
    assert.ok(types.length > 0, `${kind} event types must be non-empty`);
    for (const value of types) {
      assert.ok(realTypes.has(value), `${kind} contains "${value}" which is not a real CoordinationEventType`);
    }
  }
});
