import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHunks, parsePatch } from "@ccr/hashline";
import type { CcrError } from "@ccr/contracts";

test("applyHunks applies exact anchors and leaves the rest intact", () => {
  const out = applyHunks("const a = 1;\nconst b = 2;\n", [
    { old: "a = 1", new: "a = 10" },
  ]);
  assert.equal(out, "const a = 10;\nconst b = 2;\n");
});

test("applyHunks applies multiple hunks sequentially", () => {
  const out = applyHunks("x\ny\nz\n", [
    { old: "x", new: "X" },
    { old: "z", new: "Z" },
  ]);
  assert.equal(out, "X\ny\nZ\n");
});

test("applyHunks rejects missing anchor", () => {
  assert.throws(
    () => applyHunks("abc", [{ old: "zzz", new: "y" }]),
    (e: unknown) => (e as CcrError).code === "ERR_PARSE_FAILED",
  );
});

test("applyHunks rejects ambiguous anchor", () => {
  assert.throws(
    () => applyHunks("aa\naa\n", [{ old: "aa", new: "b" }]),
    (e: unknown) => (e as CcrError).code === "ERR_AMBIGUOUS_ANCHOR",
  );
});

test("parsePatch validates shape", () => {
  const p = parsePatch({ hunks: [{ old: "a", new: "b" }] });
  assert.equal(p.hunks.length, 1);
  assert.throws(() => parsePatch({ hunks: "nope" }), (e: unknown) => (e as CcrError).code === "ERR_PARSE_FAILED");
  assert.throws(() => parsePatch({ hunks: [{ old: 1, new: "b" }] }), (e: unknown) => (e as CcrError).code === "ERR_PARSE_FAILED");
});
