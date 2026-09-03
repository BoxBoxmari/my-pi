import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { MyPiServer, createFoundationCapabilities } from "@my-pi/mcp-adapter";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";

test("default workspace security profile is read-only and disables LSP", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-readonly-profile-"));
  const runtime = new WorkspaceRuntime();
  await runtime.open({ root: dir });
  const server = new MyPiServer({ runtime, capabilities: createFoundationCapabilities(runtime) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "readonly-profile-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const write = await client.callTool({ name: "fs_write", arguments: { path: "blocked.txt", content: "blocked" } });
    assert.equal(write.isError, true);
    const lsp = await client.callTool({ name: "lsp_status", arguments: {} });
    assert.equal(lsp.isError, true);
    const info = await client.callTool({ name: "workspace_info", arguments: {} });
    const data = JSON.parse((info.content as Array<{ text: string }>)[0]!.text).data;
    assert.equal(data.policyMode, "read-only");
    assert.equal(data.operationalCapabilities.write, false);
    assert.equal(data.operationalCapabilities.lsp, false);
  } finally {
    await client.close().catch(() => undefined);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
