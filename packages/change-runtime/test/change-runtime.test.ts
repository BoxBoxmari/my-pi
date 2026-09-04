import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fingerprintBytes } from "@my-pi/contracts";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { ChangeRuntime, verifyReceipt } from "@my-pi/change-runtime";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-change-runtime-"));
  const runtime = new WorkspaceRuntime();
  await runtime.open({ root: dir, policy: { mode: "workspace-write" }, capabilities: { write: true } });
  return { dir, runtime, changes: new ChangeRuntime(runtime) };
}

test("ChangeRuntime applies no-clobber create and returns a verifiable receipt", async () => {
  const { dir, runtime, changes } = await setup();
  try {
    const bytes = new TextEncoder().encode("created by change runtime\n");
    const receipt = await changes.applyBytes({ path: "created.txt", bytes, precondition: { path: "created.txt", condition: "absent" }, planDigest: "plan-1" });
    assert.equal(receipt.status, "APPLIED");
    assert.equal(receipt.outputVersions?.[0]?.fingerprint?.digest, fingerprintBytes(bytes).digest);
    assert.equal(verifyReceipt(receipt), true);
    assert.equal(await readFile(path.join(dir, "created.txt"), "utf8"), "created by change runtime\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ChangeRuntime rejects stale replacement before publication", async () => {
  const { dir, runtime, changes } = await setup();
  try {
    const target = path.join(dir, "stale.txt");
    await writeFile(target, "original", "utf8");
    const old = fingerprintBytes(new TextEncoder().encode("original"));
    await writeFile(target, "external", "utf8");
    await assert.rejects(
      changes.applyBytes({ path: "stale.txt", bytes: new TextEncoder().encode("candidate"), precondition: { path: "stale.txt", condition: "match", fingerprint: old } }),
      (error: unknown) => (error as { code?: string }).code === "ERR_STALE_RESOURCE",
    );
    assert.equal(await readFile(target, "utf8"), "external");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ChangeRuntime applies a text transform through the same final CAS publication path", async () => {
  const { dir, runtime, changes } = await setup();
  try {
    const target = path.join(dir, "transform.txt");
    const initial = new TextEncoder().encode("first\r\n");
    await writeFile(target, initial);
    const receipt = await changes.applyTransform({
      path: "transform.txt",
      precondition: { path: "transform.txt", condition: "match", fingerprint: fingerprintBytes(initial) },
      transform: (current) => new TextEncoder().encode(new TextDecoder().decode(current).replace("first", "second")),
    });
    assert.equal(receipt.status, "APPLIED");
    assert.equal(await readFile(target, "utf8"), "second\r\n");
    assert.equal(runtime.workspaceOrThrow.revision, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ChangeRuntime preflight rejects a stale later file before any publication", async () => {
  const { dir, changes } = await setup();
  try {
    await assert.rejects(changes.applyMany({ changes: [
      { path: "a.txt", bytes: new TextEncoder().encode("a"), precondition: { path: "a.txt", condition: "absent" } },
      { path: "b.txt", bytes: new TextEncoder().encode("b"), precondition: { path: "b.txt", condition: "match", fingerprint: { algorithm: "sha256", digest: "0".repeat(64), size: 1 } } },
    ] }), (error: unknown) => (error as { code?: string }).code === "ERR_STALE_RESOURCE");
    await assert.rejects(readFile(path.join(dir, "a.txt"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ChangeRuntime reports PARTIAL without automatic rollback after a later publication failure", async () => {
  const { dir, changes } = await setup();
  try {
    let signalReads = 0;
    const signal = {
      get aborted() { return signalReads++ > 0; },
      addEventListener() {},
      removeEventListener() {},
    } as unknown as AbortSignal;
    const receipt = await changes.applyMany({ changes: [
      { path: "a.txt", bytes: new TextEncoder().encode("a"), precondition: { path: "a.txt", condition: "absent" }, signal },
      { path: "b.txt", bytes: new TextEncoder().encode("b"), precondition: { path: "b.txt", condition: "absent" }, signal },
    ] });
    assert.equal(receipt.status, "PARTIAL");
    assert.equal(await readFile(path.join(dir, "a.txt"), "utf8"), "a");
    await assert.rejects(readFile(path.join(dir, "b.txt"), "utf8"), { code: "ENOENT" });
    assert.equal(receipt.inputVersions?.length, 2);
    assert.deepEqual(receipt.resourceResults?.map((item) => [item.path, item.status]), [["a.txt", "APPLIED"], ["b.txt", "REJECTED"]]);
    assert.equal(receipt.verification?.verified, false);
    assert.equal(receipt.planDigest?.length, 64);
    assert.equal(verifyReceipt(receipt), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ChangeRuntime composite proposal digest includes every ordered resource", async () => {
  const { dir, changes } = await setup();
  try {
    const first = await changes.applyMany({ changes: [
      { path: "a.txt", bytes: new TextEncoder().encode("a"), precondition: { path: "a.txt", condition: "absent" } },
      { path: "b.txt", bytes: new TextEncoder().encode("b"), precondition: { path: "b.txt", condition: "absent" } },
    ] });
    assert.equal(first.status, "APPLIED");
    assert.equal(first.inputVersions?.length, 2);
    assert.equal(first.outputVersions?.length, 2);
    assert.equal(first.resourceResults?.every((item) => item.status === "APPLIED"), true);
    await rm(path.join(dir, "a.txt"));
    await rm(path.join(dir, "b.txt"));
    const second = await changes.applyMany({ changes: [
      { path: "a.txt", bytes: new TextEncoder().encode("a"), precondition: { path: "a.txt", condition: "absent" } },
      { path: "b.txt", bytes: new TextEncoder().encode("changed"), precondition: { path: "b.txt", condition: "absent" } },
    ] });
    assert.notEqual(second.planDigest, first.planDigest);
    assert.equal(verifyReceipt(first), true);
    assert.equal(verifyReceipt(second), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
