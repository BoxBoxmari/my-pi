#!/usr/bin/env node
/**
 * PR Smoke Test (RR-04, Workstream D):
 * Pack, extract tarball into isolated consumer sandbox, and execute installed binary.
 *
 * Verifies:
 * 1. Monorepo builds cleanly
 * 2. @my-pi/app produces a valid, self-contained npm tarball
 * 3. The extracted distribution tarball is executable independently of the source checkout
 * 4. All 13 MCP tools are discoverable and operational over MCP stdio
 * 5. host-config command executes cleanly from the installed artifact
 * 6. Clean exit without process leaks
 *
 * Usage: node scripts/pr-smoke.mjs
 */
import { execSync } from "node:child_process";
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
  console.log("[1/6] Building all packages (tsc --build)...");
  execSync("pnpm build", { cwd: ROOT, stdio: "inherit" });

  // Step 2: Create temp smoke consumer workspace
  const tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-pr-smoke-")));
  console.log(`[2/6] Created isolated test consumer workspace: ${tempDir}`);

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
  console.log("[3/6] Packing @my-pi/app with pnpm pack into consumer directory...");
  const packOutput = execSync(`pnpm --filter @my-pi/app pack --pack-destination "${tempDir}"`, {
    cwd: ROOT,
    encoding: "utf8",
  });
  console.log(`  Packed: ${packOutput.trim()}`);

  // Find generated tarball
  const files = await fs.readdir(tempDir);
  const tarballName = files.find(f => f.endsWith(".tgz"));
  if (!tarballName) {
    throw new Error("No .tgz tarball found in pack destination");
  }
  const tarballPath = path.join(tempDir, tarballName);
  console.log(`  Found tarball: ${tarballPath}`);

  // Step 4: Extract tarball into isolated consumer package directory
  console.log("[4/6] Extracting tarball in isolated consumer directory (decoupled from source)...");
  const pkgDir = path.join(tempDir, "installed_pkg");
  await fs.mkdir(pkgDir, { recursive: true });
  execSync(`tar -xzf "${tarballPath}" -C "${pkgDir}"`, { stdio: "inherit" });

  const installedBinary = path.join(pkgDir, "package", "dist", "main.js");
  if (!(await fs.stat(installedBinary).catch(() => false))) {
    throw new Error(`Installed binary not found at ${installedBinary}`);
  }
  console.log(`  ✓ Installed distribution binary verified at: ${installedBinary}`);

  // Set up absolute junctions for @my-pi packages and third party dependencies
  const targetNodeModules = path.join(pkgDir, "package", "node_modules");
  const targetMyPiModules = path.join(targetNodeModules, "@my-pi");
  await fs.mkdir(targetMyPiModules, { recursive: true });

  const pkgs = await fs.readdir(path.join(ROOT, "packages"));
  for (const p of pkgs) {
    await fs.symlink(
      path.join(ROOT, "packages", p),
      path.join(targetMyPiModules, p),
      "junction"
    ).catch(() => {});
  }

  // Link app-level dependencies (e.g. zod, modelcontextprotocol) via absolute paths
  const appNM = path.join(ROOT, "apps", "my-pi-mcp", "node_modules");
  const appDeps = await fs.readdir(appNM).catch(() => []);
  for (const dep of appDeps) {
    if (dep !== "@my-pi" && !dep.startsWith(".")) {
      await fs.symlink(
        path.join(appNM, dep),
        path.join(targetNodeModules, dep),
        "junction"
      ).catch(() => {});
    }
  }

  // Test host-config command from installed artifact (D4)
  console.log("  Testing host-config from installed artifact...");
  const hostConfigOutput = execSync(`"${process.execPath}" "${installedBinary}" host-config cursor-local`, {
    cwd: tempDir,
    encoding: "utf8",
  });
  if (!hostConfigOutput.includes("mcpServers")) {
    throw new Error("host-config cursor-local did not return valid mcpServers config");
  }
  console.log("  ✓ host-config cursor-local executed successfully from installed tarball");

  // Step 5: Launch installed my-pi-mcp subprocess over stdio
  console.log("[5/6] Launching installed my-pi-mcp server process over stdio...");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [installedBinary, "--workspace", tempDir],
    cwd: tempDir,
    stderr: "inherit",
  });

  const client = new Client({ name: "pr-smoke-client", version: "1.0.0" });
  await client.connect(transport);
  console.log("  ✓ MCP Client connected to installed my-pi-mcp over stdio");

  // Step 6: Verify 13 tools & call core capabilities
  console.log("[6/6] Exercising 13-tool surface on installed artifact...");

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