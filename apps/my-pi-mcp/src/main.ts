#!/usr/bin/env node
/**
 * CLI entry for my-pi-mcp and host-config.
 * V1 transport: stdio only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { createFoundationCapabilities, MyPiServer } from "@my-pi/mcp-adapter";
import { REQUIRED_PROFILES, renderProfile } from "@my-pi/host-profiles";

export interface CliOptions {
  command: "mcp" | "host-config";
  workspace?: string;
  profileId?: string;
  allowCwd?: boolean;
  securityProfile?: "read-only" | "trusted";
}

function resolveWorkspaceRootFromEnv(): string | undefined {
  if (process.env.MY_PI_WORKSPACE_ROOT?.trim()) return process.env.MY_PI_WORKSPACE_ROOT;
  if (process.env.CCR_WORKSPACE_ROOT?.trim()) {
    console.error("[my-pi] warning: CCR_WORKSPACE_ROOT is deprecated; use MY_PI_WORKSPACE_ROOT (supported for 1 major)");
    return process.env.CCR_WORKSPACE_ROOT;
  }
  return undefined;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  if (args[0] === "host-config") {
    return { command: "host-config", profileId: args[1] };
  }
  let workspace = resolveWorkspaceRootFromEnv();
  let allowCwd = false;
  let securityProfile: CliOptions["securityProfile"] = "read-only";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--workspace requires a path");
      workspace = value;
      i++;
    } else if (arg?.startsWith("--workspace=")) {
      const value = arg.slice("--workspace=".length);
      if (!value) throw new Error("--workspace requires a path");
      workspace = value;
    } else if (arg === "--allow-cwd") {
      allowCwd = true;
    } else if (arg === "--transport") {
      if (args[i + 1] !== "stdio") throw new Error("only --transport stdio is supported");
      i++;
    } else if (arg === "--security-profile") {
      const value = args[i + 1];
      if (value !== "read-only" && value !== "trusted") throw new Error("--security-profile must be read-only or trusted");
      securityProfile = value;
      i++;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { command: "mcp", workspace, allowCwd, securityProfile };
}

export async function runHostConfig(profileId: string | undefined): Promise<void> {
  const profile = REQUIRED_PROFILES.find((p) => p.id === profileId);
  if (!profile) {
    const ids = REQUIRED_PROFILES.map((p) => p.id).join("\n  ");
    console.error(`unknown profile '${profileId}'. Available profiles:\n  ${ids}`);
    process.exitCode = 1;
    return;
  }
  const rendered = renderProfile(profile, {
    command: "my-pi-mcp",
    workspace: "${workspaceFolder}",
  });
  process.stdout.write(rendered.type === "json" ? rendered.pretty + "\n" : rendered.command + "\n");
}

export async function runMcp(
  workspace: string | undefined,
  allowCwd = false,
  securityProfile: CliOptions["securityProfile"] = "read-only",
): Promise<void> {
  const configuredRoot = workspace ?? resolveWorkspaceRootFromEnv();
  if (!configuredRoot && !allowCwd) {
    throw new Error("workspace is required; pass --workspace <path> or set MY_PI_WORKSPACE_ROOT (use --allow-cwd to opt in to process.cwd())");
  }
  const root = configuredRoot ?? process.cwd();
  const runtime = new WorkspaceRuntime();
  const trusted = securityProfile === "trusted";
  await runtime.open({
    root: path.resolve(root),
    policy: { mode: trusted ? "workspace-write" : "read-only" },
    capabilities: { write: trusted, lsp: trusted },
  });
  console.error(`[my-pi] workspace=${path.resolve(root)} mode=${runtime.workspaceOrThrow.policy.mode} transport=stdio`);

  const capabilities = createFoundationCapabilities(runtime);
  const server = new MyPiServer({ name: "my-pi", version: "0.1.0", runtime, capabilities });
  await server.connect();
}

export function main(argv: string[] = process.argv): Promise<void> {
  const opts = parseArgs(argv);
  if (opts.command === "host-config") return runHostConfig(opts.profileId);
  return runMcp(opts.workspace, opts.allowCwd, opts.securityProfile);
}

// Bin entry: run when executed directly, so importing the CLI for tests or
// embedding never silently opens the caller's workspace.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
