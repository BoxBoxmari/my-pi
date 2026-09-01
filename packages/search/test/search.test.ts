import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFallbackSearchBackend } from "@ccr/search";
import { SensitivePathPolicy } from "@ccr/policy";

let dir: string;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-srch-"));
  await fs.writeFile(path.join(dir, "readme.md"), "hello search");
  await fs.writeFile(path.join(dir, "notes.md"), "also SECRET here");
  // P0.2 proof files: VISIBLE files that match sensitive RULES (credentials*, secrets*).
  // These are NOT hidden — they reach the policy gate only if traversal actually
  // visits them, so the test proves gate enforcement, not hidden-file skipping.
  await fs.writeFile(path.join(dir, "credentials_prod.txt"), "SECRET=prod");
  await fs.writeFile(path.join(dir, "secrets.json"), '{"SECRET":"x"}');
  await fs.mkdir(path.join(dir, "keydir"), { recursive: true });
  await fs.writeFile(path.join(dir, "keydir", "server.key"), "SECRET keymaterial");
  await fs.writeFile(path.join(dir, ".env"), "SECRET=1");
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const sensitive = new SensitivePathPolicy();
const denySensitive = (rel: string) => sensitive.isSensitive(rel) === undefined;

test("P0.2: grep NEVER opens a denied VISIBLE sensitive file (read-spy proof)", async () => {
  const opened: string[] = [];
  const backend = new NodeFallbackSearchBackend();
  const res = await backend.search(
    {
      mode: "grep",
      pattern: "SECRET|prod|x\"|keymaterial",
      roots: [dir],
      allowed: (rel, isDir) => (isDir ? denySensitive(rel) : denySensitive(rel)),
      onFileRead: (rel) => opened.push(rel),
    },
    new AbortController().signal,
  );
  // notes.md contains "SECRET" and is NOT sensitive — it must match.
  // All sensitive files (visible and hidden) must contribute zero matches
  // and zero read operations.
  const matched = res.matches.map((m) => m.path);
  assert.ok(matched.includes("notes.md"));
  assert.ok(!matched.includes("credentials_prod.txt"), "credentials_prod.txt matched!");
  assert.ok(!matched.includes("secrets.json"), "secrets.json matched!");
  assert.ok(!matched.some((p) => p.startsWith("keydir/")), "keydir/ matched!");
  assert.ok(res.totalCount >= 1);
  assert.ok(!opened.includes("credentials_prod.txt"), "credentials_prod.txt was opened!");
  assert.ok(!opened.includes("secrets.json"), "secrets.json was opened!");
  assert.ok(!opened.some((f) => f.startsWith("keydir/")), "keydir/ was opened!");
  // Non-sensitive visible files were still read.
  assert.ok(opened.includes("readme.md"));
  assert.ok(opened.includes("notes.md"));
});

test("P0.2: sensitive DIRECTORIES are not descended into (visible dir)", async () => {
  // keydir/server.key is visible (dir does not start with '.'); the walker
  // must reject the directory before descent.
  const opened: string[] = [];
  const backend = new NodeFallbackSearchBackend();
  const res = await backend.search(
    {
      mode: "grep",
      pattern: "keymaterial",
      roots: [dir],
      allowed: (rel, isDir) => denySensitive(rel),
      onFileRead: (rel) => opened.push(rel),
    },
    new AbortController().signal,
  );
  assert.equal(res.totalCount, 0);
  assert.ok(!opened.some((f) => f.startsWith("keydir/")), "keydir was descended into!");
});

test("P0.2: explicitly allow-listed sensitive path CAN be searched", async () => {
  const opened: string[] = [];
  const allowList = ["credentials_prod.txt"];
  const isAllowed = (rel: string) => {
    if (sensitive.isSensitive(rel) === undefined) return true;
    return allowList.some((a) => rel === a || rel.startsWith(a + "/"));
  };
  const backend = new NodeFallbackSearchBackend();
  const res = await backend.search(
    {
      mode: "grep",
      pattern: "prod",
      roots: [dir],
      allowed: (rel) => isAllowed(rel),
      onFileRead: (rel) => opened.push(rel),
    },
    new AbortController().signal,
  );
  assert.ok(res.matches.some((m) => m.path === "credentials_prod.txt"));
  assert.ok(opened.includes("credentials_prod.txt"), "allow-listed file should be read");
  assert.ok(!opened.includes("secrets.json"), "non-allow-listed sensitive file must not be read");
});

test("P1.5 Contract A: totalCount is exact past the inline limit", async () => {
  const backend = new NodeFallbackSearchBackend();
  const res = await backend.search(
    {
      mode: "grep",
      pattern: "hello|also",
      roots: [dir],
      allowed: (rel) => denySensitive(rel),
      limit: 1,
    },
    new AbortController().signal,
  );
  assert.equal(res.totalCount, 2);
  assert.equal(res.matches.length, 1);
  assert.equal(res.truncated, true);
});

test("P0.3: absolute root is required — '.' rejected", async () => {
  const backend = new NodeFallbackSearchBackend();
  await assert.rejects(
    backend.search({ mode: "glob", pattern: "*", roots: ["."] }, new AbortController().signal),
    /requires a resolved absolute root/,
  );
});

test("P0.3: search scoped to subdirectory does not escape into siblings", async () => {
  const sub = path.join(dir, "scoped");
  const sibling = path.join(dir, "sibling");
  await fs.mkdir(sub, { recursive: true });
  await fs.mkdir(sibling, { recursive: true });
  await fs.writeFile(path.join(sub, "in.txt"), "TARGET");
  await fs.writeFile(path.join(sibling, "out.txt"), "TARGET");
  const backend = new NodeFallbackSearchBackend();
  const res = await backend.search(
    { mode: "grep", pattern: "TARGET", roots: [sub], allowed: () => true },
    new AbortController().signal,
  );
  assert.equal(res.totalCount, 1);
  assert.equal(res.matches[0]?.path, "in.txt");
});

test("R0.1.2: policy path is workspace-relative — scope=.aws cannot rebase .aws/config", async () => {
  // Simulate what the capability does: scope resolves to .aws, backend
  // candidate path is "config" (scope-relative). The policy must evaluate
  // ".aws/config" (workspace-relative), NOT "config".
  const sensitive = new SensitivePathPolicy();
  const toPosix = (p: string) => p.split(path.sep).join("/");
  const workspaceRoot = dir;
  const searchRoot = path.join(dir, ".aws");
  const scopeRel = "config";
  const abs = path.resolve(searchRoot, scopeRel);
  const policyRel = toPosix(path.relative(workspaceRoot, abs));
  assert.equal(policyRel, ".aws/config");
  assert.equal(sensitive.isSensitive(policyRel), ".aws/**", ".aws/config must be sensitive workspace-relative");
  assert.equal(sensitive.isSensitive(scopeRel), undefined, "bare 'config' must NOT be the policy input");
});

test("R0.1.2: sensitive matcher treats .aws and .ssh roots as sensitive", () => {
  const p = new SensitivePathPolicy();
  assert.equal(p.isSensitive(".aws"), ".aws/**");
  assert.equal(p.isSensitive(".aws/config"), ".aws/**");
  assert.equal(p.isSensitive(".aws/credentials/x"), ".aws/**");
  assert.equal(p.isSensitive(".ssh"), ".ssh/**");
  assert.equal(p.isSensitive(".ssh/id_rsa"), ".ssh/**");
  assert.equal(p.isSensitive(".env"), ".env");
});
