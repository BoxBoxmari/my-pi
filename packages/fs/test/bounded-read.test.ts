import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFsCapabilities, MAX_FS_READ_BYTES, readBoundedFile } from "@my-pi/fs";
import { createRequestId, encodeText, fingerprintBytes } from "@my-pi/contracts";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";

let dir: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-bounded-read-"));
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("fs_read uses raw-byte windows without splitting UTF-8 characters", async () => {
  const value = "Aé🌍Z";
  await fs.writeFile(path.join(dir, "utf8.txt"), value, "utf8");
  const first = await readBoundedFile(path.join(dir, "utf8.txt"), 0, 3);
  assert.equal(first.content, "Aé");
  assert.equal(first.contentBytes, 3);
  assert.equal(first.nextOffset, 3);

  const second = await readBoundedFile(path.join(dir, "utf8.txt"), first.nextOffset!, 4);
  assert.equal(second.content, "🌍");
  assert.equal(second.contentBytes, 4);
  assert.equal(second.nextOffset, 7);
});

test("fs_read advances safely when the requested byte offset is inside a UTF-8 sequence", async () => {
  const file = path.join(dir, "offset.txt");
  await fs.writeFile(file, "é🌍done", "utf8");
  const result = await readBoundedFile(file, 3, 4);
  assert.equal(result.content, "🌍");
  assert.ok(result.contentBytes <= 4);
  assert.ok(!result.content.includes("�"));
});

test("fs_read hashes and reports metadata without retaining the full file", async () => {
  const file = path.join(dir, "large.txt");
  await fs.writeFile(file, "x".repeat(2 * 1024 * 1024) + "\n", "utf8");
  const result = await readBoundedFile(file, 0, 128);
  assert.equal(result.contentBytes, 128);
  assert.equal(result.content.length, 128);
  assert.equal(result.nextOffset, 128);
  assert.equal(result.newline, "lf");
  assert.equal(result.finalNewline, true);
  assert.equal(result.size, 2 * 1024 * 1024 + 1);
  assert.equal(result.digest, fingerprintBytes(new Uint8Array(await fs.readFile(file))).digest);
});

test("fs_read preserves BOM-aware UTF-8 and UTF-16 byte windows", async () => {
  for (const [encoding, name] of [["utf-8-bom", "utf8-bom.txt"], ["utf-16be-bom", "utf16-be.txt"]] as const) {
    const file = path.join(dir, name);
    await fs.writeFile(file, encodeText("chào 🌏\n", encoding));
    const result = await readBoundedFile(file, 0, 12);
    assert.equal(result.encoding, encoding);
    assert.ok(result.contentBytes <= 12);
    assert.ok(!result.content.includes("�"));
    assert.equal(result.newline, "lf");
  }
});

test("UTF-16 metadata remains correct after fs_write", async () => {
  const file = path.join(dir, "utf16.txt");
  const runtime = new WorkspaceRuntime();
  const workspace = await runtime.open({ root: dir, policy: { mode: "workspace-write" }, capabilities: { write: true } });
  const capability = createFsCapabilities(runtime).get("fs_write")!;
  const readCapability = createFsCapabilities(runtime).get("fs_read")!;
  const context = { requestId: createRequestId(), workspace, signal: new AbortController().signal };
  await fs.writeFile(file, encodeText("dòng một\ndòng hai\n", "utf-16le-bom"));

  const read = await readCapability.execute({ path: "utf16.txt" }, context);
  const hash = read.data.content_hash;
  const written = await capability.execute({ path: "utf16.txt", content: "dòng một\ndòng hai\n", expected_hash: hash }, context);
  assert.equal(written.data.encoding, "utf-16le-bom");
  assert.equal(written.data.newline, "lf");
  assert.equal(written.data.finalNewline, true);
});

test("fs_read rejects an unbounded request above the configured maximum", async () => {
  const runtime = new WorkspaceRuntime();
  const workspace = await runtime.open({ root: dir });
  const capability = createFsCapabilities(runtime).get("fs_read")!;
  await assert.rejects(
    capability.execute({ path: "large.txt", max_bytes: MAX_FS_READ_BYTES + 1 }, {
      requestId: createRequestId(),
      workspace,
      signal: new AbortController().signal,
    }),
    (error: unknown) => (error as { code?: string }).code === "ERR_INVALID_ARGUMENT",
  );
});
