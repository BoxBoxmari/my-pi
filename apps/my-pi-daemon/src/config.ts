import path from "node:path";
import {
  discoverProjectIdentity,
  ensureRuntimeDir,
  metadataPath,
  resolveEndpoint,
  resolveRuntimeDir,
  type IpcEndpoint,
  type ProjectIdentity,
} from "@my-pi/coordination-client";
import type { ProjectId } from "@my-pi/contracts";

export interface DaemonConfig {
  workspaceRoot: string;
  projectId: ProjectId;
  project: ProjectIdentity;
  runtimeDir: string;
  databasePath: string;
  endpoint: IpcEndpoint;
  metadataPath: string;
  lockPath: string;
  protocolVersion: string;
  maxFrameBytes: number;
}

export async function resolveDaemonConfig(options: {
  workspaceRoot: string;
  runtimeDir?: string;
  databasePath?: string;
  allowNonGit?: boolean;
  protocolVersion?: string;
}): Promise<DaemonConfig> {
  const project = await discoverProjectIdentity(options.workspaceRoot, { allowNonGit: options.allowNonGit });
  const runtimeDir = resolveRuntimeDir(project.projectKey, options.runtimeDir);
  await ensureRuntimeDir(runtimeDir);
  const endpoint = resolveEndpoint(runtimeDir, project.projectKey);
  return {
    workspaceRoot: project.root,
    projectId: `project_${project.projectKey.slice(0, 12)}` as ProjectId,
    project,
    runtimeDir,
    databasePath: options.databasePath ? path.resolve(options.databasePath) : path.join(runtimeDir, "coordination.sqlite"),
    endpoint,
    metadataPath: metadataPath(runtimeDir),
    lockPath: path.join(runtimeDir, "daemon.lock"),
    protocolVersion: options.protocolVersion ?? "1",
    maxFrameBytes: 256 * 1024,
  };
}
