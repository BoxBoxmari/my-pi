import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGraphSnapshot, type GraphSnapshot } from "@my-pi/graph-model";
import { createPortalServer } from "../dist/index.js";

function makeSnapshot(kind: "code" | "impact" | "work" | "lineage"): GraphSnapshot {
  return normalizeGraphSnapshot({
    graphVersion: `${kind}:v1`,
    kind,
    nodes: [
      { id: "agent:session:alpha", kind: "agent_session", label: "Alpha Agent" },
      { id: "work:item:1", kind: "work", label: "Implement Feature" },
    ],
    edges: [
      { id: "edge:claim:1", kind: "claimed_by", source: "work:item:1", target: "agent:session:alpha" },
    ],
    bounds: { maxNodes: 50, maxEdges: 50, maxAttributeBytes: 1024 },
  });
}

test("portal serves Agent Operations Theater on opt-in ?view=theater3d within 2 MiB boundary", async () => {
  const eventsLog = [
    {
      sequence: "1",
      projectId: "proj-theater",
      eventId: "ev-1",
      eventType: "AgentHeartbeat",
      occurredAt: "2026-09-15T00:00:00.000Z",
      actor: { kind: "agent_session", id: "agent:session:alpha", name: "Alpha Agent" },
    },
    {
      sequence: "2",
      projectId: "proj-theater",
      eventId: "ev-2",
      eventType: "WorkItemClaimed",
      occurredAt: "2026-09-15T00:00:01.000Z",
      actor: { kind: "agent_session", id: "agent:session:alpha", name: "Alpha Agent" },
      payload: { workItemId: "work:item:1" },
    },
  ];

  const reader = {
    graphSnapshot: async () => makeSnapshot("work"),
    graphEvents: async (input: { mode?: "live" | "replay"; afterSequence?: string; maxEvents?: number }) => {
      const after = Number(input.afterSequence ?? "0");
      const filtered = eventsLog.filter((e) => Number(e.sequence) > after);
      return {
        events: filtered,
        throughSequence: filtered.length > 0 ? filtered[filtered.length - 1]!.sequence : String(after),
        hasMore: false,
      };
    },
  };

  const portal = await createPortalServer({ reader, projectId: "proj-theater" });
  try {
    const base = new URL(portal.url);

    // 1. Default view remains standard 2D view
    const defaultPage = await fetch(portal.url, { headers: { origin: base.origin } });
    assert.equal(defaultPage.status, 200);
    const defaultHtml = await defaultPage.text();
    assert.match(defaultHtml, /my-pi graph view/);
    assert.doesNotMatch(defaultHtml, /theater-canvas/);

    // 2. Opt-in ?view=theater3d serves 3D theater view
    const theaterUrl = `${portal.url}&view=theater3d`;
    const theaterPage = await fetch(theaterUrl, { headers: { origin: base.origin } });
    assert.equal(theaterPage.status, 200);
    const html = await theaterPage.text();

    // Verify boundary: must be well below 2 MiB frame limit
    const htmlBytes = Buffer.byteLength(html, "utf8");
    assert.ok(htmlBytes < 2 * 1024 * 1024, `theater HTML exceeds 2 MiB frame limit: ${htmlBytes} bytes`);

    // Verify CSP
    const csp = theaterPage.headers.get("content-security-policy");
    assert.ok(csp);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'nonce-/);
    assert.match(csp, /style-src 'nonce-/);

    // Verify DOM structure
    assert.match(html, /id="theater-canvas"/);
    assert.match(html, /id="fallback-2d"/);
    assert.match(html, /id="svg-stage"/);
    assert.match(html, /id="dom-overlay"/);
    assert.match(html, /id="badge-degraded"/);
    assert.match(html, /id="badge-truncated"/);
    assert.match(html, /id="badge-stale"/);
    assert.match(html, /id="badge-empty"/);
    assert.match(html, /id="timeline-bar"/);

    // Verify 6-section inspector
    assert.match(html, /id="inspector-identity"/);
    assert.match(html, /id="inspector-trace"/);
    assert.match(html, /id="inspector-evidence"/);
    assert.match(html, /id="inspector-provenance"/);
    assert.match(html, /id="inspector-error"/);
    assert.match(html, /id="inspector-next-action"/);

    // 3. /api/graph/events endpoint
    // Unauthorized without session token
    const unauth = await fetch(`${base.origin}/api/graph/events`, { headers: { origin: base.origin } });
    assert.equal(unauth.status, 403);

    // Authorized live events
    const liveRes = await fetch(`${base.origin}/api/graph/events?mode=live&afterSequence=0`, {
      headers: { "x-my-pi-session": portal.token, origin: base.origin },
    });
    assert.equal(liveRes.status, 200);
    const liveData = await liveRes.json();
    assert.equal(liveData.events.length, 2);
    assert.equal(liveData.events[0].sequence, "1");
    assert.equal(liveData.events[1].sequence, "2");

    // 4. /api/graph/replay endpoint
    const replayRes = await fetch(`${base.origin}/api/graph/replay?fromSequence=1&toSequence=2`, {
      headers: { "x-my-pi-session": portal.token, origin: base.origin },
    });
    assert.equal(replayRes.status, 200);
    const replayData = await replayRes.json();
    assert.equal(replayData.events.length, 2);
  } finally {
    await portal.close();
  }
});

test("portal returns 501 for events when reader does not implement graphEvents", async () => {
  const reader = {
    graphSnapshot: async () => makeSnapshot("code"),
  };
  const portal = await createPortalServer({ reader, projectId: "proj-no-events" });
  try {
    const base = new URL(portal.url);
    const res = await fetch(`${base.origin}/api/graph/events`, {
      headers: { "x-my-pi-session": portal.token, origin: base.origin },
    });
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.match(body.error, /unavailable/);
  } finally {
    await portal.close();
  }
});
