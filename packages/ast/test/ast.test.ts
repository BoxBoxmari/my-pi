import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AST_LANGUAGES,
  detectAstLanguage,
  TreeSitterAstBackend,
  createAstCapabilities,
} from "@my-pi/ast";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { createRequestId } from "@my-pi/contracts";

let dir: string;
let tsPath: string;
let jsPath: string;
let pyPath: string;
let rsPath: string;
let goPath: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-ast-test-"));

  tsPath = path.join(dir, "calc.ts");
  await fs.writeFile(
    tsPath,
    `export function calculateSum(a: number, b: number): number {
  return a + b;
}
export class Calculator {
  multiply(x: number, y: number): number {
    return x * y;
  }
}
`,
    "utf8",
  );

  jsPath = path.join(dir, "util.js");
  await fs.writeFile(
    jsPath,
    `function formatMessage(msg) {
  return "[MSG] " + msg;
}
`,
    "utf8",
  );

  pyPath = path.join(dir, "service.py");
  await fs.writeFile(
    pyPath,
    `def process_data(payload: dict) -> bool:
    print("Processing:", payload)
    return True

class DataPipeline:
    def execute(self):
        pass
`,
    "utf8",
  );

  rsPath = path.join(dir, "lib.rs");
  await fs.writeFile(
    rsPath,
    `pub fn compute_hash(input: &str) -> u64 {
    42
}

pub struct Engine {
    pub speed: u32,
}
`,
    "utf8",
  );

  goPath = path.join(dir, "handler.go");
  await fs.writeFile(
    goPath,
    `package main

func HandleRequest(id string) (string, error) {
    return "ok", nil
}

type Server struct {
    Port int
}
`,
    "utf8",
  );
});

after(async () => {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

test("AST: language detection for 5 languages", () => {
  assert.equal(detectAstLanguage("foo.ts"), "typescript");
  assert.equal(detectAstLanguage("foo.tsx"), "typescript");
  assert.equal(detectAstLanguage("foo.js"), "javascript");
  assert.equal(detectAstLanguage("foo.py"), "python");
  assert.equal(detectAstLanguage("foo.rs"), "rust");
  assert.equal(detectAstLanguage("foo.go"), "go");
  assert.equal(detectAstLanguage("foo.txt"), undefined);
  assert.deepEqual([...AST_LANGUAGES], ["typescript", "javascript", "python", "rust", "go"]);
});

test("AST: TreeSitterAstBackend searches TypeScript", async () => {
  const backend = new TreeSitterAstBackend();
  const signal = new AbortController().signal;

  const res = await backend.search(
    {
      pattern: "calculateSum",
      paths: [tsPath],
    },
    signal,
  );

  assert.ok(res.totalCount >= 1, "Should find calculateSum in TypeScript");
  assert.equal(res.matches[0].path, tsPath);
  assert.ok(res.matches[0].range.start.line >= 0);
  assert.ok(res.matches[0].text.includes("calculateSum"));
});

test("AST: TreeSitterAstBackend searches JavaScript", async () => {
  const backend = new TreeSitterAstBackend();
  const signal = new AbortController().signal;

  const res = await backend.search(
    {
      pattern: "formatMessage",
      paths: [jsPath],
    },
    signal,
  );

  assert.ok(res.totalCount >= 1, "Should find formatMessage in JavaScript");
  assert.equal(res.matches[0].path, jsPath);
});

test("AST: TreeSitterAstBackend searches Python", async () => {
  const backend = new TreeSitterAstBackend();
  const signal = new AbortController().signal;

  const res = await backend.search(
    {
      pattern: "process_data",
      paths: [pyPath],
    },
    signal,
  );

  assert.ok(res.totalCount >= 1, "Should find process_data in Python");
  assert.equal(res.matches[0].path, pyPath);
});

test("AST: TreeSitterAstBackend searches Rust", async () => {
  const backend = new TreeSitterAstBackend();
  const signal = new AbortController().signal;

  const res = await backend.search(
    {
      pattern: "compute_hash",
      paths: [rsPath],
    },
    signal,
  );

  assert.ok(res.totalCount >= 1, "Should find compute_hash in Rust");
  assert.equal(res.matches[0].path, rsPath);
});

test("AST: TreeSitterAstBackend searches Go", async () => {
  const backend = new TreeSitterAstBackend();
  const signal = new AbortController().signal;

  const res = await backend.search(
    {
      pattern: "HandleRequest",
      paths: [goPath],
    },
    signal,
  );

  assert.ok(res.totalCount >= 1, "Should find HandleRequest in Go");
  assert.equal(res.matches[0].path, goPath);
});

test("AST: createAstCapabilities integration with WorkspaceRuntime", async () => {
  const runtime = new WorkspaceRuntime();
  const ws = await runtime.open({ root: dir });
  const caps = createAstCapabilities(runtime);

  const astCap = caps.get("ast_search")!;
  const ctx = {
    requestId: createRequestId(),
    workspace: ws,
    signal: new AbortController().signal,
  };

  const res = await astCap.execute({ pattern: "calculateSum" }, ctx);
  assert.ok(res.data.totalCount >= 1, "ast_search should find calculateSum in workspace");
  assert.equal(res.data.matches[0].path, "calc.ts");
});
