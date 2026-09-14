import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { MyPiServer, createFoundationCapabilities } from "@my-pi/mcp-adapter";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

let dir: string;
let runtime: WorkspaceRuntime;

before(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-theater-mcp-")));
  runtime = new WorkspaceRuntime();
  await runtime.open({ root: dir, policy: { mode: "workspace-read" }, capabilities: { read: true } });
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("MCP Apps theater visual is an opt-in resource ui://my-pi/theater and preserves the exact 13-tool catalog", async () => {
  const theaterServer = new MyPiServer({
    name: "my-pi-theater-test",
    version: "0.0.1",
    runtime,
    capabilities: createFoundationCapabilities(runtime),
    visuals: {
      enabled: true,
      readHtml: () => "<html>2D graph</html>",
      readTheaterHtml: () => "<html>3D Operations Theater</html>",
    },
  });

  assert.equal(theaterServer.visualsStatus, "registered");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await theaterServer.connect(serverTransport);
  const client = new Client({ name: "my-pi-theater-client", version: "0.0.1" });
  await client.connect(clientTransport);

  try {
    // 1. Tool catalog invariant: exactly 13 legacy tools
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 13);
    const toolNames = tools.tools.map((t) => t.name).sort();
    const expected = [
      "ast_search", "fs_patch", "fs_read", "fs_stat", "fs_write",
      "lsp_diagnostics", "lsp_navigate", "lsp_status", "lsp_symbols",
      "search", "vcs_diff", "vcs_status", "workspace_info",
    ].sort();
    assert.deepEqual(toolNames, expected);

    // 2. Resources: both ui://my-pi/graph and ui://my-pi/theater are registered
    const resources = await client.listResources();
    assert.ok(resources.resources.some((r) => r.uri === "ui://my-pi/graph"));
    assert.ok(resources.resources.some((r) => r.uri === "ui://my-pi/theater"));

    // 3. Read theater resource
    const theaterRes = await client.readResource({ uri: "ui://my-pi/theater" });
    assert.equal(theaterRes.contents[0]?.mimeType, RESOURCE_MIME_TYPE);
    assert.match(String(theaterRes.contents[0]?.text), /3D Operations Theater/);
  } finally {
    await client.close();
  }
});
