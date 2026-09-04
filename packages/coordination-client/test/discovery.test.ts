import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverProjectIdentity, resolveEndpoint } from "@my-pi/coordination-client";

test("project discovery uses Git common-dir identity rather than checkout path", async () => {
  const identity = await discoverProjectIdentity(process.cwd());
  assert.equal(identity.kind, "git");
  assert.ok(identity.gitCommonDir?.endsWith(`${path.sep}.git`) || identity.gitCommonDir?.endsWith("/.git"));
  assert.match(identity.projectKey, /^[a-f0-9]{24}$/);
  assert.ok(identity.canonicalIdentity.startsWith("git:"));
});

test("non-Git discovery requires an explicit opt-in", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "my-pi-discovery-"));
  try {
    await assert.rejects(discoverProjectIdentity(dir), /not a Git repository/);
    const identity = await discoverProjectIdentity(dir, { allowNonGit: true });
    assert.equal(identity.kind, "path");
    assert.ok(identity.canonicalIdentity.startsWith("path:"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local endpoint selection never chooses TCP", () => {
  const endpoint = resolveEndpoint("C:/tmp/my-pi", "0123456789abcdef01234567");
  assert.ok(endpoint.transport === "named-pipe" || endpoint.transport === "unix");
  assert.ok(!endpoint.address.startsWith("tcp:"));
});
