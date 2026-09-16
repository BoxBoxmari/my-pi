import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayoutPositions, layoutRadius } from "../dist/theater-layout.js";

function node(id, kind) {
  return { id, kind, label: id };
}

test("layout is deterministic for the same input and order", () => {
  const nodes = [node("a", "work"), node("b", "agent_session"), node("c", "intent"), node("d", "file")];
  const first = computeLayoutPositions(nodes);
  const second = computeLayoutPositions(nodes);
  assert.deepEqual([...first.entries()], [...second.entries()]);
});

test("layout assigns exactly one finite position per node, including empty input", () => {
  assert.equal(computeLayoutPositions([]).size, 0);
  const nodes = [node("a", "work"), node("b", "agent_session"), node("c", "intent"), node("d", "custom")];
  const positions = computeLayoutPositions(nodes);
  assert.equal(positions.size, nodes.length);
  for (const pos of positions.values()) {
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), "no NaN positions");
  }
});

test("layout radii stay bounded for expected graph sizes", () => {
  const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`, i % 3 === 0 ? "agent_session" : "work"));
  const radius = layoutRadius(computeLayoutPositions(nodes));
  assert.ok(radius > 0 && radius < 5000, `radius ${radius} out of bounds`);
});

test("node kinds occupy distinct elevation bands", () => {
  const positions = computeLayoutPositions([node("a", "agent_session"), node("w", "work"), node("i", "intent")]);
  assert.equal(positions.get("a").y, 22);
  assert.equal(positions.get("w").y, 4);
  assert.equal(positions.get("i").y, 12);
});
