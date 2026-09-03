import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, runMcp } from "../src/main.ts";

test("CLI accepts explicit workspace and stdio transport", () => {
  assert.deepEqual(parseArgs(["node", "main", "--workspace", "C:/project", "--transport", "stdio"]), {
    command: "mcp",
    workspace: "C:/project",
    allowCwd: false,
    securityProfile: "read-only",
  });
});

test("CLI requires workspace authority unless --allow-cwd is explicit", () => {
  const previous = process.env.MY_PI_WORKSPACE_ROOT;
  const previousLegacy = process.env.CCR_WORKSPACE_ROOT;
  try {
    delete process.env.MY_PI_WORKSPACE_ROOT;
    delete process.env.CCR_WORKSPACE_ROOT;
    assert.deepEqual(parseArgs(["node", "main", "--allow-cwd"]), {
      command: "mcp",
      workspace: undefined,
      allowCwd: true,
      securityProfile: "read-only",
    });
    assert.deepEqual(parseArgs(["node", "main"]), {
      command: "mcp",
      workspace: undefined,
      allowCwd: false,
      securityProfile: "read-only",
    });
  } finally {
    if (previous === undefined) delete process.env.MY_PI_WORKSPACE_ROOT;
    else process.env.MY_PI_WORKSPACE_ROOT = previous;
    if (previousLegacy === undefined) delete process.env.CCR_WORKSPACE_ROOT;
    else process.env.CCR_WORKSPACE_ROOT = previousLegacy;
  }
});

test("CLI honors explicit environment workspace", () => {
  const previous = process.env.MY_PI_WORKSPACE_ROOT;
  try {
    process.env.MY_PI_WORKSPACE_ROOT = "C:/configured-workspace";
    assert.deepEqual(parseArgs(["node", "main"]), {
      command: "mcp",
      workspace: "C:/configured-workspace",
      allowCwd: false,
      securityProfile: "read-only",
    });
  } finally {
    if (previous === undefined) delete process.env.MY_PI_WORKSPACE_ROOT;
    else process.env.MY_PI_WORKSPACE_ROOT = previous;
  }
});

test("CLI rejects unknown arguments and missing workspace paths", () => {
  assert.throws(() => parseArgs(["node", "main", "--workspace"]), /requires a path/);
  assert.throws(() => parseArgs(["node", "main", "--unknown"]), /unknown argument/);
  assert.throws(() => parseArgs(["node", "main", "--transport", "http"]), /only --transport stdio/);
  assert.equal(parseArgs(["node", "main", "--security-profile", "trusted"]).securityProfile, "trusted");
});

test("runMcp fails closed when no workspace authority is configured", async () => {
  await assert.rejects(runMcp(undefined, false), /workspace is required/);
});
