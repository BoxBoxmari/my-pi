#!/usr/bin/env node
/**
 * CLI entry for my-pi-mcp and host-config.
 * V1 transport: stdio only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CoordinationClient, discoverProjectIdentity, resolveRuntimeDir } from "@my-pi/coordination-client";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { createCoordinationCapabilities, createEvaluationCapabilities, createFoundationCapabilities, MyPiServer } from "@my-pi/mcp-adapter";
import { COORDINATION_PROFILES, REQUIRED_PROFILES, STRICT_CANDIDATE_PROFILES, renderProfile } from "@my-pi/host-profiles";
import { createTheaterFrame, type TheaterEvent } from "@my-pi/graph-model";
import { renderGraphViewHtml, renderTheaterViewHtml } from "@my-pi/ui";

export interface CliOptions {
  command: "mcp" | "host-config";
  workspace?: string;
  profileId?: string;
  allowCwd?: boolean;
  securityProfile?: "read-only" | "trusted";
  coordination?: boolean;
  evaluation?: boolean;
  coordinationRuntimeDir?: string;
  visuals?: boolean;
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
  let coordination = false;
  let evaluation = false;
  let coordinationRuntimeDir: string | undefined;
  let visuals = false;
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
    } else if (arg === "--coordination") {
      coordination = true;
    } else if (arg === "--evaluation") {
      evaluation = true;
    } else if (arg === "--visuals") {
      visuals = true;
    } else if (arg === "--coordination-runtime-dir") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--coordination-runtime-dir requires a path");
      coordinationRuntimeDir = value;
      i++;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return {
    command: "mcp",
    workspace,
    allowCwd,
    securityProfile,
    ...(coordination ? { coordination: true } : {}),
    ...(evaluation ? { evaluation: true } : {}),
    ...(coordinationRuntimeDir === undefined ? {} : { coordinationRuntimeDir }),
    ...(visuals ? { visuals: true } : {}),
  };
}

export async function runHostConfig(profileId: string | undefined): Promise<void> {
  const profile = [...REQUIRED_PROFILES, ...COORDINATION_PROFILES, ...STRICT_CANDIDATE_PROFILES].find((p) => p.id === profileId);
  if (!profile) {
    const ids = [...REQUIRED_PROFILES, ...COORDINATION_PROFILES, ...STRICT_CANDIDATE_PROFILES].map((p) => p.id).join("\n  ");
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
  coordination = false,
  evaluation = false,
  coordinationRuntimeDir?: string,
  visuals = false,
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
  console.error(`[my-pi] workspace=${path.resolve(root)} mode=${runtime.workspaceOrThrow.policy.mode} transport=stdio coordination=${coordination ? "enabled" : "disabled"} evaluation=${evaluation ? "enabled" : "disabled"}`);

  const capabilities = createFoundationCapabilities(runtime);
  let coordinationClient: CoordinationClient | undefined;
  if (coordination || evaluation || visuals) {
    try {
      const project = await discoverProjectIdentity(path.resolve(root));
      const runtimeDir = resolveRuntimeDir(project.projectKey, coordinationRuntimeDir);
      coordinationClient = await CoordinationClient.fromRuntimeDir(runtimeDir);
    } catch (error) {
      if (coordination || evaluation) throw error;
      console.error(`[my-pi] visuals degraded: coordination is unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
    if (coordinationClient && coordination) for (const [name, capability] of createCoordinationCapabilities(coordinationClient)) capabilities.set(name, capability);
    if (coordinationClient && evaluation) for (const [name, capability] of createEvaluationCapabilities(coordinationClient)) capabilities.set(name, capability);
  }
  const server = new MyPiServer({
    name: "my-pi",
    version: "0.1.0",
    runtime,
    capabilities,
    visuals: visuals ? coordinationClient === undefined ? {
      enabled: true,
      supportedHost: false,
      readHtml: () => "<html><body>my-pi visuals degraded: coordination is unavailable</body></html>",
    } : {
      enabled: true,
      readHtml: async () => {
        const health = await coordinationClient!.health() as { projectId: string };
        const graph = await coordinationClient!.graphSnapshot({ projectId: health.projectId, kind: "code", maxNodes: 500, maxEdges: 1_000, maxAttributeBytes: 16_384 });
        return renderGraphViewHtml({ sessionToken: "mcp-app", nonce: "mcp-app", initialSnapshot: graph });
      },
      readTheaterHtml: async () => {
        const health = await coordinationClient!.health() as { projectId: string };
        const graph = await coordinationClient!.graphSnapshot({ projectId: health.projectId, kind: "work", maxNodes: 500, maxEdges: 1_000, maxAttributeBytes: 16_384 });
        const eventResult = await coordinationClient!.graphEvents({ projectId: health.projectId, kind: "work", mode: "live", maxEvents: 500, maxBytes: 128 * 1024 });
        const frame = createTheaterFrame({
          scope: { projectId: health.projectId, kind: "work" },
          graph,
          events: eventResult.events as TheaterEvent[],
          cursor: { lastSequence: eventResult.throughSequence },
          capabilities: { live: true, replay: true, expand: false, trace: false, renderer3d: true },
        });
        return renderTheaterViewHtml({ sessionToken: "mcp-app", nonce: "mcp-app", initialFrame: frame, isMcp: true });
      },
    } : undefined,
  });
  if (visuals && server.visualsStatus === "degraded") console.error("[my-pi] visuals degraded: host or coordination support is unavailable; baseline tools remain active");
  await server.connect();
}

export function main(argv: string[] = process.argv): Promise<void> {
  const opts = parseArgs(argv);
  if (opts.command === "host-config") return runHostConfig(opts.profileId);
  return runMcp(opts.workspace, opts.allowCwd, opts.securityProfile, opts.coordination, opts.evaluation, opts.coordinationRuntimeDir, opts.visuals);
}

// Bin entry: run when executed directly, so importing the CLI for tests or
// embedding never silently opens the caller's workspace.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
