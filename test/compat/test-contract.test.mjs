import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("test-contract guard passes (every invariant bound to an executable proof and CI)", async () => {
  try {
    await execFileAsync(process.execPath, ["scripts/verify-test-contract.mjs"], { cwd: "." });
  } catch (error) {
    assert.fail(`verify-test-contract.mjs failed:\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  }
});
