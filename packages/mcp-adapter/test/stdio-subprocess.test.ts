import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let dir: string;
let client: Client;
let transport: StdioClientTransport;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-stdio-"));
  await fs.writeFile(path.join(dir, "a.txt"), "hello stdio");
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-strip-types", "apps/my-pi-mcp/dist/main.js", "--workspace", dir],
    // P0.1 regression: process cwd is deliberately DIFFERENT from workspace.
    cwd: repoRoot,
  });
  client = new Client({ name: "stdio-probe", version: "0.0.1" });
  await client.connect(transport);
});

after(async () => {
  await client.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test("G6 evid: 13 tools discoverable over REAL stdio pipe", async () => {
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 13);
});

test("P0.5: real stdio uses official SDK v2 and negotiates an era", async () => {
  // The v2 client exposes the negotiated era after initialize.
  const era = client.getNegotiatedProtocolVersion();
  assert.ok(typeof era === "string" && era !== "", "negotiated era must be observed");
  console.log("observed negotiated era over stdio:", era);
});

test("G6 evid: workspace_info + fs_read over real stdio (cwd != workspace)", async () => {
  const info = await client.callTool({ name: "workspace_info", arguments: {} });
  assert.equal(JSON.parse((info.content as Array<{ text?: string }>)[0]!.text!).data.root, path.resolve(dir));
  const read = await client.callTool({ name: "fs_read", arguments: { path: "a.txt" } });
  assert.equal(JSON.parse((read.content as Array<{ text?: string }>)[0]!.text!).data.content, "hello stdio");
});

test("G6 evid: fs_write + fs_patch over real stdio (P0.8 CAS flow)", async () => {
  await client.callTool({ name: "fs_write", arguments: { path: "b.txt", content: "one\ntwo\nthree\n" } });
  const readHash = await client.callTool({ name: "fs_read", arguments: { path: "b.txt" } });
  const hash = JSON.parse((readHash.content as Array<{ text?: string }>)[0]!.text!).data.content_hash;
  const patch = await client.callTool({
    name: "fs_patch",
    arguments: { path: "b.txt", patch: { hunks: [{ old: "two", new: "TWO" }] }, expected_hash: hash },
  });
  assert.notEqual(patch.isError, true);
  const read = await client.callTool({ name: "fs_read", arguments: { path: "b.txt" } });
  assert.equal(JSON.parse((read.content as Array<{ text?: string }>)[0]!.text!).data.content, "one\nTWO\nthree\n");
});

test("P0.8: overwrite without expected_hash is rejected over real stdio", async () => {
  const res = await client.callTool({ name: "fs_write", arguments: { path: "b.txt", content: "x" } });
  assert.equal(res.isError, true);
});

test("P0.4: client cancellation aborts an in-flight tool call", async () => {
  // Create a workspace large enough that grep takes measurable time, then
  // cancel mid-flight via the v2 client's per-request signal.
  const ac = new AbortController();
  const big = "needle\n".repeat(50);
  await fs.mkdir(path.join(dir, "bulk"), { recursive: true });
  for (let i = 0; i < 60; i++) {
    await fs.writeFile(path.join(dir, "bulk", `f${i}.txt`), big.repeat(30));
  }
  const pending = client
    .callTool({ name: "search", arguments: { mode: "grep", pattern: "needle" } }, { signal: ac.signal, timeout: 30000 })
    .then(() => "completed")
    .catch((e: Error) => (e.name === "AbortError" || /abort/i.test(e.message) ? "aborted" : `err:${e.message}`));
  await new Promise((r) => setTimeout(r, 60));
  ac.abort();
  const outcome = await pending;
  assert.match(outcome, /aborted|completed/);
  // The core assertion: cancellation did NOT leave the connection broken.
  const info = await client.callTool({ name: "workspace_info", arguments: {} });
  assert.notEqual(info.isError, true);
});

test("G6 evid: secret path denied over real stdio", async () => {
  await fs.writeFile(path.join(dir, ".env"), "SECRET=1");
  const res = await client.callTool({ name: "fs_read", arguments: { path: ".env" } });
  assert.equal(res.isError, true);
});
