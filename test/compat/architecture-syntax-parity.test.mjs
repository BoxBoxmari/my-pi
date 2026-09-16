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

async function withTempRoot(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-arch-parity-"));
  try {
    for (const [rel, src] of files) await writeFixture(root, rel, src);
    return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
  } catch (e) {
    await fs.rm(root, { recursive: true, force: true });
    throw e;
  }
}

// Each governed boundary must treat semantically equivalent syntax identically.
test("quote style does not change architecture verdicts", async () => {
  for (const quote of ['"', "'"]) {
    const { root, cleanup } = await withTempRoot([
      ["packages/mcp-adapter/src/a.ts", `import { readFile } from ${quote}node:fs${quote};\n`],
    ]);
    try {
      const result = await runChecker(root);
      assert.equal(result.code, 1, `single/double quotes must both fail (quote=${quote})`);
      assert.match(result.output, /node:fs business logic belongs in @my-pi\/fs/);
      assert.match(result.output, /dependency: node:fs/);
      assert.match(result.output, /syntax: import/);
    } finally {
      await cleanup();
    }
  }
});

test("export-from, dynamic import and require are governed like static imports", async () => {
  const variants = [
    ["static", `import { x } from "node:fs";\n`],
    ["side-effect", `import "node:fs";\n`],
    ["export-from", `export { x } from 'node:fs';\n`],
    ["export-all", `export * from 'node:fs';\n`],
    ["dynamic", `const m = await import('node:fs');\n`],
    ["require", `const x = require('node:fs');\n`],
  ];
  for (const [name, src] of variants) {
    const { root, cleanup } = await withTempRoot([["packages/mcp-adapter/src/a.ts", src]]);
    try {
      const result = await runChecker(root);
      assert.equal(result.code, 1, `${name} must be rejected`);
    } finally {
      await cleanup();
    }
  }
});

test("non-literal dynamic specifiers fail closed", async () => {
  const { root, cleanup } = await withTempRoot([
    ["packages/mcp-adapter/src/a.ts", `const m = await import(name);\n`],
  ]);
  try {
    const result = await runChecker(root);
    assert.equal(result.code, 1);
    assert.match(result.output, /not a string literal/);
  } finally {
    await cleanup();
  }
});

test("unparseable source fails closed instead of silently passing", async () => {
  const { root, cleanup } = await withTempRoot([
    ["packages/mcp-adapter/src/a.ts", `import { from ;;;\n`],
  ]);
  try {
    const result = await runChecker(root);
    assert.equal(result.code, 1);
    assert.match(result.output, /unparseable/);
  } finally {
    await cleanup();
  }
});

test("comments and string literals do not trigger violations", async () => {
  const { root, cleanup } = await withTempRoot([
    ["packages/mcp-adapter/src/a.ts", `// import { x } from "node:fs";\nconst s = "from node:fs";\nconst t = 'import x from "openai"';\n`],
  ]);
  try {
    const result = await runChecker(root);
    assert.equal(result.code, 0, `comments/strings must be ignored:\n${result.output}`);
  } finally {
    await cleanup();
  }
});

test("valid internal dependencies still pass", async () => {
  const { root, cleanup } = await withTempRoot([
    ["packages/mcp-adapter/src/a.ts", `import { z } from 'zod';\nimport type { X } from '@my-pi/contracts';\nimport { Y } from "./local";\nimport { createRequire } from 'node:module';\n`],
    ["packages/contracts/src/ok.ts", `import type { X } from '@my-pi/contracts';\n`],
  ]);
  try {
    const result = await runChecker(root);
    assert.equal(result.code, 0, `allowed deps must pass:\n${result.output}`);
  } finally {
    await cleanup();
  }
});

test("evaluation-runtime shell calls are detected via syntax, not text", async () => {
  const { root, cleanup } = await withTempRoot([
    ["packages/evaluation-runtime/src/a.ts", `import { spawn } from 'node:child_process';\nspawn('ls');\n`],
    ["packages/evaluation-runtime/src/comment.ts", `// spawn('ls')\nconst s = "exec(";\n`],
  ]);
  try {
    const result = await runChecker(root);
    assert.equal(result.code, 1);
    assert.match(result.output, /must not execute arbitrary model-supplied shell/);
  } finally {
    await cleanup();
  }
});

test("diagnostics include file, dependency and rule", async () => {
  const { root, cleanup } = await withTempRoot([
    ["packages/mcp-adapter/src/foo.ts", `import { x } from 'node:fs';\n`],
  ]);
  try {
    const result = await runChecker(root);
    assert.equal(result.code, 1);
    assert.match(result.output, /packages\/mcp-adapter\/src\/foo\.ts:\d+:\d+/);
    assert.match(result.output, /dependency: node:fs/);
    assert.match(result.output, /rule: /);
  } finally {
    await cleanup();
  }
});
