import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { MyPiServer, createFoundationCapabilities } from "@my-pi/mcp-adapter";
import { redactEventForWire } from "@my-pi/observability";
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

test("ui://my-pi/theater renders no raw secret material from a secret-laden reader", async () => {
  const { createTheaterFrame, normalizeGraphSnapshot } = await import("../../graph-model/dist/index.js");
  const { renderTheaterViewHtml } = await import("../../../apps/my-pi-ui/dist/index.js");
  const rawReaderEvents = [
    {
      projectId: "proj-mcp-theater",
      sequence: "9",
      eventId: "ev-mcp-secret-9",
      eventType: "WorkItemCreated",
      occurredAt: "2026-09-15T00:00:00.000Z",
      actor: { kind: "system", name: "runner bearer: MCPBEARER99.abc-123" },
      payload: {
        workItemId: "wi-visible",
        token: "NEVER_MCP_TOKEN_7Q",
        api_key: "sk-ABCDEFGHIJKLMNOP0123456789",
        files: [{ path: "/srv/deploy/.npmrc" }],
        note: "rotate ghp_ABCDEFGHIJKLMNOPQRST1234 next",
      },
    },
  ];

  const theaterServer = new MyPiServer({
    name: "my-pi-theater-redaction-test",
    version: "0.0.1",
    runtime,
    capabilities: createFoundationCapabilities(runtime),
    visuals: {
      enabled: true,
      readHtml: () => "<html>2D graph</html>",
      readTheaterHtml: async () => {
        // Mirrors the apps/my-pi-mcp readTheaterHtml exit: redactEventForWire -> createTheaterFrame -> renderTheaterViewHtml
        const graph = normalizeGraphSnapshot({
          graphVersion: "work:v1",
          kind: "work",
          nodes: [{ id: "work:item:wi-visible", kind: "work", label: "Visible item" }],
          edges: [],
          bounds: { maxNodes: 50, maxEdges: 50, maxAttributeBytes: 1024 },
        });
        const frame = createTheaterFrame({
          scope: { projectId: "proj-mcp-theater", kind: "work" },
          graph,
          events: rawReaderEvents.map((event) => redactEventForWire(event)),
          cursor: { lastSequence: "9" },
          capabilities: { live: true, replay: true, expand: false, trace: false, renderer3d: true },
        });
        return renderTheaterViewHtml({ sessionToken: "mcp-app", nonce: "mcp-app", initialFrame: frame, isMcp: true });
      },
    },
  });

  assert.equal(theaterServer.visualsStatus, "registered");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await theaterServer.connect(serverTransport);
  const client = new Client({ name: "my-pi-theater-redaction-client", version: "0.0.1" });
  await client.connect(clientTransport);

  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 13);
    const theaterRes = await client.readResource({ uri: "ui://my-pi/theater" });
    const text = String(theaterRes.contents[0]?.text ?? "");
    assert.ok(text.length > 0);
    assert.ok(text.includes("[PATH:REDACTED]"));
    assert.ok(text.includes("[REDACTED:SECRET]"));
    assert.ok(text.includes("[REDACTED]"));
    assert.ok(text.includes("wi-visible"));
    for (const leak of [
      "NEVER_MCP_TOKEN_7Q",
      "sk-ABCDEFGHIJKLMNOP0123456789",
      "ghp_ABCDEFGHIJKLMNOPQRST1234",
      "MCPBEARER99",
      ".npmrc",
      "api_key\":\"sk-",
    ]) {
      assert.ok(!text.includes(leak), `rendered theater must not contain ${leak}`);
    }
  } finally {
    await client.close();
  }
});
