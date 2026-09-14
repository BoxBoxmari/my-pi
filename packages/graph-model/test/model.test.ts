import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGraphSnapshot, traceGraphSnapshot, validateGraphSnapshot } from "../dist/index.js";

test("graph model is deterministic across input ordering", () => {
  const first = normalizeGraphSnapshot({
    graphVersion: "code:v1",
    kind: "code",
    nodes: [
      { id: "file:b", kind: "file", label: "B", evidence: [{ type: "source", id: "b" }] },
      { id: "file:a", kind: "file", label: "A" },
    ],
    edges: [{ id: "imports:a:b", kind: "imports", source: "file:a", target: "file:b" }],
  });
  const second = normalizeGraphSnapshot({
    graphVersion: "code:v1",
    kind: "code",
    nodes: [
      { id: "file:a", kind: "file", label: "A" },
      { id: "file:b", kind: "file", label: "B", evidence: [{ type: "source", id: "b" }] },
    ],
    edges: [{ id: "imports:a:b", kind: "imports", source: "file:a", target: "file:b" }],
  });
  assert.deepEqual(first, second);
  assert.deepEqual(first.nodes.map((node) => node.id), ["file:a", "file:b"]);
});

test("graph model bounds nodes and drops edges to truncated nodes", () => {
  const snapshot = normalizeGraphSnapshot({
    graphVersion: "impact:v1",
    kind: "impact",
    bounds: { maxNodes: 2, maxEdges: 1 },
    nodes: [
      { id: "node:c", kind: "entity", label: "C" },
      { id: "node:a", kind: "entity", label: "A" },
      { id: "node:b", kind: "entity", label: "B" },
    ],
    edges: [
      { id: "edge:a:b", kind: "related", source: "node:a", target: "node:b" },
      { id: "edge:a:c", kind: "related", source: "node:a", target: "node:c" },
    ],
  });
  assert.equal(snapshot.truncated, true);
  assert.deepEqual(snapshot.nodes.map((node) => node.id), ["node:a", "node:b"]);
  assert.deepEqual(snapshot.edges.map((edge) => edge.id), ["edge:a:b"]);
});

test("graph model rejects duplicate identifiers and non-scalar attributes", () => {
  assert.throws(() => normalizeGraphSnapshot({
    graphVersion: "work:v1",
    kind: "work",
    nodes: [
      { id: "duplicate", kind: "work", label: "one" },
      { id: "duplicate", kind: "work", label: "two" },
    ],
    edges: [],
  }), /node ids/);
  assert.throws(() => normalizeGraphSnapshot({
    graphVersion: "work:v1",
    kind: "work",
    nodes: [{ id: "work:1", kind: "work", label: "one", attributes: { payload: { nested: true } as never } }],
    edges: [],
  }), /must be a scalar/);
});

test("graph validation reports invalid snapshots without mutating them", () => {
  const invalid = { schemaVersion: "2", graphVersion: "lineage:v1", kind: "lineage", nodes: [], edges: [], bounds: { maxNodes: 1, maxEdges: 1, maxAttributeBytes: 100 }, truncated: false };
  const result = validateGraphSnapshot(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.equal(invalid.schemaVersion, "2");
});

test("graph validation rejects dangling edges instead of silently dropping them", () => {
  const invalid = {
    schemaVersion: "1",
    graphVersion: "code:v1",
    kind: "code",
    nodes: [{ id: "node:a", kind: "file", label: "A" }],
    edges: [{ id: "edge:a:missing", kind: "imports", source: "node:a", target: "node:missing" }],
    bounds: { maxNodes: 10, maxEdges: 10, maxAttributeBytes: 100 },
    truncated: false,
  };
  const result = validateGraphSnapshot(invalid);
  assert.equal(result.ok, false);
  assert.match(result.errors[0] ?? "", /endpoint is missing/);
});

test("graph trace returns a deterministic bounded directed path", () => {
  const snapshot = normalizeGraphSnapshot({
    graphVersion: "code:v1",
    kind: "code",
    nodes: [
      { id: "node:c", kind: "file", label: "C" },
      { id: "node:a", kind: "file", label: "A" },
      { id: "node:b", kind: "file", label: "B" },
    ],
    edges: [
      { id: "edge:b:c", kind: "imports", source: "node:b", target: "node:c" },
      { id: "edge:a:b", kind: "imports", source: "node:a", target: "node:b" },
    ],
  });
  const trace = traceGraphSnapshot({ snapshot, fromNodeId: "node:a", toNodeId: "node:c", maxDepth: 2, bounds: { maxNodes: 3, maxEdges: 2 } });
  assert.equal(trace.schemaVersion, "my-pi/graph-trace/v1");
  assert.equal(trace.found, true);
  assert.deepEqual(trace.nodes.map((node) => node.id), ["node:a", "node:b", "node:c"]);
  assert.deepEqual(trace.edges.map((edge) => edge.id), ["edge:a:b", "edge:b:c"]);
  assert.equal(trace.truncated, false);
});

test("graph trace reports no path without inventing edges", () => {
  const snapshot = normalizeGraphSnapshot({
    graphVersion: "work:v1",
    kind: "work",
    nodes: [
      { id: "node:a", kind: "work", label: "A" },
      { id: "node:b", kind: "work", label: "B" },
    ],
    edges: [],
  });
  const trace = traceGraphSnapshot({ snapshot, fromNodeId: "node:a", toNodeId: "node:b", maxDepth: 1 });
  assert.equal(trace.found, false);
  assert.deepEqual(trace.edges, []);
  assert.deepEqual(trace.nodes.map((node) => node.id), ["node:a", "node:b"]);
});
