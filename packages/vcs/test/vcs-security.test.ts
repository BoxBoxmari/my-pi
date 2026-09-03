import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequestId } from "@my-pi/contracts";
import { createVcsCapabilities } from "@my-pi/vcs";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";

test("vcs_diff filters sensitive changed paths before asking Git for content", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-vcs-security-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
    await fs.writeFile(path.join(dir, "visible.txt"), "before\n", "utf8");
    await fs.writeFile(path.join(dir, ".env"), "SECRET_BEFORE=one\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: dir });
    await fs.writeFile(path.join(dir, "visible.txt"), "after\n", "utf8");
    await fs.writeFile(path.join(dir, ".env"), "SECRET_AFTER=two\n", "utf8");

    const runtime = new WorkspaceRuntime();
    const workspace = await runtime.open({ root: dir });
    const capability = createVcsCapabilities(runtime).get("vcs_diff")!;
    const response = await capability.execute({}, {
      requestId: createRequestId(),
      workspace,
      signal: new AbortController().signal,
    });
    const output = JSON.stringify(response.data);
    assert.match(output, /after/);
    assert.doesNotMatch(output, /SECRET_(BEFORE|AFTER)/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
