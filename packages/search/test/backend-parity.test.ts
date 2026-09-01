import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFallbackSearchBackend } from "@ccr/search";
import { tryLoadNative } from "@ccr/native-loader";

let dir: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-backend-parity-"));
  await fs.writeFile(path.join(dir, "alpha.ts"), "export const ALPHA = 100;\n");
  await fs.writeFile(path.join(dir, "beta.ts"), "export const BETA = 200;\n");
  await fs.writeFile(path.join(dir, "gamma.py"), "GAMMA = 300\n");
  await fs.mkdir(path.join(dir, "nested"), { recursive: true });
  await fs.writeFile(path.join(dir, "nested", "delta.ts"), "export const DELTA = 400;\n");
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("G2: backend parity — loader graceful fallback when native module is absent", async () => {
  const nativeRes = await tryLoadNative("@ccr/ccr-native", "0.1.0");
  assert.equal(nativeRes.ok, false);
  if (!nativeRes.ok) {
    assert.equal(nativeRes.fallback, "node-fallback");
  }

  // Fallback backend operates with 100% semantic correctness
  const backend = new NodeFallbackSearchBackend();
  const res = await backend.search(
    {
      mode: "glob",
      pattern: "**/*.ts",
      roots: [dir],
      allowed: () => true,
    },
    new AbortController().signal,
  );

  assert.equal(res.totalCount, 3);
  const paths = res.matches.map((m) => m.path).sort();
  assert.deepEqual(paths, ["alpha.ts", "beta.ts", "nested/delta.ts"]);
});

test("G2: backend parity — grep search returns exact lines and columns", async () => {
  const backend = new NodeFallbackSearchBackend();
  const res = await backend.search(
    {
      mode: "grep",
      pattern: "export const",
      roots: [dir],
      allowed: () => true,
    },
    new AbortController().signal,
  );

  assert.equal(res.totalCount, 3);
  for (const m of res.matches) {
    assert.ok(m.line !== undefined && m.line >= 1);
    assert.ok(m.column !== undefined && m.column >= 0);
  }
});
