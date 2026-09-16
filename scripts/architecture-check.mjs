#!/usr/bin/env node
/**
 * P1.1 architecture boundary check (Issue #26: syntax-sensitive enforcement).
 *
 * Parses governed TypeScript sources with the TypeScript compiler API and
 * extracts module specifiers from syntax nodes, so boundaries cannot be
 * bypassed through quote style or alternate import forms.
 *
 * Covered syntax (per governed file):
 * - static `import ... from 'pkg'` (incl. side-effect and `import type`)
 * - `export ... from 'pkg'` / `export * from 'pkg'`
 * - dynamic `import('pkg')` (literal) — non-literal fails closed
 * - CommonJS `require('pkg')` (literal) — non-literal fails closed
 * - package imports and `node:` built-ins
 *
 * Invalid/unparseable source is a deterministic failure (fail-closed).
 * Diagnostics report file, line/character, dependency, syntax kind, rule.
 */
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function resolveRoot() {
  const index = process.argv.indexOf("--root");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ? path.resolve(value) : process.cwd();
}

const ROOT = resolveRoot();

// ---------------------------------------------------------------------------
// Syntax extraction (parser answers WHAT dependency syntax exists)
// ---------------------------------------------------------------------------

function scriptKindFor(fileName) {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".mts")) return ts.ScriptKind.External;
  if (fileName.endsWith(".cts")) return ts.ScriptKind.External;
  return ts.ScriptKind.TS;
}

/**
 * @typedef {{ specifier: string, kind: 'import'|'export'|'dynamic-import'|'require',
 *   line: number, character: number, nonLiteral?: boolean }} ModuleReference
 */

function collectModuleReferences(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ESNext,
    true,
    scriptKindFor(fileName),
  );
  const parseErrors = (sourceFile.parseDiagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  /** @type {ModuleReference[]} */
  const refs = [];
  /** @type {{ name: string, line: number, character: number }[]} */
  const calls = [];

  function posOf(node) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { line: line + 1, character: character + 1 };
  }

  function stringLiteralText(node) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return undefined;
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const spec = stringLiteralText(node.moduleSpecifier);
      const pos = posOf(node);
      if (spec !== undefined) refs.push({ specifier: spec, kind: "import", ...pos });
      else refs.push({ specifier: "<non-literal>", kind: "import", ...pos, nonLiteral: true });
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const spec = stringLiteralText(node.moduleSpecifier);
        const pos = posOf(node);
        if (spec !== undefined) refs.push({ specifier: spec, kind: "export", ...pos });
        else refs.push({ specifier: "<non-literal>", kind: "export", ...pos, nonLiteral: true });
      }
    } else if (ts.isCallExpression(node)) {
      // Dynamic import: import('pkg')
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const pos = posOf(node);
        const first = node.arguments[0];
        const spec = first ? stringLiteralText(first) : undefined;
        if (spec !== undefined) refs.push({ specifier: spec, kind: "dynamic-import", ...pos });
        else refs.push({ specifier: "<non-literal>", kind: "dynamic-import", ...pos, nonLiteral: true });
      }
      // CommonJS require('pkg')
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const first = node.arguments[0];
        // Only treat single-arg calls as require references; other arities
        // fall through to generic call tracking (no specifier to govern).
        if (node.arguments.length === 1 && first) {
          const spec = stringLiteralText(first);
          const pos = posOf(node);
          if (spec !== undefined) refs.push({ specifier: spec, kind: "require", ...pos });
          else refs.push({ specifier: "<non-literal>", kind: "require", ...pos, nonLiteral: true });
        }
      }
      // Track bare exec/spawn-family calls for the evaluation-runtime rule.
      if (ts.isIdentifier(node.expression) && ["exec", "execFile", "spawn", "spawnSync", "fork"].includes(node.expression.text)) {
        const pos = posOf(node);
        calls.push({ name: node.expression.text, ...pos });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { refs, calls, parseErrors };
}

// ---------------------------------------------------------------------------
// Policy (architecture rules answer WHETHER a dependency is allowed)
// ---------------------------------------------------------------------------

const ALLOWED_BUILTIN = new Set(["node:crypto", "node:module"]);

const ADAPTER_FORBIDDEN_SPEC = [
  { test: (s) => s === "node:fs" || s.startsWith("node:fs/"), why: "node:fs business logic belongs in @my-pi/fs, not the MCP adapter" },
  { test: (s) => s === "node:child_process" || s.startsWith("node:child_process/"), why: "subprocess execution belongs in capability packages (e.g. @my-pi/vcs git)" },
];

function isRelative(spec) {
  return spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
}

function startsWithAny(spec, prefixes) {
  return prefixes.some((p) => spec === p || spec.startsWith(p + "/"));
}

const VENDOR_PREFIXES = [
  "@modelcontextprotocol", "@anthropic-ai", "@openai", "@google", "@aws-sdk",
  "@azure", "@cohere-ai", "@mistralai", "@langchain", "@vercel/ai",
  "anthropic", "openai",
];

const FUTURE_BOUNDARY_RULES = [
  {
    root: "packages/contracts/src",
    check(spec) {
      if (startsWithAny(spec, ["@modelcontextprotocol"])) return "contracts must remain independent of MCP transport packages";
      if (startsWithAny(spec, ["@a2a", "@ahp"])) return "contracts must remain independent of protocol adapter packages";
      if (startsWithAny(spec, ["@my-pi/host-profiles", "@ccr/host"])) return "contracts must remain independent of host packages";
      return undefined;
    },
  },
  {
    root: "packages/coordination-runtime/src",
    check(spec) {
      if (startsWithAny(spec, ["@modelcontextprotocol"])) return "coordination-runtime must not import the MCP SDK";
      if (spec === "node:fs" || spec.startsWith("node:fs/")) return "coordination-runtime must not import node:fs for workspace behavior";
      return undefined;
    },
  },
  {
    root: "packages/impact-engine/src",
    check(spec) {
      if (startsWithAny(spec, VENDOR_PREFIXES)) return "impact-engine must not import agent vendor SDKs";
      return undefined;
    },
  },
  {
    root: "packages/evaluation-runtime/src",
    check(spec) {
      if (startsWithAny(spec, VENDOR_PREFIXES)) return "evaluation-runtime must not import agent vendor SDKs";
      if (spec === "node:child_process" || spec.startsWith("node:child_process/")) return "evaluation-runtime must not execute arbitrary model-supplied shell";
      return undefined;
    },
    forbidShellCalls: true,
  },
  {
    root: "packages/code-state/src",
    check(spec) {
      if (startsWithAny(spec, ["@my-pi/host-profiles", "@ccr/host"])) return "code-state must not own host configuration";
      return undefined;
    },
  },
  {
    root: "packages/enterprise-control-plane/src",
    check(spec) {
      if (spec === "node:fs" || spec.startsWith("node:fs/") || startsWithAny(spec, ["@my-pi/fs", "@my-pi/vcs"])) {
        return "enterprise control-plane must not implement local filesystem/VCS behavior";
      }
      return undefined;
    },
  },
  {
    root: "apps/my-pi-enterprise/src",
    check(spec) {
      if (spec === "node:fs" || spec.startsWith("node:fs/") || startsWithAny(spec, ["@my-pi/fs", "@my-pi/vcs"])) {
        return "enterprise control-plane must not implement local filesystem/VCS behavior";
      }
      return undefined;
    },
  },
];

let failures = 0;
const GOVERNED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

function isGovernedFile(name) {
  return [...GOVERNED_EXTENSIONS].some((ext) => name.endsWith(ext));
}

function report(rel, ref, why) {
  const where = ref ? `${rel}:${ref.line}:${ref.character}` : rel;
  const dep = ref ? `\n  dependency: ${ref.specifier}` : "";
  const syntax = ref ? `\n  syntax: ${ref.kind}` : "";
  console.error(`ARCHITECTURE VIOLATION: ${where}${dep}${syntax}\n  rule: ${why}`);
  failures++;
}

async function checkAdapterFile(file) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  const text = await readFile(file, "utf8");
  const { refs, calls, parseErrors } = collectModuleReferences(text, file);
  void calls;
  if (parseErrors.length > 0) {
    report(rel, undefined, `mcp-adapter source is unparseable (${parseErrors.length} syntax error(s)); failing closed`);
    return;
  }
  for (const ref of refs) {
    if (ref.nonLiteral) {
      report(rel, ref, "mcp-adapter dynamic dependency specifier is not a string literal; failing closed");
      continue;
    }
    const spec = ref.specifier;
    if (isRelative(spec)) continue;
    const forbidden = ADAPTER_FORBIDDEN_SPEC.find((r) => r.test(spec));
    if (forbidden) {
      report(rel, ref, forbidden.why);
      continue;
    }
    if (spec.startsWith("node:")) {
      if (!ALLOWED_BUILTIN.has(spec)) {
        report(rel, ref, `unexpected builtin import "${spec}" in mcp-adapter`);
      }
      continue;
    }
    if (spec.startsWith("@ccr/") || spec.startsWith("@my-pi/")) continue;
    if (spec === "@modelcontextprotocol/server" || spec.startsWith("@modelcontextprotocol/")) continue;
    if (spec === "zod") continue;
    report(rel, ref, `unexpected dependency "${spec}" in mcp-adapter`);
  }
}

async function checkBoundaryFile(file, rule) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  const text = await readFile(file, "utf8");
  const { refs, calls, parseErrors } = collectModuleReferences(text, file);
  if (parseErrors.length > 0) {
    report(rel, undefined, `${rule.root} source is unparseable (${parseErrors.length} syntax error(s)); failing closed`);
    return;
  }
  for (const ref of refs) {
    if (ref.nonLiteral) {
      report(rel, ref, `${rule.root} dynamic dependency specifier is not a string literal; failing closed`);
      continue;
    }
    const why = rule.check(ref.specifier);
    if (why) report(rel, ref, why);
  }
  if (rule.forbidShellCalls) {
    for (const call of calls) {
      report(rel, { specifier: `${call.name}(...)`, kind: "require", line: call.line, character: call.character }, "evaluation-runtime must not execute arbitrary model-supplied shell");
    }
  }
}

async function walk(dir, visit) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") console.warn(`WARN: architecture-check: missing dir, skipping (fail-open): ${path.relative(ROOT, dir) || dir}`);
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, visit);
    else if (e.isFile() && isGovernedFile(e.name)) await visit(full);
  }
}

const ADAPTER_SRC = path.join(ROOT, "packages/mcp-adapter/src");
await walk(ADAPTER_SRC, checkAdapterFile);
for (const rule of FUTURE_BOUNDARY_RULES) {
  const dir = path.join(ROOT, rule.root);
  let missing = false;
  try {
    await readdir(dir);
  } catch (err) {
    if (err?.code === "ENOENT") {
      console.warn(`WARN: architecture-check: boundary root missing, rule not enforced (fail-open): ${rule.root}`);
      missing = true;
    }
  }
  if (!missing) await walk(dir, (file) => checkBoundaryFile(file, rule));
}

if (failures > 0) {
  console.error(`\n${failures} architecture violation(s).`);
  process.exit(1);
}
console.log("architecture boundary check: PASS (mcp-adapter contains no fs/vcs business logic)");
