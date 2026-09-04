import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WorkspaceRuntime,
  atomicReplaceBytes,
  atomicCreateNoReplace,
  withWorkspaceLock,
  SnapshotStore,
} from "@my-pi/workspace-runtime";
import {
  fingerprintBytes,
  encodeText,
  detectEncoding,
  detectNewline,
  hasFinalNewline,
  decodeText,
} from "@my-pi/contracts";

let dir: string;
before(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-ws-")));
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

test("P0.9: atomic replacement preserves POSIX mode bits (executable stays executable)", { skip: process.platform === "win32" ? "POSIX mode preservation not verifiable on win32 (NTFS chmod maps read-only only) — requires POSIX CI lane" : false }, async () => {
  const target = path.join(dir, "script.sh");
  const original = new TextEncoder().encode("#!/bin/sh\necho v1\n");
  await fs.writeFile(target, original);
  await fs.chmod(target, 0o755);
  assert.equal((await fs.stat(target)).mode & 0o7777, 0o755);
  const replacement = new TextEncoder().encode("#!/bin/sh\necho v2\n");
  await atomicReplaceBytes(target, replacement);
  const after = (await fs.stat(target)).mode & 0o7777;
  assert.equal(after, 0o755, "executable bit was lost by atomic replacement");
  assert.equal(await fs.readFile(target, "utf8"), "#!/bin/sh\necho v2\n");
});

test("P0.9: read-only target handling is platform-correct (fail-closed on win32, directory-governed rename on POSIX)", async () => {
  const target = path.join(dir, "keepreadonly.txt");
  await fs.writeFile(target, "first");
  await fs.chmod(target, 0o444); // read-only attribute on win32
  assert.equal((await fs.stat(target)).mode & 0o7777, 0o444);

  if (process.platform === "win32") {
    // Windows: renaming over a read-only target fails closed — no silent attribute
    // loss or truncate. Content and read-only attribute are both untouched.
    await assert.rejects(
      atomicReplaceBytes(target, new TextEncoder().encode("second")),
      (e: unknown) => (e as { code?: string }).code === "ERR_FILE_BUSY",
    );
    assert.equal(await fs.readFile(target, "utf8"), "first");
    assert.equal((await fs.stat(target)).mode & 0o7777, 0o444);
  } else {
    // POSIX: rename(2) over a read-only file is legal (governed by directory
    // write permission), so the replacement succeeds — but the atomic replacer
    // must preserve the source mode bits exactly (no silent attribute loss).
    await atomicReplaceBytes(target, new TextEncoder().encode("second"));
    assert.equal(await fs.readFile(target, "utf8"), "second");
    assert.equal((await fs.stat(target)).mode & 0o7777, 0o444);
  }
});

test("P0.9: writable-file replacement keeps ordinary mode bits", async () => {
  const target = path.join(dir, "ordinary.txt");
  await fs.writeFile(target, "first");
  const before = (await fs.stat(target)).mode & 0o7777;
  await atomicReplaceBytes(target, new TextEncoder().encode("second"));
  const after = (await fs.stat(target)).mode & 0o7777;
  assert.equal(after, before, "ordinary mode bits changed by replacement");
  assert.equal(await fs.readFile(target, "utf8"), "second");
});

test("R0.1.4: atomicCreateNoReplace creates a new file atomically", async () => {
  const target = path.join(dir, "create-new.txt");
  const res = await atomicCreateNoReplace(target, new TextEncoder().encode("created"));
  assert.equal(res.digest, fingerprintBytes(new TextEncoder().encode("created")).digest);
  assert.equal(await fs.readFile(target, "utf8"), "created");
});

test("R0.1.4: atomicCreateNoReplace does NOT clobber an existing target (no-clobber)", async () => {
  const target = path.join(dir, "create-existing.txt");
  await fs.writeFile(target, "existing");
  await assert.rejects(
    atomicCreateNoReplace(target, new TextEncoder().encode("clobber")),
    (e: unknown) => (e as { code?: string }).code === "ERR_STALE_RESOURCE",
  );
  // Original content must be untouched.
  assert.equal(await fs.readFile(target, "utf8"), "existing");
});

test("R0.1.4: atomicCreateNoReplace is no-clobber even if target appears between temp and publish", async () => {
  const target = path.join(dir, "create-race.txt");
  // Simulate: an external writer creates the target just before publish by
  // pre-creating it. atomicCreateNoReplace must refuse (link -> EEXIST).
  await fs.writeFile(target, "external-writer");
  await assert.rejects(
    atomicCreateNoReplace(target, new TextEncoder().encode("my-pi-create")),
    (e: unknown) => (e as { code?: string }).code === "ERR_STALE_RESOURCE",
  );
  assert.equal(await fs.readFile(target, "utf8"), "external-writer");
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

test("SnapshotStore retains immutable history, pins active refs, and prunes explicitly", () => {
  const store = new SnapshotStore();
  const make = (digest: string) => ({ algorithm: "sha256" as const, digest, size: 3 });
  const first = store.record({ path: "history.ts", fingerprint: make("1111111111111111111111111111111111111111111111111111111111111111"), encoding: "utf-8", bom: false, newline: "lf", finalNewline: true, workspaceRevision: 0 });
  const second = store.record({ path: "history.ts", fingerprint: make("2222222222222222222222222222222222222222222222222222222222222222"), encoding: "utf-8", bom: false, newline: "lf", finalNewline: true, workspaceRevision: 1 });
  assert.equal(store.size(), 2);
  assert.equal(store.latestFor("history.ts")?.id, second.id);
  assert.equal(store.resolve(first.id).fingerprint.digest, first.fingerprint.digest);
  store.pin(first.id, "intent-1");
  assert.equal(store.prune({ maxMetadata: 1 }).metadataRemoved, 0);
  store.unpin(first.id, "intent-1");
  assert.equal(store.prune({ maxMetadata: 1 }).metadataRemoved, 1);
  assert.equal(store.size(), 1);
  assert.equal(store.resolve(second.id).id, second.id);
  store.invalidate("history.ts");
  assert.equal(store.latestFor("history.ts"), undefined);
  assert.equal(store.resolve(second.id).id, second.id);
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
