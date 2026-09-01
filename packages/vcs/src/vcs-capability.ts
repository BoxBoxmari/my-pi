/**
 * @ccr/vcs — VCS capability orchestration (R0.1.8).
 *
 * Owns: workspace-root resolution, path filters, backend selection, artifact
 * spill. The MCP adapter only translates MCP input into VcsInput and back.
 */
import {
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "@ccr/contracts";
import type { WorkspaceRuntime } from "@ccr/workspace-runtime";
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

export function createVcsCapabilities(runtime: WorkspaceRuntime): Map<string, Capability<unknown, unknown>> {
  const map = new Map<string, Capability<unknown, unknown>>();
  const vcs = new GitVcsBackend();

  // P0.1 + R0.1.8: workspace root is the authoritative VCS scope; an optional
  // `path` is resolved through PathPolicy and must stay inside the workspace.
  // Never "." / process cwd as implicit authority.
  async function resolveRoot(scope: string | undefined, ctx: Ctx): Promise<string> {
    if (scope === undefined) return ctx.workspace.root;
    const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, scope);
    return resolved.absolute;
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
      const res = await vcs.diff({ path: root }, ctx.signal);
      return result(ctx, res, t0, { backend: "typescript" });
    },
  });

  return map;
}
