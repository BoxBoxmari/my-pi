import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeEdge, CodeEntity, Intent, WorkDependency, WorkItem } from "@my-pi/contracts";
import { ImpactEngine } from "@my-pi/impact-engine";

const base = {
  projectId: "project-test" as never,
  repositoryId: "repo-test" as never,
  worktreeId: "worktree-test" as never,
  observedAt: "2026-09-04T00:00:00.000Z",
};

function entity(id: string, kind: CodeEntity["kind"], displayName: string, filePath: string): CodeEntity {
  return { ...base, id: id as never, kind, displayName, stableKey: `git:test|${kind}|${filePath}|${displayName}`, path: filePath, provider: "ast" };
}

test("PN6 finds bounded downstream impact with deterministic reasons", () => {
  const backend = entity("entity-backend", "file", "backend.ts", "src/backend.ts");
  const frontend = entity("entity-frontend", "file", "frontend.ts", "src/frontend.ts");
  const unrelated = entity("entity-unrelated", "file", "unrelated.ts", "src/unrelated.ts");
  const edges: CodeEdge[] = [{ from: frontend.id, to: backend.id, kind: "imports", confidence: "strong", provider: "ast", observedAt: base.observedAt }];
  const intent: Intent = { id: "intent-test" as never, projectId: base.projectId, agentSessionId: "session-a" as never, workItemId: "work-backend" as never, kind: "change_contract", summary: "change backend contract", targets: [{ type: "path", value: "src/backend.ts" }], state: "active", createdAt: base.observedAt };
  const workItems: WorkItem[] = [
    { id: "work-backend" as never, projectId: base.projectId, title: "backend", state: "active", assignee: "session-a" as never, version: 1, createdAt: base.observedAt, updatedAt: base.observedAt },
    { id: "work-frontend" as never, projectId: base.projectId, title: "frontend", state: "active", assignee: "session-b" as never, version: 1, createdAt: base.observedAt, updatedAt: base.observedAt },
  ];
  const dependencies: WorkDependency[] = [{ from: workItems[1]!.id, to: workItems[0]!.id, type: "depends_on" }];
  const result = new ImpactEngine().compute({ subject: intent.id, intent, entities: [backend, frontend, unrelated], edges, workItems, dependencies });
  assert.equal(result.truncated, false);
  assert.ok(result.affectedEntities.some((item) => item.entityId === backend.id));
  assert.ok(result.affectedEntities.some((item) => item.entityId === frontend.id));
  assert.ok(result.affectedWorkItems.some((item) => item.workItemId === workItems[1]!.id && item.score === 100));
  assert.ok(result.affectedAgents.some((item) => item.agentSessionId === "session-b"));
  assert.equal(result.affectedEntities.some((item) => item.entityId === unrelated.id), false);
  assert.equal(result.graphVersion.length, 24);
  assert.ok(result.reasons.every((item) => item.explanation.length > 0));
});

test("PN6 traversal bounds set truncated instead of broadcasting unbounded graph state", () => {
  const target = entity("entity-target", "file", "target.ts", "src/target.ts");
  const dependent = entity("entity-dependent", "file", "dependent.ts", "src/dependent.ts");
  const intent: Intent = { id: "intent-bounded" as never, projectId: base.projectId, agentSessionId: "session-a" as never, kind: "modify", summary: "bounded change", targets: [{ type: "path", value: "src/target.ts" }], state: "active", createdAt: base.observedAt };
  const edge: CodeEdge = { from: dependent.id, to: target.id, kind: "imports", confidence: "exact", provider: "ast", observedAt: base.observedAt };
  const result = new ImpactEngine().compute({ subject: intent.id, intent, entities: [target, dependent], edges: [edge], workItems: [], bounds: { maxEntities: 1 } });
  assert.equal(result.affectedEntities.length, 1);
  assert.equal(result.truncated, true);
});
