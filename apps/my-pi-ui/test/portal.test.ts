import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGraphSnapshot, traceGraphSnapshot, type GraphSnapshot } from "@my-pi/graph-model";
import { createPortalServer } from "../dist/index.js";

function snapshot(kind: "code" | "impact" | "work" | "lineage"): GraphSnapshot {
  return normalizeGraphSnapshot({ graphVersion: `${kind}:v1`, kind, nodes: [{ id: `${kind}:one`, kind: "fixture", label: "fixture", evidence: [{ type: "derived", id: "fixture" }] }], edges: [], bounds: { maxNodes: 10, maxEdges: 10, maxAttributeBytes: 1024 } });
}

test("portal is loopback-only, token-protected, bounded, and serves the shared graph view", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const reader = {
    graphSnapshot: async (input: Record<string, unknown>) => { requests.push(input); return snapshot((input.kind ?? "code") as "code" | "impact" | "work" | "lineage"); },
    graphExpand: async (input: Record<string, unknown>) => { requests.push({ ...input, operation: "expand" }); return snapshot((input.kind ?? "code") as "code" | "impact" | "work" | "lineage"); },
    graphTrace: async (input: Record<string, unknown>) => {
      requests.push({ ...input, operation: "trace" });
      const kind = (input.kind ?? "code") as "code" | "impact" | "work" | "lineage";
      return traceGraphSnapshot({ snapshot: snapshot(kind), fromNodeId: String(input.fromNodeId), toNodeId: String(input.toNodeId), maxDepth: Number(input.maxDepth ?? 1) });
    },
  };
  const portal = await createPortalServer({ reader, projectId: "project-portal" });
  try {
    const base = new URL(portal.url);
    const denied = await fetch(`${base.origin}/`);
    assert.equal(denied.status, 403);
    const page = await fetch(portal.url, { headers: { origin: base.origin } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /code/);
    assert.match(html, /lineage/);
    assert.doesNotMatch(html, /https:\/\//);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const invalidToken = await fetch(`${base.origin}/api/graph?kind=code`, { headers: { "x-my-pi-session": "0".repeat(32), origin: base.origin } });
    assert.equal(invalidToken.status, 403);
    const graph = await fetch(`${base.origin}/api/graph?kind=impact&maxNodes=4&maxEdges=6`, { headers: { "x-my-pi-session": portal.token, origin: base.origin } });
    assert.equal(graph.status, 200);
    assert.equal((await graph.json()).kind, "impact");
    assert.equal(requests.at(-1)?.maxNodes, 4);
    const expanded = await fetch(`${base.origin}/api/graph?kind=impact&operation=expand&nodeId=impact%3Aone&depth=2`, { headers: { "x-my-pi-session": portal.token, origin: base.origin } });
    assert.equal(expanded.status, 200);
    assert.equal((await expanded.json()).kind, "impact");
    assert.equal(requests.at(-1)?.depth, 2);
    const traced = await fetch(`${base.origin}/api/graph?kind=impact&operation=trace&fromNodeId=impact%3Aone&toNodeId=impact%3Aone&depth=2`, { headers: { "x-my-pi-session": portal.token, origin: base.origin } });
    assert.equal(traced.status, 200);
    assert.equal((await traced.json()).schemaVersion, "my-pi/graph-trace/v1");
    assert.equal(requests.at(-1)?.operation, "trace");
    assert.equal(requests.at(-1)?.maxDepth, 2);
    const invalidKind = await fetch(`${base.origin}/api/graph?kind=mutation`, { headers: { "x-my-pi-session": portal.token, origin: base.origin } });
    assert.equal(invalidKind.status, 400);
    const invalidOrigin = await fetch(`${base.origin}/api/graph?kind=code`, { headers: { "x-my-pi-session": portal.token, origin: "https://evil.invalid" } });
    assert.equal(invalidOrigin.status, 403);
  } finally {
    await portal.close();
  }
});

test("portal rejects non-loopback binding", async () => {
  await assert.rejects(createPortalServer({ reader: { graphSnapshot: async () => snapshot("code") }, projectId: "project-portal", host: "0.0.0.0" as "127.0.0.1" }), /loopback/);
});
