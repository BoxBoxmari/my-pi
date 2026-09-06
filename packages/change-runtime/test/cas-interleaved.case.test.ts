import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fingerprintBytes } from "@my-pi/contracts";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { ChangeRuntime } from "@my-pi/change-runtime";

/**
 * P0: the in-process `withWorkspaceLock` mutex does NOT provide cross-process
 * exclusion. Two "processes" (here: two WorkspaceRuntime/ChangeRuntime pairs
 * over the same directory, hence distinct workspace ids and no shared mutex
 * queue) racing on the same path must resolve via CAS: exactly one APPLIED,
 * the loser gets ERR_STALE_RESOURCE — never a silent second APPLIED.
 */
test("interleaved CAS: stale writer loses with ERR_STALE_RESOURCE, not silent APPLIED", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-cas-interleaved-"));
  try {
    const target = path.join(dir, "shared.txt");
    await writeFile(target, "v0", "utf8");
    const v0fp = fingerprintBytes(new TextEncoder().encode("v0"));

    const rtA = new WorkspaceRuntime();
    await rtA.open({ root: dir, policy: { mode: "workspace-write" }, capabilities: { write: true } });
    const rtB = new WorkspaceRuntime();
    await rtB.open({ root: dir, policy: { mode: "workspace-write" }, capabilities: { write: true } });
    const changesA = new ChangeRuntime(rtA);
    const changesB = new ChangeRuntime(rtB);

    // Both processes observe v0.
    const preconditionA = { path: "shared.txt", condition: "match" as const, fingerprint: v0fp };
    const preconditionB = { path: "shared.txt", condition: "match" as const, fingerprint: v0fp };

    // Process B wins the race.
    const receiptB = await changesB.applyBytes({
      path: "shared.txt",
      bytes: new TextEncoder().encode("v1-from-B"),
      precondition: preconditionB,
    });
    assert.equal(receiptB.status, "APPLIED");

    // Process A is now stale: CAS must reject, file keeps winner's bytes.
    await assert.rejects(
      changesA.applyBytes({
        path: "shared.txt",
        bytes: new TextEncoder().encode("v1-from-A"),
        precondition: preconditionA,
      }),
      (error: unknown) => (error as { code?: string }).code === "ERR_STALE_RESOURCE",
    );
    assert.equal(await readFile(target, "utf8"), "v1-from-B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent no-clobber create: exactly one winner, loser gets ERR_STALE_RESOURCE", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-cas-create-race-"));
  try {
    const rtA = new WorkspaceRuntime();
    await rtA.open({ root: dir, policy: { mode: "workspace-write" }, capabilities: { write: true } });
    const rtB = new WorkspaceRuntime();
    await rtB.open({ root: dir, policy: { mode: "workspace-write" }, capabilities: { write: true } });
    const changesA = new ChangeRuntime(rtA);
    const changesB = new ChangeRuntime(rtB);
    const absent = { path: "race.txt", condition: "absent" as const };

    const results = await Promise.allSettled([
      changesA.applyBytes({ path: "race.txt", bytes: new TextEncoder().encode("from-A"), precondition: absent }),
      changesB.applyBytes({ path: "race.txt", bytes: new TextEncoder().encode("from-B"), precondition: absent }),
    ]);
    const applied = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(applied.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal((rejected[0] as PromiseRejectedResult).reason?.code, "ERR_STALE_RESOURCE");
    const body = await readFile(path.join(dir, "race.txt"), "utf8");
    assert.ok(body === "from-A" || body === "from-B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
