import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let dir: string;
let client: Client;
let transport: StdioClientTransport;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-stdio-"));
  await fs.writeFile(path.join(dir, "a.txt"), "hello stdio");
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-strip-types", "apps/ccr-mcp/dist/main.js", "--workspace", dir],
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

test("G6 evid: workspace_info + fs_read over real stdio", async () => {
  const info = await client.callTool({ name: "workspace_info", arguments: {} });
  assert.equal(JSON.parse((info.content as Array<{ text?: string }>)[0]!.text!).data.root, path.resolve(dir));
  const read = await client.callTool({ name: "fs_read", arguments: { path: "a.txt" } });
  assert.equal(JSON.parse((read.content as Array<{ text?: string }>)[0]!.text!).data.content, "hello stdio");
});

test("G6 evid: fs_write + fs_patch over real stdio", async () => {
  await client.callTool({ name: "fs_write", arguments: { path: "b.txt", content: "one\ntwo\nthree\n" } });
  const patch = await client.callTool({
    name: "fs_patch",
    arguments: { path: "b.txt", patch: { hunks: [{ old: "two", new: "TWO" }] } },
  });
  assert.notEqual(patch.isError, true);
  const read = await client.callTool({ name: "fs_read", arguments: { path: "b.txt" } });
  assert.equal(JSON.parse((read.content as Array<{ text?: string }>)[0]!.text!).data.content, "one\nTWO\nthree\n");
});

test("G6 evid: secret path denied over real stdio", async () => {
  await fs.writeFile(path.join(dir, ".env"), "SECRET=1");
  const res = await client.callTool({ name: "fs_read", arguments: { path: ".env" } });
  assert.equal(res.isError, true);
});
