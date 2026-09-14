import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
  normalizeGraphSnapshot,
  traceGraphSnapshot,
  type GraphSnapshot,
} from "@my-pi/graph-model";
import { createPortalServer, renderGraphViewHtml } from "../dist/index.js";

const NODE_COUNTS = [500, 1_000, 2_000] as const;
const EDGES_PER_NODE = 2;
const PORTAL_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const OPERATION_BUDGET_MS = 5_000;

function fixtureFor(input: Record<string, unknown>, fixtures: Map<number, GraphSnapshot>): GraphSnapshot {
  const requested = Number(input.maxNodes ?? NODE_COUNTS[0]);
  const fixture = fixtures.get(requested);
  if (!fixture) throw new Error(`missing graph fixture for ${requested} nodes`);
  return fixture;
}

function makeGraphFixture(nodeCount: number): GraphSnapshot {
  const nodeId = (index: number) => `fixture:node:${index.toString().padStart(4, "0")}`;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: nodeId(index),
    kind: "file",
    label: `fixture-file-${index.toString().padStart(4, "0")}.ts`,
    attributes: {
      index,
      path: `fixtures/graph-${nodeCount}/file-${index.toString().padStart(4, "0")}.ts`,
    },
    evidence: [{ type: "source" as const, id: `fixture-source:${nodeCount}:${index}` }],
    provenance: "derived" as const,
  }));
  const edges = Array.from({ length: nodeCount * EDGES_PER_NODE }, (_, index) => {
    const source = index % nodeCount;
    const step = index < nodeCount ? 1 : 17;
    return {
      id: `fixture:edge:${index.toString().padStart(4, "0")}`,
      kind: index < nodeCount ? "imports" : "references",
      source: nodeId(source),
      target: nodeId((source + step) % nodeCount),
      attributes: { weight: (index % 7) + 1 },
      evidence: [{ type: "derived" as const, id: `fixture-edge:${nodeCount}:${index}` }],
      provenance: "derived" as const,
    };
  });
  return normalizeGraphSnapshot({
    graphVersion: `code:scale-v1:${nodeCount}`,
    kind: "code",
    nodes,
    edges,
    bounds: {
      maxNodes: nodeCount,
      maxEdges: nodeCount * EDGES_PER_NODE,
      maxAttributeBytes: 1_024,
    },
  });
}

test("graph fixtures stay bounded at 500, 1,000, and 2,000 nodes", async () => {
  const fixtures = new Map<number, GraphSnapshot>();
  const measurements: Array<Record<string, number | string | boolean>> = [];

  for (const nodeCount of NODE_COUNTS) {
    const buildStarted = performance.now();
    const fixture = makeGraphFixture(nodeCount);
    const buildMs = performance.now() - buildStarted;
    fixtures.set(nodeCount, fixture);

    const snapshotJson = JSON.stringify(fixture);
    const snapshotBytes = Buffer.byteLength(snapshotJson, "utf8");
    const snapshotDigest = createHash("sha256").update(snapshotJson).digest("hex");
    assert.equal(fixture.nodes.length, nodeCount);
    assert.equal(fixture.edges.length, nodeCount * EDGES_PER_NODE);
    assert.equal(fixture.truncated, false);
    assert.ok(buildMs < OPERATION_BUDGET_MS, `${nodeCount}-node fixture build exceeded budget`);
    assert.ok(snapshotBytes < PORTAL_RESPONSE_LIMIT_BYTES, `${nodeCount}-node snapshot exceeds portal limit`);

    const renderStarted = performance.now();
    const html = renderGraphViewHtml({
      sessionToken: "s".repeat(64),
      nonce: "n".repeat(32),
      initialSnapshot: fixture,
      apiBase: "/api/graph",
    });
    const renderMs = performance.now() - renderStarted;
    const htmlBytes = Buffer.byteLength(html, "utf8");
    assert.ok(renderMs < OPERATION_BUDGET_MS, `${nodeCount}-node HTML render exceeded budget`);
    assert.ok(htmlBytes < PORTAL_RESPONSE_LIMIT_BYTES, `${nodeCount}-node HTML exceeds portal limit`);
    assert.match(html, new RegExp(`fixture-file-${(nodeCount - 1).toString().padStart(4, "0")}`));

    measurements.push({
      nodeCount,
      edgeCount: fixture.edges.length,
      snapshotBytes,
      htmlBytes,
      buildMs: Number(buildMs.toFixed(3)),
      renderMs: Number(renderMs.toFixed(3)),
      snapshotDigest,
      truncated: fixture.truncated,
    });
  }

  const portal = await createPortalServer({
    projectId: "graph-scale",
    reader: {
      graphSnapshot: async (input: Record<string, unknown>) => fixtureFor(input, fixtures),
      graphExpand: async (input: Record<string, unknown>) => fixtureFor(input, fixtures),
      graphTrace: async (input: Record<string, unknown>) => traceGraphSnapshot({
        snapshot: fixtureFor(input, fixtures),
        fromNodeId: "fixture:node:0000",
        toNodeId: "fixture:node:0001",
        maxDepth: 1,
      }),
    },
  });
  try {
    const origin = new URL(portal.url).origin;
    for (const measurement of measurements) {
      const nodeCount = Number(measurement.nodeCount);
      const responseStarted = performance.now();
      const response = await fetch(`${origin}/api/graph?kind=code&maxNodes=${nodeCount}&maxEdges=${nodeCount * EDGES_PER_NODE}`, {
        headers: { origin, "x-my-pi-session": portal.token },
      });
      const body = await response.text();
      const responseMs = performance.now() - responseStarted;
      assert.equal(response.status, 200);
      const payload = JSON.parse(body) as GraphSnapshot;
      assert.equal(payload.nodes.length, nodeCount);
      assert.equal(payload.edges.length, nodeCount * EDGES_PER_NODE);
      assert.equal(payload.truncated, false);
      const responseBytes = Buffer.byteLength(body, "utf8");
      assert.ok(responseMs < OPERATION_BUDGET_MS, `${nodeCount}-node portal response exceeded budget`);
      assert.ok(responseBytes < PORTAL_RESPONSE_LIMIT_BYTES, `${nodeCount}-node portal response exceeds limit`);
      measurement.responseBytes = responseBytes;
      measurement.responseMs = Number(responseMs.toFixed(3));
    }
  } finally {
    await portal.close();
  }

  console.log(`graph-scale-evidence ${JSON.stringify({
    schemaVersion: "my-pi/graph-scale-evidence/v1",
    edgeDensity: `${EDGES_PER_NODE}:1`,
    responseLimitBytes: PORTAL_RESPONSE_LIMIT_BYTES,
    operationBudgetMs: OPERATION_BUDGET_MS,
    measurements,
  })}`);
});
