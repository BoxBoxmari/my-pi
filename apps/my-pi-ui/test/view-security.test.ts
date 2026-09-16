import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGraphSnapshot } from "@my-pi/graph-model";
import { renderGraphViewHtml, renderTheaterViewHtml } from "../dist/index.js";

function snapshotWithMaliciousLabel() {
  return normalizeGraphSnapshot({
    graphVersion: "code:v1",
    kind: "code",
    nodes: [{ id: "evil:1", kind: "file", label: `</script><script>alert("xss")</script>` }],
    edges: [],
    bounds: { maxNodes: 10, maxEdges: 10, maxAttributeBytes: 4096 },
  });
}

test("view CSP: nonce is quote-stripped and applied to style/script", () => {
  const html = renderGraphViewHtml({
    sessionToken: "tok",
    nonce: `ab"cd`,
    initialSnapshot: snapshotWithMaliciousLabel(),
    apiBase: "/api/graph",
  });
  assert.ok(!html.includes('nonce="ab"cd"'), "quotes must be stripped from nonce");
  assert.ok(html.includes("nonce=\"abcd\""), "sanitized nonce is applied");
  assert.ok(/<style nonce=/.test(html), "inline style carries nonce");
  assert.ok(/<script nonce=/.test(html), "inline script carries nonce");
});

test("view XSS: server data embedded in script is escaped", () => {
  const html = renderGraphViewHtml({
    sessionToken: "tok",
    nonce: "n",
    initialSnapshot: snapshotWithMaliciousLabel(),
    apiBase: "/api/graph",
  });
  assert.ok(!html.includes("</script><script>"), "raw script breakout must not appear");
  assert.ok(html.includes("\\u003c"), "angle brackets are unicode-escaped");
});

test("theater view preserves escaping and nonce properties", () => {
  const frame = {
    scope: { kind: "code" },
    cursor: { lastSequence: "0" },
    graph: snapshotWithMaliciousLabel(),
    events: [],
    quality: { degraded: false, truncated: false, stale: false, empty: false, reasons: [] },
  };
  const html = renderTheaterViewHtml({
    sessionToken: `tok"/><script>`,
    nonce: "n",
    initialFrame: frame,
    apiBase: "/api",
  });
  assert.ok(!html.includes(`tok"/><script>`), "session token is JSON-escaped for script context");
  assert.ok(/nonce="n"/.test(html), "nonce is applied");
});
