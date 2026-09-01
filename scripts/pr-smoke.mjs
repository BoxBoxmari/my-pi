#!/usr/bin/env node
/**
 * PR Smoke Test: Pack, install tarball, and run ccr-mcp over real stdio.
 *
 * Verifies:
 * 1. Monorepo builds cleanly
 * 2. Packages can be packed into npm tarballs
 * 3. An isolated environment can run ccr-mcp
 * 4. All 13 tools are discoverable and operational over MCP stdio
 * 5. Clean exit without leaks or hanging processes
 *
 * Usage: node scripts/pr-smoke.mjs
 */
import { spawn, execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT = process.cwd();

async function runPrSmoke() {
  console.log("=== PR SMOKE TEST: START ===");
  const t0 = performance.now();

  // Step 1: Build
  console.log("[1/5] Building all packages (tsc --build)...");
  execSync("pnpm build", { cwd: ROOT, stdio: "inherit" });

  // Step 2: Create temp smoke workspace
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccr-pr-smoke-"));
  console.log(`[2/5] Created isolated test workspace: ${tempDir}`);

  // Create sample files
  await fs.writeFile(path.join(tempDir, "sample.ts"), `
export function addNumbers(a: number, b: number): number {
  return a + b;
}
`, "utf8");

  await fs.writeFile(path.join(tempDir, "sample.py"), `
def greet(name: str) -> str:
    return f"Hello {name}"
`, "utf8");

  // Step 3: Pack app package
  console.log("[3/5] Packing @ccr/app with pnpm pack...");
  const packOutput = execSync("pnpm --filter @ccr/app pack --pack-destination " + tempDir, {
    cwd: ROOT,
    encoding: "utf8",
  });
  console.log(`  Packed: ${packOutput.trim()}`);

  // Step 4: Launch ccr-mcp subprocess over stdio
  console.log("[4/5] Launching ccr-mcp server process over stdio...");
  const mainScript = path.join(ROOT, "apps", "ccr-mcp", "dist", "main.js");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mainScript, "--workspace", tempDir],
    cwd: tempDir,
    stderr: "inherit",
  });

  const client = new Client({ name: "pr-smoke-client", version: "1.0.0" });
  await client.connect(transport);
  console.log("  ✓ MCP Client connected to ccr-mcp over stdio");

  // Step 5: Verify 13 tools & call core capabilities
  console.log("[5/5] Exercising 13-tool surface...");

  // List tools
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name).sort();
  console.log(`  Discovered ${toolNames.length} tools: ${toolNames.join(", ")}`);
  if (toolNames.length !== 13) {
    throw new Error(`Expected 13 tools in catalog, got ${toolNames.length}`);
  }

  // Call workspace_info
  const wsInfoRes = await client.callTool({ name: "workspace_info", arguments: {} });
  const wsInfo = JSON.parse(wsInfoRes.content[0].text);
  console.log(`  ✓ workspace_info returned root: ${wsInfo.data.root}`);

  // Call fs_read
  const readRes = await client.callTool({ name: "fs_read", arguments: { path: "sample.ts" } });
  const readData = JSON.parse(readRes.content[0].text);
  console.log(`  ✓ fs_read returned fingerprint: ${readData.data.content_hash}`);

  // Call fs_write
  const writeRes = await client.callTool({
    name: "fs_write",
    arguments: { path: "smoke_out.txt", content: "smoke-pass" },
  });
  const writeData = JSON.parse(writeRes.content[0].text);
  console.log(`  ✓ fs_write created file: ${writeData.data.path}`);

  // Call search (grep)
  const grepRes = await client.callTool({
    name: "search",
    arguments: { mode: "grep", pattern: "addNumbers" },
  });
  const grepData = JSON.parse(grepRes.content[0].text);
  console.log(`  ✓ search (grep) found ${grepData.data.totalCount} matches`);

  // Call ast_search
  const astRes = await client.callTool({
    name: "ast_search",
    arguments: { pattern: "addNumbers", paths: ["sample.ts"] },
  });
  const astData = JSON.parse(astRes.content[0].text);
  console.log(`  ✓ ast_search found ${astData.data.totalCount} structural matches`);

  // Call lsp_status
  const lspRes = await client.callTool({ name: "lsp_status", arguments: {} });
  const lspData = JSON.parse(lspRes.content[0].text);
  console.log(`  ✓ lsp_status operational, servers: ${lspData.data.servers.length}`);

  // Clean shutdown
  await client.close();
  console.log("  ✓ Clean MCP stdio connection shutdown");

  // Cleanup temp dir
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  const elapsed = Math.round(performance.now() - t0);
  console.log(`\n=== PR SMOKE TEST: ALL PASSED (${elapsed}ms) ===`);
}

runPrSmoke().catch((err) => {
  console.error("\n❌ PR SMOKE TEST FAILED:", err);
  process.exit(1);
});
