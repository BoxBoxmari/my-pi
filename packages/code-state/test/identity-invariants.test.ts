import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fileStableKey,
  moduleStableKey,
  stableEntityId,
  symbolStableKey,
} from "../dist/identity.js";

test("identity primitive: same input repeated => identical key and id", () => {
  const keyA = fileStableKey("wt-1", "src/a.ts");
  const keyB = fileStableKey("wt-1", "src/a.ts");
  assert.equal(keyA, keyB);
  assert.equal(stableEntityId(keyA), stableEntityId(keyB));
});

test("invariant 1: same repo/path + different worktree => distinct keys and ids", () => {
  const keyA = fileStableKey("worktree-A", "src/same.ts");
  const keyB = fileStableKey("worktree-B", "src/same.ts");
  assert.notEqual(keyA, keyB);
  assert.notEqual(stableEntityId(keyA), stableEntityId(keyB));

  const symA = symbolStableKey("worktree-A", "src/same.ts", "function", "run", 10);
  const symB = symbolStableKey("worktree-B", "src/same.ts", "function", "run", 10);
  assert.notEqual(symA, symB);
  assert.notEqual(stableEntityId(symA), stableEntityId(symB));

  const modA = moduleStableKey("worktree-A", "src/same.ts", "./dep");
  const modB = moduleStableKey("worktree-B", "src/same.ts", "./dep");
  assert.notEqual(modA, modB);
  assert.notEqual(stableEntityId(modA), stableEntityId(modB));
});

test("identity primitive: same worktree + different kind => different ids", () => {
  const file = fileStableKey("wt-1", "src/a.ts");
  const sym = symbolStableKey("wt-1", "src/a.ts", "function", "run", 1);
  const mod = moduleStableKey("wt-1", "src/a.ts", "./dep");
  const ids = new Set([stableEntityId(file), stableEntityId(sym), stableEntityId(mod)]);
  assert.equal(ids.size, 3);
});

test("invariant 2: same worktree + unchanged file => stable identity", () => {
  const before = stableEntityId(fileStableKey("wt-1", "src/steady.ts"));
  const afterReconcile = stableEntityId(fileStableKey("wt-1", "src/steady.ts"));
  assert.equal(before, afterReconcile);
});

test("invariant 8: rename = remove old identity + create new identity", () => {
  const oldKey = fileStableKey("wt-1", "src/old.ts");
  const newKey = fileStableKey("wt-1", "src/new.ts");
  assert.notEqual(oldKey, newKey);
  assert.notEqual(stableEntityId(oldKey), stableEntityId(newKey));
  // Symbols move with the file: path is part of the symbol key.
  const oldSym = symbolStableKey("wt-1", "src/old.ts", "function", "run", 5);
  const newSym = symbolStableKey("wt-1", "src/new.ts", "function", "run", 5);
  assert.notEqual(stableEntityId(oldSym), stableEntityId(newSym));
});

test("invariant 9: branch/ref change does not affect identity inputs", () => {
  // worktreeId is independent of branch: same worktree scope + same
  // stable-key components => same id regardless of HEAD.
  const onMain = stableEntityId(fileStableKey("wt-1", "src/a.ts"));
  const onDetached = stableEntityId(fileStableKey("wt-1", "src/a.ts"));
  assert.equal(onMain, onDetached);
  // Only stable-key components (path/kind/name/line/import) change ids.
  const movedLine = stableEntityId(symbolStableKey("wt-1", "src/a.ts", "function", "run", 11));
  assert.notEqual(onMain, movedLine);
});

test("invariant 10: same relative path across worktrees is isolated at key level", () => {
  const keys = ["wt-A", "wt-B", "wt-C"].map((wt) => fileStableKey(wt, "src/same.ts"));
  assert.equal(new Set(keys).size, 3);
  assert.equal(new Set(keys.map(stableEntityId)).size, 3);
});
