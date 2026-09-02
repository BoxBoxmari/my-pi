/**
 * CLI entry for my-pi-mcp and host-config.
 * V1 transport: stdio only.
 */
import path from "node:path";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { createFoundationCapabilities, MyPiServer } from "@my-pi/mcp-adapter";
import { REQUIRED_PROFILES, renderProfile } from "@my-pi/host-profiles";

export interface CliOptions {
  command: "mcp" | "host-config";
  workspace?: string;
  profileId?: string;
}

function resolveWorkspaceRootFromEnv(): string | undefined {
  if (process.env.MY_PI_WORKSPACE_ROOT !== undefined) return process.env.MY_PI_WORKSPACE_ROOT;
  if (process.env.CCR_WORKSPACE_ROOT !== undefined) {
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
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace") workspace = args[i + 1] ?? workspace;
    else if (args[i]?.startsWith("--workspace=")) workspace = args[i]!.split("=")[1] ?? workspace;
  }
  return { command: "mcp", workspace };
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

export async function runMcp(workspace: string | undefined): Promise<void> {
  const root = workspace ?? resolveWorkspaceRootFromEnv() ?? process.cwd();
  const runtime = new WorkspaceRuntime();
  await runtime.open({ root: path.resolve(root) });
  console.error(`[my-pi] workspace=${path.resolve(root)} mode=${runtime.workspaceOrThrow.policy.mode} transport=stdio`);

  const capabilities = createFoundationCapabilities(runtime);
  const server = new MyPiServer({ name: "my-pi", version: "0.1.0", runtime, capabilities });
  await server.connect();
}

export function main(argv: string[] = process.argv): Promise<void> {
  const opts = parseArgs(argv);
  if (opts.command === "host-config") return runHostConfig(opts.profileId);
  return runMcp(opts.workspace);
}

// Bin entry: run when executed directly.
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
