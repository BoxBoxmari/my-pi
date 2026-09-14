import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCodeGraph, projectImpactGraph, projectLineageGraph, projectWorkGraph } from "../dist/index.js";

const projectId = "project-graph" as never;
const repositoryId = "repo-graph" as never;
const worktreeId = "worktree-graph" as never;

function entity(id: string, path: string, displayName = id) {
  return { id: id as never, projectId, repositoryId, worktreeId, kind: "file" as const, stableKey: `file:${path}`, displayName, path, observedAt: "2026-09-13T00:00:00.000Z", provider: "fs" as const };
}

test("code projection is deterministic and hides sensitive paths", () => {
  const visible = entity("entity-visible", "src/a.ts", "a.ts");
  const hidden = entity("entity-secret", ".env", ".env");
  const hiddenByStableKey = { ...entity("entity-key", "src/public.ts", "public.ts"), stableKey: "file:.ssh/id_rsa" };
  const snapshot = projectCodeGraph({
    entities: [hidden, hiddenByStableKey, visible],
    edges: [{ from: visible.id, to: hidden.id, kind: "imports", confidence: "exact", provider: "test", observedAt: visible.observedAt }],
  });
  assert.deepEqual(snapshot.nodes.map((item) => item.id), ["entity:entity-key", "entity:entity-visible"]);
  assert.equal(snapshot.edges.length, 0);
  assert.equal(snapshot.nodes[1]?.attributes?.path, "src/a.ts");
  assert.equal(snapshot.nodes[0]?.attributes?.stableKey, undefined);
});

test("impact and work projections retain bounded reason and dependency lineage", () => {
  const result = projectImpactGraph({
    result: {
      subject: "intent-1" as never,
      affectedWorkItems: [{ workItemId: "work-1" as never, score: 0.8, reasons: [{ code: "same_work_item", score: 0.8, explanation: "same work" }] }],
      affectedAgents: [],
      affectedEntities: [{ entityId: "entity-1" as never, score: 0.9, reasons: [{ code: "graph_edge", score: 0.9, explanation: "edge" }] }],
      confidence: 0.8,
      reasons: [],
      graphVersion: "impact:test",
      truncated: false,
    },
    workItems: [{ id: "work-1" as never, projectId, title: "work", state: "active", version: 1, createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z" }],
  });
  assert.equal(result.kind, "impact");
  assert.equal(result.edges.length, 2);
  const work = projectWorkGraph({
    workItems: [{ id: "work-1" as never, projectId, title: "one", state: "ready", version: 0, createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z" }],
    dependencies: [{ from: "work-1" as never, to: "missing" as never, type: "depends_on" }],
  });
  assert.equal(work.edges[0]?.kind, "depends_on");
  assert.equal(work.nodes.some((item) => item.attributes?.missing === true), true);
});

test("lineage projection exposes only authoritative records and deterministic derived links", () => {
  const snapshot = projectLineageGraph({
    proposal: { id: "proposal-1" as never, projectId, agentSessionId: "session-1" as never, resources: [], proposedAt: "2026-09-13T00:00:00.000Z" },
    receipt: { id: "receipt-1" as never, proposalId: "proposal-1" as never, projectId, worktreeId, status: "APPLIED", resources: [], publishedAt: "2026-09-13T00:01:00.000Z", receiptDigest: "digest" },
  });
  assert.deepEqual(snapshot.nodes.map((item) => item.id), ["proposal:proposal-1", "receipt:receipt-1"]);
  assert.equal(snapshot.edges[0]?.provenance, "derived");
  assert.equal(snapshot.edges[0]?.kind, "published_as");
});
