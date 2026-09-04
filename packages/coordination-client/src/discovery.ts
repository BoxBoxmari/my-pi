import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProjectIdentity {
  kind: "git" | "path";
  root: string;
  canonicalIdentity: string;
  gitCommonDir?: string;
  gitDir?: string;
  head?: string;
  branch?: string;
  projectKey: string;
}

export interface IpcEndpoint {
  transport: "unix" | "named-pipe";
  address: string;
}

export interface DaemonMetadata {
  schemaVersion: "1";
  protocolVersion: string;
  storeSchemaVersion: number;
  projectId: string;
  projectKey: string;
  projectRoot: string;
  projectCanonicalIdentity: string;
  endpoint: IpcEndpoint;
  databasePath: string;
  pid: number;
  startedAt: string;
  state: "starting" | "ready" | "degraded" | "stopping";
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: root, timeout: 5_000, windowsHide: true, maxBuffer: 64 * 1024 });
  return result.stdout.trim();
}

function projectKey(canonicalIdentity: string): string {
  return createHash("sha256").update(canonicalIdentity, "utf8").digest("hex").slice(0, 24);
}

export async function discoverProjectIdentity(root: string, options: { allowNonGit?: boolean } = {}): Promise<ProjectIdentity> {
  const resolvedRoot = await realpath(root);
  try {
    const gitRoot = await git(resolvedRoot, ["rev-parse", "--show-toplevel"]);
    const canonicalRoot = await realpath(gitRoot);
    const commonDirRaw = await git(canonicalRoot, ["rev-parse", "--git-common-dir"]);
    const gitDirRaw = await git(canonicalRoot, ["rev-parse", "--git-dir"]);
    const gitCommonDir = await realpath(path.resolve(canonicalRoot, commonDirRaw));
    const gitDir = path.resolve(canonicalRoot, gitDirRaw);
    const head = await git(canonicalRoot, ["rev-parse", "HEAD"]).catch(() => undefined);
    const branch = await git(canonicalRoot, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => undefined);
    const canonicalIdentity = `git:${gitCommonDir}`;
    return {
      kind: "git",
      root: canonicalRoot,
      canonicalIdentity,
      gitCommonDir,
      gitDir,
      ...(head ? { head } : {}),
      ...(branch ? { branch } : {}),
      projectKey: projectKey(canonicalIdentity),
    };
  } catch (error) {
    if (!options.allowNonGit) throw new Error(`workspace is not a Git repository: ${error instanceof Error ? error.message : String(error)}`);
    const canonicalIdentity = `path:${resolvedRoot}`;
    return { kind: "path", root: resolvedRoot, canonicalIdentity, projectKey: projectKey(canonicalIdentity) };
  }
}

export function resolveRuntimeDir(projectKeyValue: string, explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const base = process.platform === "win32"
    ? process.env.LOCALAPPDATA ?? os.tmpdir()
    : process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
  return path.join(base, "my-pi", "coordination", projectKeyValue);
}

export function resolveEndpoint(runtimeDir: string, projectKeyValue: string): IpcEndpoint {
  if (process.platform === "win32") {
    const runtimeKey = createHash("sha256").update(path.resolve(runtimeDir), "utf8").digest("hex").slice(0, 12);
    return { transport: "named-pipe", address: `\\\\.\\pipe\\my-pi-${projectKeyValue}-${runtimeKey}` };
  }
  return { transport: "unix", address: path.join(runtimeDir, "daemon.sock") };
}

export function metadataPath(runtimeDir: string): string {
  return path.join(runtimeDir, "daemon.json");
}

export async function readDaemonMetadata(runtimeDir: string): Promise<DaemonMetadata | undefined> {
  try {
    const parsed = JSON.parse(await readFile(metadataPath(runtimeDir), "utf8")) as DaemonMetadata;
    if (parsed.schemaVersion !== "1" || !parsed.endpoint?.address || typeof parsed.projectId !== "string" || typeof parsed.projectKey !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function ensureRuntimeDir(runtimeDir: string): Promise<void> {
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
}
