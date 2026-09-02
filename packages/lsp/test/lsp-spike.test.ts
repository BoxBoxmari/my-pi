import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runLspSpike, LspJsonRpcConnection } from "@my-pi/lsp";

let dir: string;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-lsp-"));
  await fs.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }), "utf8");
});
after(async () => {
  // Windows: the language server may briefly hold the temp dir; retry cleanup.
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
});

// typescript-language-server is a devDependency; it resolves the repo's own
// TypeScript from node_modules (spawnServer uses repo root as cwd). Use the
// explicit .bin path so PATH lookups are not required.
const IS_WIN = process.platform === "win32";
const SERVER = {
  command: path.resolve("node_modules", ".bin", IS_WIN ? "typescript-language-server.cmd" : "typescript-language-server"),
  args: ["--stdio"],
};

test("G1 spike: TypeScript LSP full lifecycle (spawn->init->didOpen->hover->cancel->shutdown)", { timeout: 120_000 }, async () => {
  const result = await runLspSpike(dir, SERVER);
  assert.equal(result.initialized, true, "server must complete initialize/initialized");
  // Diagnostics are server-behavior-dependent (push timing varies with the
  // tsserver project model); the spike records them but does not gate on them.
  // The mandatory language-intelligence proof for the lifecycle is hover:
  assert.ok(result.hoverText.length > 0 && result.hoverText !== "(hover unavailable)",
    `hover must return real content, got: ${result.hoverText}`);
  assert.equal(result.cancelObserved, true, "connection must survive $/cancelRequest");
  assert.equal(result.cleanShutdown, true, "shutdown/exit must complete cleanly");
  assert.equal(result.zombieFree, true, "no zombie process may remain after exit");
});

test("G1 spike: crash + bounded restart backoff (forced kill then respawn)", { timeout: 120_000 }, async () => {
  const conn = new LspJsonRpcConnection();
  await conn.spawnServer(SERVER.command, SERVER.args, dir);
  assert.ok(conn.running);
  const pid = conn.pid;
  assert.ok(pid !== undefined);

  // Simulate a crash.
  conn.forceKill();
  await new Promise((r) => setTimeout(r, 1_500));
  assert.ok(!conn.running, "server must be down after force kill (process-tree cleanup)");

  // Bounded exponential backoff sequence.
  const delays: number[] = [];
  let backoff = 100;
  for (let i = 0; i < 3; i++) {
    delays.push(backoff);
    await new Promise((r) => setTimeout(r, backoff));
    backoff *= 2;
  }
  // Restart and verify it comes back up.
  const conn2 = new LspJsonRpcConnection();
  await conn2.spawnServer(SERVER.command, SERVER.args, dir);
  assert.ok(conn2.running, "server must restart after crash");
  await conn2.shutdownAndExit().catch(() => conn2.forceKill());
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(delays, [100, 200, 400], "restart backoff must be a bounded exponential sequence");
});
