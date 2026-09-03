#!/usr/bin/env node
/**
 * Clean-install package smoke test (RR-04, Workstream D).
 *
 * With no arguments this script builds and packs a temporary PR artifact.
 * Release qualification passes --artifact <path> so the artifact is tested
 * without being repacked.
 */
import { execFileSync, execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { gunzip } from "node:zlib";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT = process.cwd();
const gunzipAsync = promisify(gunzip);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function shellQuote(value) {
  const text = String(value);
  if (process.platform === "win32") {
    if (/["`\r\n%!&|<>^]/.test(text)) throw new Error(`unsafe shell path: ${text}`);
    return `"${text}"`;
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function runShellCommand(command, args, options) {
  return execSync([command, ...args.map(shellQuote)].join(" "), options);
}

function parseArgs(args) {
  let artifact = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--artifact") {
      if (!args[index + 1]) throw new Error("--artifact requires a TGZ path");
      artifact = path.resolve(ROOT, args[index + 1]);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${args[index]}`);
    }
  }
  return { artifact };
}

function readTarString(buffer, offset, length) {
  const end = Math.min(offset + length, buffer.length);
  let cursor = offset;
  while (cursor < end && buffer[cursor] !== 0) cursor += 1;
  return buffer.subarray(offset, cursor).toString("utf8");
}

function parseTarSize(buffer, offset, length) {
  const text = readTarString(buffer, offset, length).trim();
  if (!text) return 0;
  const size = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid tar entry size: ${text}`);
  return size;
}

function parsePaxPath(data) {
  const text = data.toString("utf8");
  const match = text.match(/(?:^|\n)\d+ path=([^\n]*)\n?/);
  return match?.[1] ?? null;
}

function parseTar(buffer) {
  const entries = [];
  let offset = 0;
  let longName = null;
  let paxPath = null;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const baseName = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const headerName = prefix ? `${prefix}/${baseName}` : baseName;
    const type = String.fromCharCode(header[156] || 48);
    const size = parseTarSize(header, 124, 12);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) throw new Error(`truncated tar entry: ${headerName}`);
    const data = buffer.subarray(dataStart, dataEnd);
    const nextOffset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = readTarString(data, 0, data.length);
    } else if (type === "x") {
      paxPath = parsePaxPath(data);
    } else if (type !== "g") {
      entries.push({
        name: paxPath ?? longName ?? headerName,
        type,
        size,
        data: Buffer.from(data),
      });
      longName = null;
      paxPath = null;
    }

    offset = nextOffset;
  }

  return entries;
}

async function readTarballEntries(tarballPath) {
  return parseTar(await gunzipAsync(await fs.readFile(tarballPath)));
}

function packageRelativePath(name) {
  const normalized = name.replaceAll("\\", "/");
  if (normalized === "package/" || normalized === "package") return "";
  if (!normalized.startsWith("package/")) throw new Error(`tarball entry is outside package/: ${name}`);
  return normalized.slice("package/".length).replace(/\/$/, "");
}

function isAllowedEntry(relativePath) {
  return relativePath === "" ||
    relativePath === "dist" ||
    relativePath === "package.json" ||
    relativePath === "README.md" ||
    relativePath === "LICENSE" ||
    relativePath === "THIRD-PARTY-NOTICES.txt" ||
    /^dist\/.+\.(?:js|d\.ts|map)$/.test(relativePath);
}

export async function validateTarball(tarballPath, expected) {
  const entries = await readTarballEntries(tarballPath);
  const files = new Map();
  for (const entry of entries) {
    const relativePath = packageRelativePath(entry.name);
    if (entry.type === "1" || entry.type === "2") {
      throw new Error(`tarball contains a link entry: ${entry.name}`);
    }
    if (entry.type !== "0" && entry.type !== "5" && entry.type !== "\0") {
      throw new Error(`tarball contains unsupported entry type ${entry.type} for ${entry.name}`);
    }
    if (!isAllowedEntry(relativePath)) throw new Error(`tarball entry is outside the distribution allowlist: ${relativePath}`);
    if (entry.type !== "5" && relativePath) {
      if (files.has(relativePath)) throw new Error(`tarball contains a duplicate entry: ${relativePath}`);
      files.set(relativePath, entry.data);
    }
  }

  const requiredFiles = ["package.json", "README.md", "LICENSE", "dist/main.js", "dist/main.js.map"];
  const missingFiles = requiredFiles.filter((file) => !files.has(file));
  if (missingFiles.length > 0) throw new Error(`tarball is missing required distribution files: ${missingFiles.join(", ")}`);
  const manifestBytes = files.get("package.json");
  const mainBytes = files.get("dist/main.js");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.name !== expected.name || manifest.version !== expected.version) {
    throw new Error(`artifact package identity ${manifest.name}@${manifest.version} does not match ${expected.name}@${expected.version}`);
  }
  if (!mainBytes.toString("utf8").startsWith("#!/usr/bin/env node\n")) {
    throw new Error("artifact entrypoint is missing its Node.js shebang");
  }
  const sourceMapBytes = files.get("dist/main.js.map");
  if (sourceMapBytes) {
    const sourceMap = JSON.parse(sourceMapBytes.toString("utf8"));
    if (sourceMap.version !== 3 || (sourceMap.file && sourceMap.file !== "main.js") || !Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0) {
      throw new Error("artifact source map does not describe dist/main.js");
    }
    if (!mainBytes.toString("utf8").includes("//# sourceMappingURL=main.js.map")) {
      throw new Error("artifact JavaScript is missing its source map reference");
    }
  }
  return { manifest, files };
}

async function assertNoSymlinks(root) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    const details = await fs.lstat(entryPath);
    if (details.isSymbolicLink()) throw new Error(`installed package contains a symlink: ${entryPath}`);
    if (details.isDirectory()) await assertNoSymlinks(entryPath);
  }
}

async function readExpectedPackage() {
  const [policy, appPackage] = await Promise.all([
    fs.readFile(path.join(ROOT, "release", "release-policy.json"), "utf8").then((text) => JSON.parse(text)),
    fs.readFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), "utf8").then((text) => JSON.parse(text)),
  ]);
  return { name: appPackage.name, version: policy.version };
}

export async function runPrSmoke() {
  const { artifact: suppliedArtifact } = parseArgs(process.argv.slice(2));
  const expected = await readExpectedPackage();
  console.log(`=== PR SMOKE TEST: START (${suppliedArtifact ? "provided artifact" : "pack-on-demand"}) ===`);
  const t0 = performance.now();
  let tempDir;
  let client;

  try {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-pr-smoke-")));
    console.log(`[1/6] Created isolated test consumer workspace: ${tempDir}`);

    await fs.writeFile(path.join(tempDir, "sample.ts"), `
export function addNumbers(a: number, b: number): number {
  return a + b;
}
`, "utf8");
    await fs.writeFile(path.join(tempDir, "sample.py"), `
def greet(name: str) -> str:
    return f"Hello {name}"
`, "utf8");

    let artifactPath = suppliedArtifact;
    if (artifactPath) {
      console.log(`[2/6] Using supplied release artifact without repacking: ${artifactPath}`);
      const details = await fs.stat(artifactPath).catch(() => null);
      if (!details?.isFile() || !artifactPath.endsWith(".tgz")) throw new Error(`artifact is not an existing TGZ file: ${artifactPath}`);
    } else {
      console.log("[2/6] Building all packages (tsc --build + locked esbuild API)...");
      runShellCommand(pnpmCommand, ["build"], { cwd: ROOT, stdio: "inherit" });
      console.log("[3/6] Packing @koonwang03/my-pi into the isolated consumer workspace...");
      const packOutput = runShellCommand(pnpmCommand, ["--filter", "@koonwang03/my-pi", "pack", "--pack-destination", tempDir], {
        cwd: ROOT,
        encoding: "utf8",
      });
      console.log(`  Packed: ${packOutput.trim()}`);
      const tarballs = (await fs.readdir(tempDir)).filter((file) => file.endsWith(".tgz"));
      if (tarballs.length !== 1) throw new Error(`expected exactly one generated TGZ, found ${tarballs.length}`);
      artifactPath = path.join(tempDir, tarballs[0]);
    }

    console.log(`[4/6] Validating and clean-installing exact package artifact...`);
    await validateTarball(artifactPath, expected);
    const consumerAppDir = path.join(tempDir, "consumer_app");
    await fs.mkdir(consumerAppDir, { recursive: true });
    await fs.writeFile(
      path.join(consumerAppDir, "package.json"),
      JSON.stringify({ name: "consumer-smoke-app", version: "1.0.0", type: "module" }, null, 2),
      "utf8",
    );
    runShellCommand(npmCommand, ["install", artifactPath, "--no-audit", "--no-fund", "--ignore-scripts"], {
      cwd: consumerAppDir,
      stdio: "inherit",
    });

    const installedPackageDir = path.join(consumerAppDir, "node_modules", expected.name);
    const installedManifest = JSON.parse(await fs.readFile(path.join(installedPackageDir, "package.json"), "utf8"));
    if (installedManifest.name !== expected.name || installedManifest.version !== expected.version) {
      throw new Error(`installed package identity ${installedManifest.name}@${installedManifest.version} does not match ${expected.name}@${expected.version}`);
    }
    await assertNoSymlinks(installedPackageDir);
    const installedBinary = path.join(installedPackageDir, "dist", "main.js");
    if (!(await fs.stat(installedBinary).catch(() => false))) throw new Error(`installed binary not found at ${installedBinary}`);
    console.log(`  ✓ Installed distribution binary verified at: ${installedBinary}`);

    const hostConfigOutput = execFileSync(process.execPath, [installedBinary, "host-config", "cursor-local"], {
      cwd: tempDir,
      encoding: "utf8",
    });
    if (!hostConfigOutput.includes("mcpServers")) throw new Error("host-config cursor-local did not return valid mcpServers config");
    console.log("  ✓ host-config cursor-local executed successfully from installed artifact");

    console.log("[5/6] Launching installed my-pi-mcp server process over stdio...");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [installedBinary, "--workspace", tempDir],
      cwd: tempDir,
      stderr: "inherit",
    });
    client = new Client({ name: "pr-smoke-client", version: "1.0.0" });
    await client.connect(transport);
    console.log("  ✓ MCP Client connected to installed my-pi-mcp over stdio");

    console.log("[6/6] Exercising 13-tool surface on installed artifact...");
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();
    console.log(`  Discovered ${toolNames.length} tools: ${toolNames.join(", ")}`);
    if (toolNames.length !== 13) throw new Error(`Expected 13 tools in catalog, got ${toolNames.length}`);

    const wsInfoRes = await client.callTool({ name: "workspace_info", arguments: {} });
    const wsInfo = JSON.parse(wsInfoRes.content[0].text);
    console.log(`  ✓ workspace_info returned root: ${wsInfo.data.root}`);
    const readRes = await client.callTool({ name: "fs_read", arguments: { path: "sample.ts" } });
    const readData = JSON.parse(readRes.content[0].text);
    console.log(`  ✓ fs_read returned fingerprint: ${readData.data.content_hash}`);
    const writeRes = await client.callTool({ name: "fs_write", arguments: { path: "smoke_out.txt", content: "smoke-pass" } });
    const writeData = JSON.parse(writeRes.content[0].text);
    console.log(`  ✓ fs_write created file: ${writeData.data.path}`);
    const grepRes = await client.callTool({ name: "search", arguments: { mode: "grep", pattern: "addNumbers" } });
    const grepData = JSON.parse(grepRes.content[0].text);
    console.log(`  ✓ search (grep) found ${grepData.data.totalCount} matches`);
    const astRes = await client.callTool({ name: "ast_search", arguments: { pattern: "addNumbers", paths: ["sample.ts"] } });
    const astData = JSON.parse(astRes.content[0].text);
    console.log(`  ✓ ast_search found ${astData.data.totalCount} structural matches`);
    const lspRes = await client.callTool({ name: "lsp_status", arguments: {} });
    const lspData = JSON.parse(lspRes.content[0].text);
    console.log(`  ✓ lsp_status operational, servers: ${lspData.data.servers.length}`);
    const vcsStatusRes = await client.callTool({ name: "vcs_status", arguments: {} });
    if (!vcsStatusRes.content?.[0]?.text) throw new Error("vcs_status did not return a typed result");
    console.log("  ✓ vcs_status returned a safe result for the isolated non-git workspace");
    const vcsDiffRes = await client.callTool({ name: "vcs_diff", arguments: {} });
    if (!vcsDiffRes.content?.[0]?.text) throw new Error("vcs_diff did not return a typed result");
    console.log("  ✓ vcs_diff returned a safe result for the isolated non-git workspace");
    await client.close();
    client = null;
    console.log("  ✓ Clean MCP stdio connection shutdown");

    const elapsed = Math.round(performance.now() - t0);
    console.log(`\n=== PR SMOKE TEST: ALL PASSED (${elapsed}ms) ===`);
  } finally {
    if (client) await client.close().catch(() => {});
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPrSmoke().catch((err) => {
    console.error("\nPR SMOKE TEST FAILED:", err);
    process.exitCode = 1;
  });
}
