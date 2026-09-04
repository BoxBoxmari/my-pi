#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { ImpactEngine } from "../packages/impact-engine/dist/index.js";

const corpus = JSON.parse(await readFile(new URL("../fixtures/impact-routing/corpus.json", import.meta.url), "utf8"));
const engine = new ImpactEngine();
const started = performance.now();
let fullTruePositives = 0;
let fullFalsePositives = 0;
let fullFalseNegatives = 0;
let baselineTruePositives = 0;
let baselineFalsePositives = 0;
let baselineFalseNegatives = 0;

for (const sample of corpus) {
  const entities = [
    { id: "entity-backend", projectId: "project-test", repositoryId: "repo-test", worktreeId: "worktree-test", kind: "file", stableKey: "backend", displayName: "backend.ts", path: "src/backend.ts", observedAt: "2026-09-04T00:00:00.000Z", provider: "ast" },
    { id: "entity-frontend", projectId: "project-test", repositoryId: "repo-test", worktreeId: "worktree-test", kind: "file", stableKey: "frontend", displayName: "frontend.ts", path: "src/frontend.ts", observedAt: "2026-09-04T00:00:00.000Z", provider: "ast" },
    { id: "entity-docs", projectId: "project-test", repositoryId: "repo-test", worktreeId: "worktree-test", kind: "file", stableKey: "docs", displayName: "README.md", path: "README.md", observedAt: "2026-09-04T00:00:00.000Z", provider: "fs" },
  ];
  const workItems = [
    { id: "work-backend", projectId: "project-test", title: "backend", state: "active", assignee: "session-a", version: 1, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" },
    { id: "work-frontend", projectId: "project-test", title: "frontend", state: "active", assignee: "session-b", version: 1, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" },
    { id: "work-docs", projectId: "project-test", title: "docs", state: "active", assignee: "session-c", version: 1, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" },
  ];
  const backendIntent = { id: "intent-backend", projectId: "project-test", agentSessionId: "session-a", workItemId: "work-backend", kind: "change_contract", summary: "backend contract", targets: [{ type: "path", value: sample.targetPath }], state: "active", createdAt: "2026-09-04T00:00:00.000Z" };
  const frontendIntent = { id: "intent-frontend", projectId: "project-test", agentSessionId: "session-b", workItemId: "work-frontend", kind: "modify", summary: "frontend", targets: [{ type: "path", value: "src/frontend.ts" }], state: "active", createdAt: "2026-09-04T00:00:00.000Z" };
  const result = engine.compute({ subject: backendIntent.id, intent: backendIntent, entities, edges: [{ ...sample.edge, projectId: "project-test", repositoryId: "repo-test", worktreeId: "worktree-test", provider: "ast", observedAt: "2026-09-04T00:00:00.000Z" }], workItems, activeIntents: [backendIntent, frontendIntent] });
  const affected = new Set(result.affectedWorkItems.map((item) => item.workItemId));
  const expected = new Set(sample.expectedAffectedWorkItems);
  for (const id of expected) affected.has(id) ? fullTruePositives++ : fullFalseNegatives++;
  for (const id of affected) if (!expected.has(id) && id !== "work-backend") fullFalsePositives++;
  const baseline = new Set(["work-backend"]);
  for (const id of expected) baseline.has(id) ? baselineTruePositives++ : baselineFalseNegatives++;
  for (const id of baseline) if (!expected.has(id)) baselineFalsePositives++;
}

const elapsedMs = performance.now() - started;
const metrics = (tp, fp, fn) => ({ precision: tp + fp === 0 ? 1 : Number((tp / (tp + fp)).toFixed(3)), recall: tp + fn === 0 ? 1 : Number((tp / (tp + fn)).toFixed(3)), tp, fp, fn });
console.log(JSON.stringify({ profile: "impact-routing", cases: corpus.length, elapsedMs: Number(elapsedMs.toFixed(3)), full: metrics(fullTruePositives, fullFalsePositives, fullFalseNegatives), explicitWorkOnlyBaseline: metrics(baselineTruePositives, baselineFalsePositives, baselineFalseNegatives) }, null, 2));
