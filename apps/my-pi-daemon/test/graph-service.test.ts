import assert from "node:assert/strict";
import { test } from "node:test";
import { degradedGraph, expandGraphSnapshot } from "../dist/graph-service.js";

function chainSnapshot() {
  return {
    graphVersion: "code:v1",
    kind: "code",
    nodes: [
      { id: "a", kind: "file", label: "a" },
      { id: "b", kind: "file", label: "b" },
      { id: "c", kind: "file", label: "c" },
    ],
    edges: [
      { id: "e1", source: "a", target: "b", kind: "contains" },
      { id: "e2", source: "b", target: "c", kind: "contains" },
    ],
    bounds: {},
  };
}

test("expandGraphSnapshot selects the depth-bounded neighborhood", () => {
  const depth1 = expandGraphSnapshot(chainSnapshot(), "b", 1, {});
  assert.deepEqual(depth1.nodes.map((n) => n.id).sort(), ["a", "b", "c"]);
  const fromA = expandGraphSnapshot(chainSnapshot(), "a", 1, {});
  assert.deepEqual(fromA.nodes.map((n) => n.id).sort(), ["a", "b"]);
  assert.equal(fromA.truncated, true);
});

test("expandGraphSnapshot degrades on unknown node", () => {
  const result = expandGraphSnapshot(chainSnapshot(), "missing", 2, {});
  assert.deepEqual(result.nodes, []);
  assert.equal(result.degraded?.reason, "graph expansion node was not found in the bounded snapshot");
});

test("degradedGraph carries kind, bounds and reason", () => {
  const result = degradedGraph("impact", { maxNodes: 5 }, "impact result was not found");
  assert.equal(result.kind, "impact");
  assert.equal(result.degraded?.reason, "impact result was not found");
});
