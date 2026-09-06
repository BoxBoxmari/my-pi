import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";

test("symlink inside workspace pointing outside is rejected (pathOutsideWorkspace)", async () => {
  const workspaceDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-symlink-ws-")));
  const outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-symlink-out-")));
  try {
    const outsideFile = path.join(outsideDir, "secret.txt");
    await fs.writeFile(outsideFile, "outside", "utf8");
    const linkPath = path.join(workspaceDir, "escape-link.txt");
    await fs.symlink(outsideFile, linkPath);
    const runtime = new WorkspaceRuntime();
    const workspace = await runtime.open({ root: workspaceDir });
    await assert.rejects(
      runtime.pathPolicy.resolveForRead(workspace, "escape-link.txt"),
      (error: unknown) => (error as { code?: string }).code === "ERR_PATH_OUTSIDE_WORKSPACE",
    );
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("symlinked directory pointing outside is rejected", async () => {
  const workspaceDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-symlinkdir-ws-")));
  const outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-symlinkdir-out-")));
  try {
    await fs.writeFile(path.join(outsideDir, "data.txt"), "outside", "utf8");
    await fs.symlink(outsideDir, path.join(workspaceDir, "escape-dir"));
    const runtime = new WorkspaceRuntime();
    const workspace = await runtime.open({ root: workspaceDir });
    await assert.rejects(
      runtime.pathPolicy.resolveForRead(workspace, "escape-dir/data.txt"),
      (error: unknown) => (error as { code?: string }).code === "ERR_PATH_OUTSIDE_WORKSPACE",
    );
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("case-variant sensitive file is denied (.ENV, Secrets/foo)", async () => {
  const workspaceDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-case-ws-")));
  try {
    await fs.writeFile(path.join(workspaceDir, ".ENV"), "SECRET=1", "utf8");
    await fs.mkdir(path.join(workspaceDir, "Secrets"));
    await fs.writeFile(path.join(workspaceDir, "Secrets", "foo"), "secret", "utf8");
    const runtime = new WorkspaceRuntime();
    const workspace = await runtime.open({ root: workspaceDir, policy: { mode: "workspace-write" }, capabilities: { write: true } });
    await assert.rejects(
      runtime.pathPolicy.resolveForRead(workspace, ".ENV"),
      (error: unknown) => (error as { code?: string }).code === "ERR_SECRET_PATH_DENIED",
    );
    await assert.rejects(
      runtime.pathPolicy.resolveForRead(workspace, "Secrets/foo"),
      (error: unknown) => (error as { code?: string }).code === "ERR_SECRET_PATH_DENIED",
    );
    await assert.rejects(
      runtime.pathPolicy.resolveForWrite(workspace, ".ENV"),
      (error: unknown) => (error as { code?: string }).code === "ERR_SECRET_PATH_DENIED",
    );
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});
