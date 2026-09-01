/**
 * CLI entry for ccr-mcp and ccr host-config.
 * V1 transport: stdio only.
 */
import path from "node:path";
import { WorkspaceRuntime } from "@ccr/workspace-runtime";
import { createFoundationCapabilities, CcrServer } from "@ccr/mcp-adapter";
import { REQUIRED_PROFILES, renderProfile } from "@ccr/host-profiles";

export interface CliOptions {
  command: "mcp" | "host-config";
  workspace?: string;
  profileId?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  if (args[0] === "host-config") {
    return { command: "host-config", profileId: args[1] };
  }
  let workspace = process.env.CCR_WORKSPACE_ROOT;
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
    command: "ccr-mcp",
    workspace: "${workspaceFolder}",
  });
  process.stdout.write(rendered.type === "json" ? rendered.pretty + "\n" : rendered.command + "\n");
}

export async function runMcp(workspace: string | undefined): Promise<void> {
  const root = workspace ?? process.env.CCR_WORKSPACE_ROOT ?? process.cwd();
  const runtime = new WorkspaceRuntime();
  await runtime.open({ root: path.resolve(root) });
  console.error(`[ccr] workspace=${path.resolve(root)} mode=${runtime.workspaceOrThrow.policy.mode} transport=stdio`);

  const capabilities = createFoundationCapabilities(runtime);
  const server = new CcrServer({ name: "ccr", version: "0.1.0", runtime, capabilities });
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
