import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arrayParam,
  assertProject,
  graphBoundsParam,
  graphDepthParam,
  graphKindParam,
  objectParam,
  optionalString,
  requiredNumber,
  requiredString,
  requireTestMode,
  samePath,
  sequenceParam,
  actor,
} from "../dist/request-params.js";

test("requiredString accepts bounded non-empty strings only", () => {
  assert.equal(requiredString({ a: "x" }, "a"), "x");
  assert.throws(() => requiredString({}, "a"));
  assert.throws(() => requiredString({ a: "" }, "a"));
  assert.throws(() => requiredString({ a: 1 }, "a"));
  assert.throws(() => requiredString({ a: "x".repeat(1025) }, "a"));
});

test("optionalString passes through undefined", () => {
  assert.equal(optionalString({}, "a"), undefined);
  assert.equal(optionalString({ a: "x" }, "a"), "x");
  assert.throws(() => optionalString({ a: 1 }, "a"));
});

test("actor accepts the three known shapes", () => {
  assert.deepEqual(actor({ actor: { kind: "system", name: "n" } }), { kind: "system", name: "n" });
  assert.deepEqual(actor({ actor: { kind: "agent_session", id: "s" } }), { kind: "agent_session", id: "s" });
  assert.deepEqual(actor({ actor: { kind: "principal", id: "p" } }), { kind: "principal", id: "p" });
  assert.throws(() => actor({}));
  assert.throws(() => actor({ actor: { kind: "unknown" } }));
});

test("sequenceParam parses decimal strings to bigint", () => {
  assert.equal(sequenceParam(undefined), undefined);
  assert.equal(sequenceParam("42"), 42n);
  assert.throws(() => sequenceParam("4.2"));
  assert.throws(() => sequenceParam("-1"));
  assert.throws(() => sequenceParam(42));
});

test("requiredNumber/objectParam/arrayParam validate shapes", () => {
  assert.equal(requiredNumber({ n: 3 }, "n"), 3);
  assert.throws(() => requiredNumber({ n: 3.5 }, "n"));
  assert.deepEqual(objectParam({ o: { x: 1 } }, "o"), { x: 1 });
  assert.throws(() => objectParam({ o: [] }, "o"));
  assert.deepEqual(arrayParam({ a: [1] }, "a"), [1]);
  assert.throws(() => arrayParam({ a: "x" }, "a"));
});

test("assertProject rejects cross-project requests", () => {
  assert.doesNotThrow(() => assertProject({ projectId: "p1" }, "p1"));
  assert.throws(() => assertProject({ projectId: "p2" }, "p1"));
});

test("graph params validate kind/bounds/depth", () => {
  assert.equal(graphKindParam({ kind: "code" }), "code");
  assert.throws(() => graphKindParam({ kind: "nope" }));
  assert.deepEqual(graphBoundsParam({}), {});
  assert.deepEqual(graphBoundsParam({ maxNodes: 10 }), { maxNodes: 10 });
  assert.throws(() => graphBoundsParam({ maxNodes: 0 }));
  assert.throws(() => graphBoundsParam({ maxNodes: 10_001 }));
  assert.equal(graphDepthParam({}), 1);
  assert.equal(graphDepthParam({ depth: 3 }), 3);
  assert.throws(() => graphDepthParam({ depth: 9 }));
});

test("requireTestMode gates test-only operations", () => {
  assert.doesNotThrow(() => requireTestMode("op", true));
  assert.throws(() => requireTestMode("op", false));
});

test("samePath is platform-aware", () => {
  assert.equal(samePath("/a/b", "/a/b"), true);
  assert.equal(samePath("/a/b", "/a/c"), false);
});
