import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { MyPiServer, createFoundationCapabilities } from "../../packages/mcp-adapter/dist/index.js";
import { WorkspaceRuntime } from "../../packages/workspace-runtime/dist/index.js";

const EXPECTED_TOOL_NAMES = [
  "ast_search",
  "fs_patch",
  "fs_read",
  "fs_stat",
  "fs_write",
  "lsp_diagnostics",
  "lsp_navigate",
  "lsp_status",
  "lsp_symbols",
  "search",
  "vcs_diff",
  "vcs_status",
  "workspace_info",
];

const EXPECTED_SCHEMAS = {
  workspace_info: { type: "object", properties: {} },
  fs_stat: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  fs_read: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      max_bytes: { type: "integer", minimum: 1, maximum: 1048576 },
    },
    required: ["path"],
  },
  fs_write: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string", maxLength: 8388608 },
      expected_hash: { type: "string" },
    },
    required: ["path", "content"],
  },
  fs_patch: {
    type: "object",
    properties: {
      path: { type: "string" },
      patch: {
        type: "object",
        properties: {
          hunks: {
            type: "array",
            maxItems: 1000,
            items: {
              type: "object",
              properties: {
                old: { type: "string", maxLength: 1048576 },
                new: { type: "string", maxLength: 1048576 },
              },
              required: ["old", "new"],
            },
          },
        },
        required: ["hunks"],
      },
      expected_hash: { type: "string" },
    },
    required: ["path", "patch"],
  },
  search: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["grep", "glob"] },
      pattern: { type: "string" },
      path: { type: "string" },
    },
    required: ["mode", "pattern"],
  },
  ast_search: {
    type: "object",
    properties: {
      pattern: { type: "string", maxLength: 8192 },
      paths: { type: "array", maxItems: 2000, items: { type: "string" } },
      mode: { type: "string", enum: ["text", "query"] },
    },
    required: ["pattern", "paths"],
  },
  lsp_status: { type: "object", properties: {} },
  lsp_diagnostics: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  lsp_symbols: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  lsp_navigate: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["definition", "references", "hover"] },
      path: { type: "string" },
      line: { type: "integer", minimum: 0, maximum: 1000000 },
      column: { type: "integer", minimum: 0, maximum: 1000000 },
    },
    required: ["action", "path"],
  },
  vcs_status: { type: "object", properties: { path: { type: "string" } } },
  vcs_diff: { type: "object", properties: { path: { type: "string" } } },
};

function withoutSchemaMeta(schema) {
  const copy = structuredClone(schema);
  delete copy.$schema;
  return copy;
}

test("PN0 compatibility: the MCP catalog exposes exactly the 13 legacy tools and schemas", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-compat-"));
  const runtime = new WorkspaceRuntime();
  const client = new Client({ name: "my-pi-compat-test", version: "1" });
  try {
    await runtime.open({ root: dir });
    const server = new MyPiServer({ runtime, capabilities: createFoundationCapabilities(runtime) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const response = await client.listTools();
    const actual = Object.fromEntries(response.tools.map((tool) => [tool.name, withoutSchemaMeta(tool.inputSchema)]));
    assert.deepEqual(response.tools.map((tool) => tool.name).sort(), EXPECTED_TOOL_NAMES);
    assert.deepEqual(actual, EXPECTED_SCHEMAS);
  } finally {
    await client.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});
