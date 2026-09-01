import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WorkspaceRuntime,
  atomicReplaceBytes,
  withWorkspaceLock,
  SnapshotStore,
} from "@ccr/workspace-runtime";
import {
  fingerprintBytes,
  encodeText,
  detectEncoding,
  detectNewline,
  hasFinalNewline,
  decodeText,
} from "@ccr/contracts";

let dir: string;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-ws-"));
  await fs.writeFile(path.join(dir, "a.txt"), "hello world");
  await fs.writeFile(path.join(dir, ".env"), "SECRET=1");
  await fs.mkdir(path.join(dir, "sub"));
  await fs.writeFile(path.join(dir, "sub", "b.txt"), "nested");
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("resolveForRead: containment and relPosix", async () => {
  const rt = new WorkspaceRuntime();
  await rt.open({ root: dir });
  const resolved = await rt.pathPolicy.resolveForRead(rt.workspaceOrThrow, "a.txt");
  assert.equal(resolved.relPosix, "a.txt");
  assert.ok(resolved.absolute.startsWith(path.resolve(dir)));
});

test("resolveForRead: traversal rejected", async () => {
  const rt = new WorkspaceRuntime();
  await rt.open({ root: dir });
  await assert.rejects(
    rt.pathPolicy.resolveForRead(rt.workspaceOrThrow, "../../etc/passwd"),
    (e: unknown) => (e as { code?: string }).code === "ERR_PATH_OUTSIDE_WORKSPACE",
  );
});

test("resolveForRead: secret path denied", async () => {
  const rt = new WorkspaceRuntime();
  await rt.open({ root: dir });
  await assert.rejects(
    rt.pathPolicy.resolveForRead(rt.workspaceOrThrow, ".env"),
    (e: unknown) => (e as { code?: string }).code === "ERR_SECRET_PATH_DENIED",
  );
});

test("withWorkspaceLock serializes mutations", async () => {
  const rt = new WorkspaceRuntime();
  await rt.open({ root: dir });
  const order: string[] = [];
  const fn = async (name: string) => {
    await withWorkspaceLock(rt.workspaceOrThrow.id, async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`${name}:end`);
    });
  };
  await Promise.all([fn("a"), fn("b"), fn("c")]);
  assert.equal(order[0], "a:start");
  assert.equal(order[order.length - 1], "c:end");
  for (let i = 0; i < order.length; i += 2) {
    assert.equal(order[i]!.replace(":start", ""), order[i + 1]!.replace(":end", ""));
  }
});

test("atomicReplaceBytes round-trips and verifies", async () => {
  const target = path.join(dir, "sub", "c.txt");
  const bytes = new TextEncoder().encode("version-2");
  const res = await atomicReplaceBytes(target, bytes);
  const onDisk = new Uint8Array(await fs.readFile(target));
  assert.deepEqual(onDisk, bytes);
  assert.equal(res.digest, fingerprintBytes(bytes).digest);
});

test("SnapshotStore: anchor ambiguity rejection", () => {
  const store = new SnapshotStore();
  const make = (digest: string) => ({ algorithm: "sha256" as const, digest, size: 3 });
  const refA = store.record({
    path: "x.ts",
    fingerprint: make("ab11111111111111111111111111111111111111111111111111111111111111"),
    encoding: "utf-8",
    bom: false,
    newline: "lf",
    finalNewline: false,
    workspaceRevision: 0,
  });
  const refB = store.record({
    path: "y.ts",
    fingerprint: make("ab22222222222222222222222222222222222222222222222222222222222222"),
    encoding: "utf-8",
    bom: false,
    newline: "lf",
    finalNewline: false,
    workspaceRevision: 0,
  });
  assert.throws(() => store.resolveAnchor("ab"), (e: unknown) => (e as { code?: string }).code === "ERR_AMBIGUOUS_ANCHOR");
  assert.equal(store.resolve(refA.id).path, "x.ts");
  assert.equal(store.resolveAnchor("ab1111").path, "x.ts");
  store.invalidate("x.ts");
  assert.equal(store.latestFor("x.ts"), undefined);
  assert.equal(store.latestFor("y.ts")?.path, "y.ts");
});

test("encoding fidelity helpers round-trip CRLF + BOM", () => {
  const text = "a\r\nb\r\nc";
  const enc = "utf-8-bom";
  const bytes = encodeText(text, enc);
  const detected = detectEncoding(bytes);
  assert.equal(detected.encoding, "utf-8-bom");
  assert.equal(detectNewline(decodeText(bytes, detected)), "crlf");
  assert.equal(hasFinalNewline(text), false);
});
