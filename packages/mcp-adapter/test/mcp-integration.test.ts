import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
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

// ============ P0 REGRESSION TESTS ============

test("P0.8: fs_write creates a new file without expected_hash", async () => {
  const res = await client.callTool({
    name: "fs_write",
    arguments: { path: "created.txt", content: "fresh" },
  });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.data.path, "created.txt");
  assert.ok(parsed.data.content_hash.startsWith("sha256:"));
});

test("P0.8: fs_write on EXISTING file WITHOUT expected_hash is rejected", async () => {
  const res = await client.callTool({
    name: "fs_write",
    arguments: { path: "a.txt", content: "silent lost update" },
  });
  assert.equal(res.isError, true);
  const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
  assert.match(errText, /expected_hash/i);
  // file unchanged
  const back = await client.callTool({ name: "fs_read", arguments: { path: "a.txt" } });
  const read = JSON.parse((back.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(read.data.content, "hello ccr");
});

test("P0.8: fs_write with correct expected_hash passes", async () => {
  const read1 = await client.callTool({ name: "fs_read", arguments: { path: "a.txt" } });
  const hash = JSON.parse((read1.content as Array<{ text?: string }>)[0]!.text!).data.content_hash;
  const res = await client.callTool({
    name: "fs_write",
    arguments: { path: "a.txt", content: "updated via cas", expected_hash: hash },
  });
  assert.notEqual(res.isError, true);
  const back = await client.callTool({ name: "fs_read", arguments: { path: "a.txt" } });
  assert.equal(JSON.parse((back.content as Array<{ text?: string }>)[0]!.text!).data.content, "updated via cas");
});

test("P0.8: fs_write with stale expected_hash is rejected", async () => {
  const stale = "sha256:" + "0".repeat(64);
  const res = await client.callTool({
    name: "fs_write",
    arguments: { path: "a.txt", content: "nope", expected_hash: stale },
  });
  assert.equal(res.isError, true);
});

test("P0.7: fs_read decodes UTF-16 LE BOM text (not classified binary)", async () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("utf16 text", "utf16le")]);
  await fs.writeFile(path.join(dir, "u16le.txt"), buf);
  const res = await client.callTool({ name: "fs_read", arguments: { path: "u16le.txt" } });
  assert.notEqual(res.isError, true);
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.data.content, "utf16 text");
  assert.equal(parsed.data.encoding, "utf-16le-bom");
});

test("P0.7: fs_read decodes UTF-16 BE BOM text", async () => {
  const text = "utf16be ok";
  const be = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    be.writeUInt16BE(code, i * 2);
  }
  const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
  await fs.writeFile(path.join(dir, "u16be.txt"), buf);
  const res = await client.callTool({ name: "fs_read", arguments: { path: "u16be.txt" } });
  assert.notEqual(res.isError, true);
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.data.content, "utf16be ok");
  assert.equal(parsed.data.encoding, "utf-16be-bom");
});

test("P0.7: binary fixture is still typed ERR_BINARY_FILE", async () => {
  const bin = Buffer.alloc(512, 0);
  await fs.writeFile(path.join(dir, "blob.bin"), bin);
  const res = await client.callTool({ name: "fs_read", arguments: { path: "blob.bin" } });
  assert.equal(res.isError, true);
  const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
  assert.match(errText, /binary/i);
});

test("P0.2/P0.3: search scoped to subdir stays in that subdir", async () => {
  await fs.mkdir(path.join(dir, "services"), { recursive: true });
  await fs.mkdir(path.join(dir, "other"), { recursive: true });
  await fs.writeFile(path.join(dir, "services", "svc.ts"), "export const TOKEN = 'svc'");
  await fs.writeFile(path.join(dir, "other", "oth.ts"), "export const TOKEN = 'other'");
  const res = await client.callTool({ name: "search", arguments: { mode: "grep", pattern: "TOKEN", path: "services" } });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  const paths = parsed.data.matches.map((m: { path: string }) => m.path);
  // Scope is the search root: matches are relative TO that scope, and the
  // sibling directory must contribute zero matches.
  assert.equal(parsed.data.totalCount, 1);
  assert.ok(paths.includes("svc.ts"));
  assert.ok(!paths.some((p: string) => p.includes("other")));
});

test("P0.2: search never returns sensitive matches (and does not read them)", async () => {
  const res = await client.callTool({ name: "search", arguments: { mode: "grep", pattern: "SECRET" } });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.data.matches.length, 0);
});

test("P0.3: search scoped to a FILE returns typed invalid-scope error", async () => {
  const res = await client.callTool({ name: "search", arguments: { mode: "grep", pattern: "x", path: "a.txt" } });
  assert.equal(res.isError, true);
  const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
  assert.match(errText, /file, not a directory/i);
});

test("P0.1: vcs_status on a non-Git workspace returns typed error, NOT fake data", async () => {
  const res = await client.callTool({ name: "vcs_status", arguments: {} });
  assert.equal(res.isError, true);
  const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
  assert.match(errText, /not a Git repository/i);
});
