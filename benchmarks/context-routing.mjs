#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { ContextRouter } from "../packages/context-router/dist/index.js";

const events = Array.from({ length: 1000 }, (_, index) => ({ schemaVersion: "1", projectId: "project-benchmark", sequence: BigInt(index + 1), eventId: `event-${index}`, eventType: index % 3 === 0 ? "ContextPublished" : "WorkItemClaimed", occurredAt: "2026-09-04T00:00:00.000Z", actor: { kind: "system", name: "benchmark" }, payload: index % 3 === 0 ? { workItemId: "work-dependency", index } : { id: index % 2 === 0 ? "work-dependency" : "work-unrelated", index } }));
const started = performance.now();
const result = new ContextRouter().route({ agentSessionId: "session-target", currentWorkItemIds: ["work-current"], dependencyWorkItemIds: ["work-dependency"], events, maxEvents: 200, maxBytes: 128 * 1024, sinceSequence: 0n });
console.log(JSON.stringify({ profile: "context-routing", inputEvents: events.length, highPriority: result.highPriority.length, normalPriority: result.normalPriority.length, truncated: result.truncated, throughSequence: result.throughSequence.toString(), elapsedMs: Number((performance.now() - started).toFixed(3)) }, null, 2));
