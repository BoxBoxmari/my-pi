/**
 * @my-pi/vcs — VCS capability orchestration (R0.1.8).
 *
 * Owns: workspace-root resolution, path filters, backend selection, artifact
 * spill. The MCP adapter only translates MCP input into VcsInput and back.
 */
import {
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "@my-pi/contracts";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { LocalArtifactStore } from "@my-pi/artifact-store";
import { SensitivePathPolicy } from "@my-pi/policy";
import { GitVcsBackend } from "./fallback.js";

type Ctx = CapabilityContext;

function result<T>(
  ctx: Ctx,
  data: T,
  startedAt: number,
  extra?: Partial<Pick<CapabilityResult<T>, "backend" | "degraded" | "warnings" | "artifacts">>,
): CapabilityResult<T> {
  const totalMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  return {
    schemaVersion: "1",
    requestId: ctx.requestId,
    workspaceId: ctx.workspace.id,
    revision: ctx.workspace.revision,
    data,
    timing: { totalMs },
    ...extra,
  };
}

export interface VcsInput {
  path?: string;
}

const sensitivePathPolicy = new SensitivePathPolicy();
let processArtifactStore: Promise<LocalArtifactStore> | undefined;
let processArtifactDir: string | undefined;

function getProcessArtifactStore(): Promise<LocalArtifactStore> {
  if (!processArtifactStore) {
    processArtifactStore = (async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-artifacts-"));
      processArtifactDir = dir;
      const store = new LocalArtifactStore(dir);
      await store.init();
      return store;
    })();
  }
  return processArtifactStore;
}

process.once("exit", () => {
  if (processArtifactDir) rmSync(processArtifactDir, { recursive: true, force: true });
});

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function isAllowListed(pathValue: string, allowList: string[]): boolean {
  return allowList.some((allowed) => pathValue === allowed || pathValue.startsWith(`${allowed}/`));
}

function isAllowedDiffPath(ctx: Ctx, root: string, relativePath: string): boolean {
  const rootRelative = toPosix(relativePath);
  const workspaceRelative = toPosix(path.relative(ctx.workspace.root, path.resolve(root, relativePath)));
  const rootName = path.basename(root);
  const allowList = ctx.workspace.policy.allowedSensitivePaths.map((value) => toPosix(value.replace(/\/+$/, "")));
  const candidates = rootName ? [rootRelative, workspaceRelative, `${toPosix(rootName)}/${rootRelative}`] : [rootRelative, workspaceRelative];
  return candidates.every((candidate) => {
    const rule = sensitivePathPolicy.isSensitive(candidate);
    return rule === undefined || isAllowListed(candidate, allowList);
  });
}

export function createVcsCapabilities(runtime: WorkspaceRuntime): Map<string, Capability<unknown, unknown>> {
  const map = new Map<string, Capability<unknown, unknown>>();
  const vcs = new GitVcsBackend();

  // P0.1 + R0.1.8: workspace root is the authoritative VCS scope; an optional
  // `path` is resolved through PathPolicy and must stay inside the workspace.
  // Never "." / process cwd as implicit authority.
  async function resolveRoot(scope: string | undefined, ctx: Ctx): Promise<string> {
    if (scope === undefined) return ctx.workspace.root;
    const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, scope);
    const authorized = await runtime.pathPolicy.revalidate(ctx.workspace, resolved, "read");
    return authorized.absolute;
  }

  map.set("vcs_status", {
    name: "vcs_status",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { path: scope } = input as VcsInput;
      const root = await resolveRoot(scope, ctx);
      const res = await vcs.status({ path: root }, ctx.signal);
      return result(ctx, res, t0, { backend: "typescript" });
    },
  });

  map.set("vcs_diff", {
    name: "vcs_diff",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { path: scope } = input as VcsInput;
      const root = await resolveRoot(scope, ctx);
      // G2/VCS hardening: large diffs spill to an artifact instead of being
      // dropped. Artifacts live in a private process-scoped temp store.
      const artifactStore = await getProcessArtifactStore();
      const res = await vcs.diff(
        { path: root },
        ctx.signal,
        {
          beginSpill: (mimeType) => artifactStore.createWriter(mimeType),
          allowedPath: (relativePath, gitRoot) => isAllowedDiffPath(ctx, gitRoot, relativePath),
        },
      );
      return result(ctx, res, t0, { backend: "typescript" });
    },
  });

  return map;
}
