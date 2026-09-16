import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFilterOptions,
  cursorText,
  deriveQualityFlags,
  filterVisibleNodes,
  freshnessText,
  kindColorHex,
  kindFillCss,
  truncateLabel,
} from "../dist/theater-view-model.js";

function node(id, kind) {
  return { id, kind, label: id };
}

test("kind colors resolve with a token fallback", () => {
  assert.equal(kindColorHex("work"), 0x00b8f5);
  assert.equal(kindColorHex("unknown-kind"), 0x00b8f5);
  assert.equal(kindFillCss("file"), "#00338d");
  assert.equal(kindFillCss("unknown-kind"), "var(--kpmg-blue)");
});

test("filter and label helpers shape explicit view-model inputs", () => {
  const nodes = [node("a", "work"), node("b", "code"), node("c", "work")];
  assert.deepEqual(filterVisibleNodes(nodes, "").map((n) => n.id), ["a", "b", "c"]);
  assert.deepEqual(filterVisibleNodes(nodes, "work").map((n) => n.id), ["a", "c"]);
  assert.deepEqual(buildFilterOptions(nodes), ["code", "work"]);
  assert.equal(truncateLabel("x".repeat(40)).length, 32);
  assert.equal(truncateLabel("short"), "short");
});

test("quality/cursor/freshness derivation is DOM-free", () => {
  const flags = deriveQualityFlags({ degraded: true, truncated: false, stale: false, empty: false });
  assert.deepEqual(flags, { degraded: true, truncated: false, stale: false, empty: false });
  assert.equal(cursorText("42", "7"), "seq: 42");
  assert.equal(cursorText(undefined, "7"), "seq: 7");
  assert.equal(cursorText(undefined, undefined), "seq: 0");
  assert.equal(freshnessText(undefined), "just now");
  assert.ok(freshnessText(new Date().toISOString()).length > 0);
});
