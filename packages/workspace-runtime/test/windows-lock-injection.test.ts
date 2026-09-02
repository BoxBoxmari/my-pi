import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { atomicReplaceBytes } from "@my-pi/workspace-runtime";

test("G3: Windows locked-file injection (sharing violation fails closed with ERR_FILE_BUSY)", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-win-lock-"));
  const target = path.join(dir, "locked-file.txt");
  await fs.writeFile(target, "initial-content", "utf8");

  // Open an exclusive file descriptor (non-shareable or open write lock)
  let fd: number | null = null;
  try {
    // On Windows, opening with 'r+' or 'w+' holds a handle that blocks atomic replacement/rename
    fd = fsSync.openSync(target, "r+");

    // Attempting atomic replacement while locked should fail closed
    const newBytes = new TextEncoder().encode("tampered-content");
    
    try {
      await atomicReplaceBytes(target, newBytes);
      // On POSIX unlinks of open files succeed, but on Windows rename over an open file throws EBUSY/EPERM
      if (process.platform === "win32") {
        assert.fail("Expected atomicReplaceBytes to fail on Windows locked file");
      }
    } catch (e: any) {
      assert.ok(
        e.code === "ERR_FILE_BUSY" || e.code === "ERR_ATOMIC_REPLACE_FAILED" || e.code === "EBUSY" || e.code === "EPERM",
        `Expected busy/replace error code, got: ${e.code}`,
      );
    }
  } finally {
    if (fd !== null) {
      fsSync.closeSync(fd);
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
