import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WorkspaceRuntime } from "@ccr/workspace-runtime";
import { CcrServer, createFoundationCapabilities } from "@ccr/mcp-adapter";

let dir: string;
let runtime: WorkspaceRuntime;
let server: CcrServer;
let client: Client;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-mcp-"));
  await fs.writeFile(path.join(dir, "a.txt"), "hello ccr");
  await fs.writeFile(path.join(dir, ".env"), "SECRET=1");

  runtime = new WorkspaceRuntime();
  await runtime.open({ root: dir });
  server = new CcrServer({
    name: "ccr-test",
    version: "0.0.1",
    runtime,
    capabilities: createFoundationCapabilities(runtime),
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "ccr-test-client", version: "0.0.1" });
  await client.connect(clientTransport);
});

after(async () => {
  await client.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test("G1: 13-tool surface is discoverable", async () => {
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  const expected = [
    "ast_search", "fs_patch", "fs_read", "fs_stat", "fs_write",
    "lsp_diagnostics", "lsp_navigate", "lsp_status", "lsp_symbols",
    "search", "vcs_diff", "vcs_status", "workspace_info",
  ];
  assert.deepEqual(names, [...expected].sort());
  assert.equal(names.length, 13);
});

test("G1: workspace_info returns normalized root", async () => {
  const res = await client.callTool({ name: "workspace_info", arguments: {} });
  const text = (res.content as Array<{ type: string; text?: string }>)[0]!.text!;
  const parsed = JSON.parse(text);
  assert.equal(parsed.data.root, path.resolve(dir));
  assert.equal(parsed.data.revision, 0);
  assert.equal(parsed.schemaVersion, "1");
});

test("G1: fs_read returns content + fingerprint snapshot", async () => {
  const res = await client.callTool({ name: "fs_read", arguments: { path: "a.txt" } });
  const text = (res.content as Array<{ type: string; text?: string }>)[0]!.text!;
  const parsed = JSON.parse(text);
  assert.equal(parsed.data.content, "hello ccr");
  assert.ok(parsed.data.content_hash.startsWith("sha256:"));
  assert.ok(parsed.data.snapshot_id);
  assert.ok(parsed.data.anchor);
});

test("G1: fs_stat returns metadata", async () => {
  const res = await client.callTool({ name: "fs_stat", arguments: { path: "a.txt" } });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.data.isFile, true);
  assert.equal(parsed.data.size, 9);
});

test("G1: sensitive path is denied end-to-end", async () => {
  const res = await client.callTool({ name: "fs_read", arguments: { path: ".env" } });
  assert.equal(res.isError, true);
  const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
  assert.match(errText, /sensitive path denied/i);
});

test("G1: unimplemented tool returns typed unsupported error", async () => {
  const res = await client.callTool({ name: "ast_search", arguments: { pattern: "x", paths: ["src"] } });
  assert.equal(res.isError, true);
  const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
  assert.match(errText, /not implemented in the G1 foundation/);
});

test("G3: fs_write creates/overwrites a single file atomically", async () => {
  const res = await client.callTool({
    name: "fs_write",
    arguments: { path: "new.txt", content: "fresh content" },
  });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.data.path, "new.txt");
  assert.ok(parsed.data.content_hash.startsWith("sha256:"));
  const back = await client.callTool({ name: "fs_read", arguments: { path: "new.txt" } });
  const read = JSON.parse((back.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(read.data.content, "fresh content");
});

test("G3: fs_patch applies a hashline-style single-file patch", async () => {
  const res = await client.callTool({
    name: "fs_patch",
    arguments: { path: "a.txt", patch: { hunks: [{ old: "hello", new: "HELLO" }] } },
  });
  assert.notEqual(res.isError, true);
  const back = await client.callTool({ name: "fs_read", arguments: { path: "a.txt" } });
  const read = JSON.parse((back.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(read.data.content, "HELLO ccr");
});

test("G3: fs_patch rejects a stale expected_hash", async () => {
  const stale = "sha256:" + "0".repeat(64);
  const res = await client.callTool({
    name: "fs_patch",
    arguments: { path: "a.txt", patch: { hunks: [{ old: "ccr", new: "runtime" }] }, expected_hash: stale },
  });
  assert.equal(res.isError, true);
  const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
  assert.match(errText, /stale patch/i);
});

test("G2: search grep returns matches with degraded backend metadata", async () => {
  const res = await client.callTool({ name: "search", arguments: { mode: "grep", pattern: "fresh" } });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.backend, "node-fallback");
  assert.equal(parsed.degraded, true);
  assert.ok(parsed.data.matches.some((m: { path: string }) => m.path === "new.txt"));
});

test("G2: search glob finds files by pattern", async () => {
  const res = await client.callTool({ name: "search", arguments: { mode: "glob", pattern: "*.txt" } });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  const paths = parsed.data.matches.map((m: { path: string }) => m.path);
  assert.ok(paths.includes("a.txt"));
  assert.ok(paths.includes("new.txt"));
});

test("G2: search denies sensitive path results", async () => {
  const res = await client.callTool({ name: "search", arguments: { mode: "grep", pattern: "SECRET" } });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.data.matches.length, 0);
});
