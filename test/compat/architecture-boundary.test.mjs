import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".");

async function runChecker(root) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/architecture-check.mjs", "--root", root], { cwd: ROOT });
    return { code: 0, output: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    return { code: Number(error.code), output: `${error.stdout ?? ""}\n${error.stderr ?? ""}` };
  }
}

async function writeFixture(root, relativePath, source) {
  const file = path.join(root, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, source, "utf8");
}

test("architecture checker rejects Production Next layering violations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-boundary-"));
  try {
    await writeFixture(root, "packages/contracts/src/bad.ts", 'import { Client } from "@modelcontextprotocol/client";\n');
    await writeFixture(root, "packages/coordination-runtime/src/bad.ts", 'import { readFile } from "node:fs/promises";\n');
    await writeFixture(root, "packages/impact-engine/src/bad.ts", 'import OpenAI from "openai";\n');
    await writeFixture(root, "packages/evaluation-runtime/src/bad.ts", 'import { exec } from "node:child_process";\n');
    await writeFixture(root, "packages/code-state/src/bad.ts", 'import profile from "@my-pi/host-profiles";\n');
    await writeFixture(root, "apps/my-pi-enterprise/src/bad.ts", 'import { readFile } from "node:fs";\n');

    const result = await runChecker(root);
    assert.equal(result.code, 1);
    assert.match(result.output, /contracts must remain independent/);
    assert.match(result.output, /coordination-runtime must not import/);
    assert.match(result.output, /impact-engine must not import/);
    assert.match(result.output, /evaluation-runtime must not execute/);
    assert.match(result.output, /code-state must not own/);
    assert.match(result.output, /enterprise control-plane must not/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
