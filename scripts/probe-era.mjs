#!/usr/bin/env node
/**
 * R0.1.7: production MCP-era truth probe.
 *
 * Records the ACTUAL negotiated protocol era over a real stdio connection
 * using the official v2 SDK client. This is protocol-level observation, not
 * an inferred config value. Writes docs/protocol-evidence.json.
 *
 * Usage: node scripts/probe-era.mjs [workspaceDir]
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDir = process.argv[2] ?? (await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-era-")));
await fs.writeFile(path.join(workspaceDir, "probe.txt"), "era probe");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["apps/my-pi-mcp/dist/main.js", "--workspace", workspaceDir],
  cwd: repoRoot,
});
const client = new Client({ name: "era-probe", version: "0.0.1" });
await client.connect(transport);

const evidence = {
  generatedAt: new Date().toISOString(),
  commit: (await import("node:child_process")).execSync("git rev-parse HEAD", { cwd: repoRoot }).toString().trim(),
  sdk: {
    serverPackage: (await import("node:fs/promises")).readFile(path.join(repoRoot, "node_modules/@modelcontextprotocol/server/package.json"), "utf8").then(JSON.parse).then((p) => p.version),
    clientPackage: (await import("node:fs/promises")).readFile(path.join(repoRoot, "node_modules/@modelcontextprotocol/client/package.json"), "utf8").then(JSON.parse).then((p) => p.version),
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  },
  observed: {
    clientNegotiatedEra: client.getNegotiatedProtocolVersion() ?? "undefined",
  },
  hostProbe: {
    claudeCode: "NOT-CAPTURED", // requires running Claude Code with an MCP tap
    openCode: "NOT-CAPTURED",
  },
  nodeVersion: process.version,
  platform: process.platform,
};

// Resolve the async package versions.
evidence.sdk.serverPackage = await evidence.sdk.serverPackage;
evidence.sdk.clientPackage = await evidence.sdk.clientPackage;

const out = path.join(repoRoot, "docs", "protocol-evidence.json");
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(evidence, null, 2), "utf8");
console.log("negotiated era over stdio:", evidence.observed.clientNegotiatedEra);
console.log("written:", out);

await client.close();
await fs.rm(workspaceDir, { recursive: true, force: true });
