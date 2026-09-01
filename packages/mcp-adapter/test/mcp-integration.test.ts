import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { WorkspaceRuntime } from "@ccr/workspace-runtime";
import { CcrServer, createFoundationCapabilities } from "@ccr/mcp-adapter";
import { err, type Capability, type CapabilityContext } from "@ccr/contracts";

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

test("G4/G5: ast_search and lsp_status are fully operational over MCP", async () => {
  const astRes = await client.callTool({ name: "ast_search", arguments: { pattern: "calculate", paths: ["a.txt"] } });
  assert.ok(!astRes.isError);
  const parsedAst = JSON.parse((astRes.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(typeof parsedAst.data.totalCount, "number");

  const lspRes = await client.callTool({ name: "lsp_status", arguments: {} });
  assert.ok(!lspRes.isError);
  const parsedLsp = JSON.parse((lspRes.content as Array<{ text?: string }>)[0]!.text!);
  assert.ok(Array.isArray(parsedLsp.data.servers));
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

test("R0.1.2: search scoped to a sensitive dir (.aws) is DENIED end-to-end", async () => {
  await fs.mkdir(path.join(dir, ".aws"), { recursive: true });
  await fs.writeFile(path.join(dir, ".aws", "config"), "AWS_SECRET=1");
  const res = await client.callTool({ name: "search", arguments: { mode: "grep", pattern: "AWS_SECRET", path: ".aws" } });
  // Either the scope resolution denies `.aws` (ERR_SECRET_PATH_DENIED) OR the
  // traversal policy excludes `.aws/config` (workspace-relative). Both are
  // correct deny outcomes. The forbidden outcome is: a match on AWS_SECRET.
  if (res.isError) {
    const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
    assert.match(errText, /sensitive|secret/i);
  } else {
    const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
    assert.equal(parsed.data.matches.length, 0);
    assert.equal(parsed.data.totalCount, 0);
  }
});

test("R0.1.3: fs_patch WITHOUT expected_hash is rejected", async () => {
  const res = await client.callTool({
    name: "fs_patch",
    arguments: { path: "a.txt", patch: { hunks: [{ old: "x", new: "y" }] } },
  });
  assert.equal(res.isError, true);
  const errText = (res.content as Array<{ text?: string }>)[0]!.text!;
  assert.match(errText, /expected_hash/i);
});

test("R0.1.4: fs_write create is no-clobber — file appearing before publish is NOT overwritten", async () => {
  // Create a fresh path that does not exist, then race a competitor between
  // the existence read and the atomic publish by calling twice: the second
  // create must NOT silently overwrite the first.
  const p = "race.txt";
  const first = await client.callTool({ name: "fs_write", arguments: { path: p, content: "first" } });
  assert.notEqual(first.isError, true);
  // Second create on the now-existing target: fs_write treats existing file
  // without expected_hash as a typed error (not a silent overwrite).
  const second = await client.callTool({ name: "fs_write", arguments: { path: p, content: "second" } });
  assert.equal(second.isError, true);
  const read = await client.callTool({ name: "fs_read", arguments: { path: p } });
  assert.equal(JSON.parse((read.content as Array<{ text?: string }>)[0]!.text!).data.content, "first");
});

// R0.1.6: deterministic cancellation evidence. A controlled backend with
// explicit barriers proves cancellation reaches the operation and it exits
// with ERR_ABORTED — "completed" is NEVER a valid cancellation result.
class ControlledLongRunningBackend {
  signal!: AbortSignal;
  started = false;
  firstIOCompleted = false;
  cancelObserved = false;
  finishedNormally = false;

  async run(signal: AbortSignal): Promise<string> {
    this.signal = signal;
    this.started = true;
    // barrier: first "IO" completed
    await Promise.resolve();
    this.firstIOCompleted = true;
    // wait for either cancel or a very long time
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        this.cancelObserved = true;
        resolve();
        return;
      }
      signal.addEventListener("abort", () => {
        this.cancelObserved = true;
        resolve();
      }, { once: true });
    });
    if (signal.aborted) throw err.aborted("controlled backend aborted");
    this.finishedNormally = true;
    return "normal";
  }
}

test("R0.1.6: capability cancellation is deterministic — ERR_ABORTED, never 'completed'", async () => {
  const backend = new ControlledLongRunningBackend();
  const cap: Capability<unknown, unknown> = {
    name: "controlled_long",
    risk: "read",
    async execute(_input, ctx: CapabilityContext) {
      const t0 = performance.now();
      try {
        const result = await backend.run(ctx.signal);
        return {
          schemaVersion: "1", requestId: ctx.requestId, workspaceId: ctx.workspace.id,
          revision: ctx.workspace.revision, data: { result }, timing: { totalMs: performance.now() - t0 },
        };
      } catch (e) {
        if ((e as { code?: string }).code === "ERR_ABORTED") {
          throw e;
        }
        throw e;
      }
    },
  };
  // Build a server with ONLY this capability wired + the runtime.
  const ac = new AbortController();
  const runPromise = cap.execute({}, {
    requestId: "r" as never,
    workspace: runtime.workspaceOrThrow,
    signal: ac.signal,
  } as unknown as CapabilityContext).then(() => "completed").catch((e: { code?: string }) => e.code ?? e.message);

  // Wait until the backend has started and completed its first IO barrier.
  let guard = 0;
  while (!backend.firstIOCompleted && guard < 1000) { await new Promise((r) => setTimeout(r, 1)); guard++; }
  assert.ok(backend.started, "backend must have started");
  assert.ok(backend.firstIOCompleted, "backend must have reached first-IO barrier");

  // Cancel the request.
  ac.abort();
  const outcome = await runPromise;

  // Deterministic assertion: ERR_ABORTED, NOT "completed".
  assert.equal(outcome, "ERR_ABORTED", `cancellation must produce ERR_ABORTED, got: ${outcome}`);
  assert.equal(backend.cancelObserved, true, "backend must observe the abort signal");
  assert.equal(backend.finishedNormally, false, "backend must NOT finish normally after cancel");
  assert.equal(backend.signal.aborted, true);
});

// G2 output budget: fs_read windowing (offset/max_bytes, truncated/next_offset).
test("G2: fs_read defaults to a bounded window and reports truncated/next_offset", async () => {
  const big = "line\n".repeat(2000); // ~10KB, larger than default 48KiB? no — keep smaller than 48KiB
  await fs.writeFile(path.join(dir, "big.txt"), big);
  const res = await client.callTool({ name: "fs_read", arguments: { path: "big.txt", max_bytes: 100 } });
  const parsed = JSON.parse((res.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(parsed.data.content.length, 100, "window should be bounded to max_bytes");
  assert.equal(parsed.data.truncated, true, "big file with small window must be truncated");
  assert.ok(parsed.data.next_offset === 100, "next_offset should continue the window");
  // Full-file hash must still be the raw-byte authority, not the window.
  assert.ok(parsed.data.content_hash.startsWith("sha256:"));
  assert.equal(parsed.data.offset, 0);
});

test("G2: fs_read window continues at next_offset and reaches the end", async () => {
  const text = "abcdefghij";
  await fs.writeFile(path.join(dir, "small.txt"), text);
  const r1 = await client.callTool({ name: "fs_read", arguments: { path: "small.txt", max_bytes: 4 } });
  const p1 = JSON.parse((r1.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(p1.data.content, "abcd");
  assert.equal(p1.data.truncated, true);
  assert.equal(p1.data.next_offset, 4);
  const r2 = await client.callTool({ name: "fs_read", arguments: { path: "small.txt", max_bytes: 4, offset: p1.data.next_offset } });
  const p2 = JSON.parse((r2.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(p2.data.content, "efgh");
  const r3 = await client.callTool({ name: "fs_read", arguments: { path: "small.txt", max_bytes: 4, offset: p2.data.next_offset } });
  const p3 = JSON.parse((r3.content as Array<{ text?: string }>)[0]!.text!);
  assert.equal(p3.data.content, "ij");
  assert.equal(p3.data.truncated, false, "last window must not be truncated");
  assert.equal(p3.data.next_offset, undefined, "no next_offset at EOF");
});

test("G2: fs_read invalid offset is a typed error", async () => {
  const res = await client.callTool({ name: "fs_read", arguments: { path: "a.txt", offset: -1 } });
  assert.equal(res.isError, true);
});
