import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createLspCapabilities,
  findWorkspaceRoot,
  LspRegistry,
  type LspClient,
} from "@my-pi/lsp";
import { createRequestId } from "@my-pi/contracts";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";

test("LSP root detection never promotes a parent project above the authority boundary", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-lsp-parent-"));
  const child = path.join(parent, "child");
  try {
    await fs.mkdir(child);
    await fs.writeFile(path.join(parent, "package.json"), '{"name":"parent"}', "utf8");
    assert.equal(findWorkspaceRoot(child, "typescript", child), child);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("LSP navigation filters locations outside the authorized workspace", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-lsp-authority-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-lsp-external-"));
  try {
    await fs.writeFile(path.join(dir, "inside.ts"), "export const inside = 1;\n", "utf8");
    await fs.writeFile(path.join(outside, "outside.ts"), "export const outside = 1;\n", "utf8");
    const runtime = new WorkspaceRuntime();
    const workspace = await runtime.open({ root: dir, capabilities: { lsp: true } });
    const fakeClient = {
      async definition() {
        return [
          { uri: "file://inside", path: path.join(dir, "inside.ts"), range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } } },
          { uri: "file://outside", path: path.join(outside, "outside.ts"), range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } } },
        ];
      },
      async references() {
        return [];
      },
      async hover() {
        return "inside";
      },
    } as unknown as LspClient;
    const registry = new LspRegistry();
    registry.getClient = async () => fakeClient;
    const capability = createLspCapabilities(runtime, registry).get("lsp_navigate")!;
    const response = await capability.execute(
      { action: "definition", path: "inside.ts", line: 0, column: 0 },
      { requestId: createRequestId(), workspace, signal: new AbortController().signal },
    );

    assert.equal(response.data.locations.length, 1);
    assert.equal(response.data.locations[0]?.path, "inside.ts");
    assert.equal(response.data.filteredExternal, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
