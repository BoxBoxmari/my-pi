#!/usr/bin/env node
/**
 * P1.1 architecture boundary check.
 *
 * Fails when packages/mcp-adapter contains direct filesystem or VCS business
 * capability implementation (node:fs usage for capability behavior, direct
 * git invocation) that belongs in capability packages (@my-pi/fs, @my-pi/vcs,
 * @my-pi/search). The adapter may only translate MCP I/O.
 *
 * Known-allowed imports in mcp-adapter: SDK, contracts, capability packages,
 * workspace-runtime (context wiring), zod.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function resolveRoot() {
  const index = process.argv.indexOf("--root");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ? path.resolve(value) : process.cwd();
}

const ROOT = resolveRoot();
const ADAPTER_SRC = path.join(ROOT, "packages/mcp-adapter/src");
const ADAPTER_FORBIDDEN_PATTERNS = [
  { re: /from\s+"node:fs"/, why: "node:fs business logic belongs in @my-pi/fs, not the MCP adapter" },
  { re: /from\s+"node:child_process"/, why: "subprocess execution belongs in capability packages (e.g. @my-pi/vcs git)" },
];
// Allowed node builtin imports in the adapter:
const ALLOWED_BUILTIN = new Set(["node:crypto", "node:module"]);

const FUTURE_BOUNDARY_RULES = [
  {
    root: "packages/contracts/src",
    forbidden: [
      { re: /from\s+["']@modelcontextprotocol(?:\/|["'])/, why: "contracts must remain independent of MCP transport packages" },
      { re: /from\s+["']@(?:a2a|ahp)(?:\/|["'])/, why: "contracts must remain independent of protocol adapter packages" },
      { re: /from\s+["'](?:@my-pi\/host-profiles|@ccr\/host)(?:\/|["'])/, why: "contracts must remain independent of host packages" },
    ],
  },
  {
    root: "packages/coordination-runtime/src",
    forbidden: [
      { re: /from\s+["']@modelcontextprotocol(?:\/|["'])/, why: "coordination-runtime must not import the MCP SDK" },
      { re: /from\s+["']node:fs(?:\/promises)?["']/, why: "coordination-runtime must not import node:fs for workspace behavior" },
    ],
  },
  {
    root: "packages/impact-engine/src",
    forbidden: [
      { re: /from\s+["'](?:@modelcontextprotocol|@anthropic-ai|@openai|@google|@aws-sdk|@azure|@cohere-ai|@mistralai|@langchain|@vercel\/ai|anthropic|openai)(?:\/|["'])/, why: "impact-engine must not import agent vendor SDKs" },
    ],
  },
  {
    root: "packages/evaluation-runtime/src",
    forbidden: [
      { re: /from\s+["'](?:@modelcontextprotocol|@anthropic-ai|@openai|@google|@aws-sdk|@azure|@cohere-ai|@mistralai|@langchain|@vercel\/ai|anthropic|openai)(?:\/|["'])/, why: "evaluation-runtime must not import agent vendor SDKs" },
      { re: /from\s+["']node:child_process["']|\b(?:exec|execFile|spawn|spawnSync|fork)\s*\(/, why: "evaluation-runtime must not execute arbitrary model-supplied shell" },
    ],
  },
  {
    root: "packages/code-state/src",
    forbidden: [
      { re: /from\s+["'](?:@my-pi\/host-profiles|@ccr\/host)(?:\/|["'])/, why: "code-state must not own host configuration" },
    ],
  },
  {
    root: "packages/enterprise-control-plane/src",
    forbidden: [
      { re: /from\s+["'](?:node:fs|node:fs\/promises|@my-pi\/(?:fs|vcs))["']/, why: "enterprise control-plane must not implement local filesystem/VCS behavior" },
    ],
  },
  {
    root: "apps/my-pi-enterprise/src",
    forbidden: [
      { re: /from\s+["'](?:node:fs|node:fs\/promises|@my-pi\/(?:fs|vcs))["']/, why: "enterprise control-plane must not implement local filesystem/VCS behavior" },
    ],
  },
];

let failures = 0;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full);
    else if (e.isFile() && e.name.endsWith(".ts")) await checkFile(full);
  }
}

async function checkFile(file) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  const text = await readFile(file, "utf8");
  for (const { re, why } of ADAPTER_FORBIDDEN_PATTERNS) {
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
    if (spec.startsWith("@ccr/") || spec.startsWith("@my-pi/")) continue;
    if (spec === "@modelcontextprotocol/server" || spec.startsWith("@modelcontextprotocol/")) continue;
    if (spec === "zod") continue;
    console.error(`ARCHITECTURE VIOLATION: ${rel}\n  unexpected dependency "${spec}" in mcp-adapter`);
    failures++;
  }
}

await walk(ADAPTER_SRC);
for (const rule of FUTURE_BOUNDARY_RULES) {
  await walkWithRules(path.join(ROOT, rule.root), rule.forbidden);
}

async function walkWithRules(dir, rules) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkWithRules(full, rules);
    else if (e.isFile() && e.name.endsWith(".ts")) await checkBoundaryFile(full, rules);
  }
}

async function checkBoundaryFile(file, rules) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  const text = await readFile(file, "utf8");
  for (const { re, why } of rules) {
    if (re.test(text)) {
      console.error(`ARCHITECTURE VIOLATION: ${rel}\n  ${why}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} architecture violation(s).`);
  process.exit(1);
}
console.log("architecture boundary check: PASS (mcp-adapter contains no fs/vcs business logic)");
