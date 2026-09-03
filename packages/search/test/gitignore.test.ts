import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFallbackSearchBackend } from "@my-pi/search";

test("search supports nested gitignore rules, negation, globstar, escaping, and anchors", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-gitignore-"));
  try {
    await fs.mkdir(path.join(dir, "node_modules", "deep"), { recursive: true });
    await fs.mkdir(path.join(dir, "nested", "generated"), { recursive: true });
    await fs.writeFile(path.join(dir, ".gitignore"), [
      "node_modules/",
      "*.log   ",
      "!keep.log",
      "/only-root.txt",
      "**/generated/*.tmp",
      "escaped\\ file.txt",
      "",
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(dir, "node_modules", "deep", "blocked.ts"), "blocked", "utf8");
    await fs.writeFile(path.join(dir, "drop.log"), "blocked", "utf8");
    await fs.writeFile(path.join(dir, "keep.log"), "visible", "utf8");
    await fs.writeFile(path.join(dir, "only-root.txt"), "blocked", "utf8");
    await fs.mkdir(path.join(dir, "nested", "deeper"), { recursive: true });
    await fs.writeFile(path.join(dir, "nested", "deeper", "only-root.txt"), "visible", "utf8");
    await fs.writeFile(path.join(dir, "nested", "generated", "artifact.tmp"), "blocked", "utf8");
    await fs.writeFile(path.join(dir, "nested", "generated", "artifact.txt"), "visible", "utf8");
    await fs.writeFile(path.join(dir, "escaped file.txt"), "blocked", "utf8");
    await fs.mkdir(path.join(dir, "nested", "ignored"), { recursive: true });
    await fs.writeFile(path.join(dir, "nested", ".gitignore"), "*.secret\n!keep.secret\n", "utf8");
    await fs.writeFile(path.join(dir, "nested", "ignored", "drop.secret"), "blocked", "utf8");
    await fs.writeFile(path.join(dir, "nested", "keep.secret"), "visible", "utf8");

    const result = await new NodeFallbackSearchBackend().search({
      mode: "glob",
      pattern: "**/*",
      roots: [dir],
      ignoreGitignore: false,
      allowed: () => true,
    }, new AbortController().signal);
    const paths = result.matches.map((match) => match.path).sort();
    assert.ok(paths.includes("keep.log"));
    assert.ok(paths.includes("nested/deeper/only-root.txt"));
    assert.ok(paths.includes("nested/generated/artifact.txt"));
    assert.ok(paths.includes("nested/keep.secret"));
    assert.ok(!paths.includes("node_modules/deep/blocked.ts"));
    assert.ok(!paths.includes("drop.log"));
    assert.ok(!paths.includes("only-root.txt"));
    assert.ok(!paths.includes("nested/generated/artifact.tmp"));
    assert.ok(!paths.includes("escaped file.txt"));
    assert.ok(!paths.includes("nested/ignored/drop.secret"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
