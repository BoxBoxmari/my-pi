import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTheaterFrame, normalizeGraphSnapshot, type GraphNode, type GraphSnapshot } from "@my-pi/graph-model";
import { buildInspectorObservation, createPortalServer, renderTheaterViewHtml } from "../dist/index.js";

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

test("buildInspectorObservation renders only observed state: zero-observation node never says Observed", () => {
  const bare = { id: "work:item:bare", kind: "work", label: "Bare" } as GraphNode;
  const obs = buildInspectorObservation(bare);
  assert.ok(!/Observed/.test(obs.stateRowHtml + obs.provenanceHtml), "no fabricated Observed");
  assert.match(obs.stateRowHtml, /Not observed/);
  assert.match(obs.provenanceHtml, /Not observed/);
});

test("buildInspectorObservation renders real state escaped and hides derived placeholders", () => {
  const claimed = { id: "w", kind: "work", label: "W", attributes: { state: "claimed" }, provenance: "authoritative" } as GraphNode;
  const obs = buildInspectorObservation(claimed);
  assert.match(obs.stateRowHtml, /status-ok[^>]*>claimed/);
  assert.match(obs.provenanceHtml, /authoritative/);
  assert.ok(!/project:/.test(obs.provenanceHtml));

  const injected = { id: "w", kind: "work", label: "W", attributes: { state: "<script>alert(1)</script>" } } as GraphNode;
  const inj = buildInspectorObservation(injected);
  assert.ok(!inj.stateRowHtml.includes("<script>"), "state must be escaped");
  assert.ok(inj.stateRowHtml.includes("&lt;script&gt;"));

  const missing = { id: "w", kind: "work", label: "W", attributes: { missing: true, state: "claimed" }, provenance: "derived" } as GraphNode;
  const miss = buildInspectorObservation(missing);
  assert.match(miss.stateRowHtml, /Not observed/);
  assert.ok(!/status-ok/.test(miss.stateRowHtml));
});

test("static honesty scan: theater view + built client bundle contain no hardcoded Observed or synthetic project provenance", () => {
  const frame = createTheaterFrame({ scope: { projectId: "proj-honesty", kind: "work" }, graph: makeSnapshot("work"), events: [] });
  const html = renderTheaterViewHtml({ sessionToken: "s", nonce: "n", initialFrame: frame });
  assert.ok(!/>\s*Observed\s*</.test(html), "theater HTML must not hardcode an Observed status");
  assert.ok(!/project:\$\{/.test(html), "no synthetic project provenance interpolation");

  const here = dirname(fileURLToPath(import.meta.url));
  const bundle = readFileSync(join(here, "..", "dist", "theater-client.bundle.js"), "utf8");
  assert.ok(!/>\s*Observed\s*</.test(bundle), "client bundle must not hardcode an Observed status");
  assert.ok(!bundle.includes("project:${"), "client bundle must not synthesise project provenance");
});

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

test("portal /api/graph/events and theater3d frame forward degraded and never re-leak raw secrets", async () => {
  const secretEvent = {
    projectId: "proj-secret",
    sequence: "7",
    eventId: "ev-secret-7",
    eventType: "WorkItemCreated",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: { kind: "system", name: "runner" },
    payload: {
      workItemId: "wi-keep-me",
      token: "NEVER_PORTAL_TOKEN_9Z",
      files: [{ path: "/home/u/.aws/credentials" }],
      note: "rotate ghp_ABCDEFGHIJKLMNOPQRST1234 next",
      log: "handshake bearer: P0RTALSECRET42 failed",
    },
  };
  const graphEventsCalls: Array<{ kind?: string }> = [];
  const reader = {
    graphSnapshot: async () => makeSnapshot("work"),
    graphEvents: async (input: { kind?: string }) => {
      graphEventsCalls.push({ kind: input.kind });
      return {
        events: [structuredClone(secretEvent)],
        throughSequence: "7",
        hasMore: false,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        degraded: {
          provider: "graph-events",
          reason: input.kind === undefined ? "kind omitted: returning the full project event stream" : "code events require worktreeId",
        },
      };
    },
  };

  const portal = await createPortalServer({ reader, projectId: "proj-secret" });
  try {
    const base = new URL(portal.url);
    const apiHeaders = { "x-my-pi-session": portal.token, origin: base.origin };
    const leaks = ["NEVER_PORTAL_TOKEN_9Z", "ghp_ABCDEFGHIJKLMNOPQRST1234", "P0RTALSECRET42", ".aws", "credentials"];

    const liveRes = await fetch(`${base.origin}/api/graph/events`, { headers: apiHeaders });
    assert.equal(liveRes.status, 200);
    const liveText = await liveRes.text();
    const liveData = JSON.parse(liveText);
    assert.match(liveData.degraded.reason, /kind omitted: returning the full project event stream/);
    assert.equal(liveData.kind, undefined);
    assert.ok(liveText.includes("[REDACTED]"));
    assert.ok(liveText.includes("[PATH:REDACTED]"));
    assert.ok(liveText.includes("[REDACTED:SECRET]"));
    assert.equal(liveData.events[0].payload.workItemId, "wi-keep-me");
    assert.equal(liveData.events[0].sequence, "7");
    for (const leak of leaks) assert.ok(!liveText.includes(leak), `events wire must not contain ${leak}`);

    const scopedRes = await fetch(`${base.origin}/api/graph/events?kind=work`, { headers: apiHeaders });
    assert.equal(scopedRes.status, 200);
    const scopedText = await scopedRes.text();
    const scopedData = JSON.parse(scopedText);
    assert.equal(scopedData.kind, "work");
    for (const leak of leaks) assert.ok(!scopedText.includes(leak), `scoped events wire must not contain ${leak}`);

    const badKindRes = await fetch(`${base.origin}/api/graph/events?kind=not-a-kind`, { headers: apiHeaders });
    assert.equal(badKindRes.status, 400);
    const badKindBody = await badKindRes.json();
    assert.match(badKindBody.error, /kind is invalid/);
    const badReplayRes = await fetch(`${base.origin}/api/graph/replay?kind=not-a-kind`, { headers: apiHeaders });
    assert.equal(badReplayRes.status, 400);

    const replayRes = await fetch(`${base.origin}/api/graph/replay?fromSequence=1&toSequence=7`, { headers: apiHeaders });
    assert.equal(replayRes.status, 200);
    const replayText = await replayRes.text();
    assert.ok(replayText.includes("[REDACTED]"));
    assert.ok(replayText.includes("[PATH:REDACTED]"));
    for (const leak of leaks) assert.ok(!replayText.includes(leak), `replay wire must not contain ${leak}`);

    const theaterPage = await fetch(`${portal.url}&view=theater3d`, { headers: { origin: base.origin } });
    assert.equal(theaterPage.status, 200);
    const theaterHtml = await theaterPage.text();
    assert.ok(theaterHtml.includes("[PATH:REDACTED]"), "theater frame must not embed raw sensitive paths");
    assert.ok(theaterHtml.includes("Events degraded:"), "theater quality reasons must forward the degraded provider reason");
    assert.ok(theaterHtml.includes("require worktreeId"), "theater quality reasons must carry the degraded reason text");
    const htmlLeaks = leaks.filter((leak) => leak !== "credentials");
    for (const leak of htmlLeaks) assert.ok(!theaterHtml.includes(leak), `theater html must not contain ${leak}`);

    const kinds = graphEventsCalls.map((call) => call.kind);
    assert.ok(kinds.includes(undefined), "absent kind query must be omitted");
    assert.ok(kinds.includes("work"), "present valid kind query must be forwarded");
    assert.ok(!kinds.includes("not-a-kind"), "invalid kind must be rejected before reaching the reader");
  } finally {
    await portal.close();
  }
});

test("portal /api/graph/events and theater3d frame leak zero free-text sensitive paths (reason/note/actor.id/actor.name)", async () => {
  const pathishEvent = {
    projectId: "proj-pathtext",
    sequence: "3",
    eventId: "ev-path-3",
    eventType: "WorkItemCreated",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: { kind: "agent_session", id: "svc/zeta9/aws/credentials", name: "read /home/zeta9/.ssh/id_zkey" },
    payload: {
      workItemId: "wi-pathtext-keep",
      reason: "read /home/zeta9/.ssh/id_zkey",
      note: "loaded /deploy/.env.zeta9",
      windows: "C:/Users/x/.aws/credentials",
      windowsBackslash: "C:\\Users\\x\\.aws\\credentials",
    },
  };
  const reader = {
    graphSnapshot: async () => makeSnapshot("work"),
    graphEvents: async () => ({
      events: [structuredClone(pathishEvent)],
      throughSequence: "3",
      hasMore: false,
    }),
  };
  const portal = await createPortalServer({ reader, projectId: "proj-pathtext" });
  try {
    const base = new URL(portal.url);
    const apiHeaders = { "x-my-pi-session": portal.token, origin: base.origin };
    const leaks = ["zeta9", "id_zkey", "/.ssh", "\\.ssh", "/.aws", "\\.aws", ".env.zeta9"];

    const liveRes = await fetch(`${base.origin}/api/graph/events`, { headers: apiHeaders });
    assert.equal(liveRes.status, 200);
    const liveText = await liveRes.text();
    assert.ok(liveText.includes("[PATH:REDACTED]"), "events wire must carry the PATH mask");
    for (const leak of leaks) assert.ok(!liveText.includes(leak), `events wire must not contain ${leak}`);
    const liveData = JSON.parse(liveText);
    assert.equal(liveData.events[0].payload.reason, "[PATH:REDACTED]");
    assert.equal(liveData.events[0].payload.note, "[PATH:REDACTED]");
    assert.equal(liveData.events[0].payload.windows, "[PATH:REDACTED]");
    assert.equal(liveData.events[0].payload.windowsBackslash, "[PATH:REDACTED]");
    assert.equal(liveData.events[0].actor.id, "[PATH:REDACTED]");
    assert.equal(liveData.events[0].actor.name, "[PATH:REDACTED]");
    assert.equal(liveData.events[0].payload.workItemId, "wi-pathtext-keep");
    assert.equal(liveData.events[0].eventId, "ev-path-3");
    assert.equal(liveData.events[0].sequence, "3");

    const replayRes = await fetch(`${base.origin}/api/graph/replay?fromSequence=1&toSequence=3`, { headers: apiHeaders });
    assert.equal(replayRes.status, 200);
    const replayText = await replayRes.text();
    assert.ok(replayText.includes("[PATH:REDACTED]"), "replay wire must carry the PATH mask");
    for (const leak of leaks) assert.ok(!replayText.includes(leak), `replay wire must not contain ${leak}`);

    const theaterPage = await fetch(`${portal.url}&view=theater3d`, { headers: { origin: base.origin } });
    assert.equal(theaterPage.status, 200);
    const theaterHtml = await theaterPage.text();
    assert.ok(theaterHtml.includes("[PATH:REDACTED]"), "theater frame must carry the PATH mask");
    for (const leak of leaks) assert.ok(!theaterHtml.includes(leak), `theater html must not contain ${leak}`);
  } finally {
    await portal.close();
  }
});

test("portal streams live events over SSE and enforces the session token", async () => {
  const liveEvent = {
    projectId: "proj-sse",
    sequence: "1",
    eventId: "ev-sse-1",
    eventType: "WorkItemCreated",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: { kind: "system", name: "runner" },
    payload: { workItemId: "wi-sse-1" },
  };
  const reader = {
    graphSnapshot: async () => makeSnapshot("work"),
    graphEvents: async (input: { afterSequence?: string }) => {
      const after = Number(input.afterSequence ?? "0");
      const events = after < 1 ? [structuredClone(liveEvent)] : [];
      return {
        events,
        throughSequence: events.at(-1)?.sequence ?? String(after),
        hasMore: false,
        mode: "live",
        kind: "work",
      };
    },
  };
  const portal = await createPortalServer({ reader, projectId: "proj-sse" });
  try {
    const base = new URL(portal.url);

    const denied = await fetch(`${base.origin}/api/graph/stream?kind=work&afterSequence=0`, {
      headers: { origin: base.origin },
    });
    assert.equal(denied.status, 403);

    const controller = new AbortController();
    const res = await fetch(`${base.origin}/api/graph/stream?kind=work&afterSequence=0&session=${portal.token}`, {
      headers: { origin: base.origin },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

    const body = res.body!;
    const streamReader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!buffer.includes("data:")) {
      const { value, done } = await streamReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    controller.abort();

    assert.ok(buffer.includes("data:"), "SSE stream must emit a data frame");
    assert.ok(buffer.includes("ev-sse-1"), "SSE data frame must carry the live event");
  } finally {
    await portal.close();
  }
});
