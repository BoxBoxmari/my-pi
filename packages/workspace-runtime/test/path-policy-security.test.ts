import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";

test("sensitive policy covers an additional root that is itself a secret directory", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-policy-workspace-"));
  const sshParent = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-policy-secret-parent-"));
  const sshDir = path.join(sshParent, ".ssh");
  try {
    await fs.mkdir(sshDir);
    await fs.writeFile(path.join(sshDir, "authorized_keys"), "ssh-rsa test", "utf8");
    const runtime = new WorkspaceRuntime();
    const workspace = await runtime.open({ root: workspaceDir, additionalRoots: [sshDir] });
    const relative = path.relative(workspace.root, path.join(sshDir, "authorized_keys"));
    await assert.rejects(
      runtime.pathPolicy.resolveForRead(workspace, relative),
      (error: unknown) => (error as { code?: string }).code === "ERR_SECRET_PATH_DENIED",
    );
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(sshParent, { recursive: true, force: true });
  }
});
