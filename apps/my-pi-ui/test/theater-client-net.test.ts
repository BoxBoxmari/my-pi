import assert from "node:assert/strict";
import { test } from "node:test";
import {
  THEATER_CURSOR_KEY,
  buildGraphUrl,
  buildStreamUrl,
  parseStreamPayload,
  persistCursor,
  restorePersistedCursor,
  sessionHeaders,
} from "../dist/theater-client-net.js";

test("transport URLs and headers are constructed in one place", () => {
  assert.equal(buildStreamUrl("/api", "code", "42", "tok"), "/api/stream?kind=code&afterSequence=42&session=tok");
  assert.equal(buildGraphUrl("/api", "impact"), "/api?kind=impact");
  assert.deepEqual(sessionHeaders("tok"), { "x-my-pi-session": "tok" });
  assert.ok(buildStreamUrl("/api", "a b", "1&2", "t=1").includes(encodeURIComponent("a b")));
});

test("SSE payloads are validated before reaching state", () => {
  const good = parseStreamPayload({ events: [{ eventType: "X" }], throughSequence: "7" });
  assert.equal(good.events.length, 1);
  assert.equal(good.throughSequence, "7");
  assert.equal(parseStreamPayload({ events: [], throughSequence: "7" }), undefined);
  assert.equal(parseStreamPayload({ error: "boom", events: [{}] }), undefined);
  assert.equal(parseStreamPayload("nope"), undefined);
  assert.equal(parseStreamPayload(null), undefined);
  assert.deepEqual(parseStreamPayload({ events: [{ eventType: "X" }] }), { events: [{ eventType: "X" }] });
});

test("cursor persistence only moves forward", () => {
  const backing = new Map();
  const storage = { getItem: (k) => backing.get(k) ?? null, setItem: (k, v) => { backing.set(k, v); } };
  assert.equal(restorePersistedCursor(storage, "10"), undefined);
  persistCursor(storage, "12");
  assert.equal(backing.get(THEATER_CURSOR_KEY), "12");
  assert.equal(restorePersistedCursor(storage, "10"), "12");
  assert.equal(restorePersistedCursor(storage, "12"), undefined);
  assert.equal(restorePersistedCursor(storage, "99"), undefined);
  persistCursor(storage, undefined);
});
