#!/usr/bin/env node
/**
 * P1.1 architecture boundary check.
 *
 * Fails when packages/mcp-adapter contains direct filesystem or VCS business
 * capability implementation (node:fs usage for capability behavior, direct
 * git invocation) that belongs in capability packages (@ccr/fs, @ccr/vcs,
 * @ccr/search). The adapter may only translate MCP I/O.
 *
 * Known-allowed imports in mcp-adapter: SDK, contracts, capability packages,
 * workspace-runtime (context wiring), zod.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ADAPTER_SRC = path.resolve("packages/mcp-adapter/src");
const FORBIDDEN_PATTERNS = [
  { re: /from\s+"node:fs"/, why: "node:fs business logic belongs in @ccr/fs, not the MCP adapter" },
  { re: /from\s+"node:child_process"/, why: "subprocess execution belongs in capability packages (e.g. @ccr/vcs git)" },
];
// Allowed node builtin imports in the adapter:
const ALLOWED_BUILTIN = new Set(["node:crypto", "node:module"]);

let failures = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full);
    else if (e.isFile() && e.name.endsWith(".ts")) await checkFile(full);
  }
}

async function checkFile(file) {
  const rel = path.relative(process.cwd(), file);
  const text = await readFile(file, "utf8");
  for (const { re, why } of FORBIDDEN_PATTERNS) {
    if (re.test(text)) {
      console.error(`ARCHITECTURE VIOLATION: ${rel}\n  ${why}`);
      failures++;
    }
  }
  // Every non-builtin import must be an allowed package.
  const importRe = /from\s+"(@[^"]+|[^."][^"]*)"/g;
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[1];
    if (spec.startsWith("node:")) {
      if (!ALLOWED_BUILTIN.has(spec)) {
        console.error(`ARCHITECTURE VIOLATION: ${rel}\n  unexpected builtin import "${spec}" in mcp-adapter`);
        failures++;
      }
      continue;
    }
    if (spec.startsWith("@ccr/")) continue;
    if (spec === "@modelcontextprotocol/server" || spec.startsWith("@modelcontextprotocol/")) continue;
    if (spec === "zod") continue;
    console.error(`ARCHITECTURE VIOLATION: ${rel}\n  unexpected dependency "${spec}" in mcp-adapter`);
    failures++;
  }
}

await walk(ADAPTER_SRC);
if (failures > 0) {
  console.error(`\n${failures} architecture violation(s).`);
  process.exit(1);
}
console.log("architecture boundary check: PASS (mcp-adapter contains no fs/vcs business logic)");
