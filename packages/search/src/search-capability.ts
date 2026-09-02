/**
 * @my-pi/search — search capability orchestration (R0.1.8).
 *
 * Owns: scope resolution, workspace-relative policy-path composition (R0.1.2),
 * backend selection, result limits, degraded metadata. The MCP adapter only
 * translates MCP input into SearchInput and back.
 */
import path from "node:path";
import {
  err,
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "@my-pi/contracts";
import type { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { SensitivePathPolicy } from "@my-pi/policy";
import { NodeFallbackSearchBackend } from "./fallback.js";

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

/**
 * R0.1.2: policy path is ALWAYS workspace-relative. The backend's
 * scope-relative candidate path is re-anchored against the workspace root so
 * a scope such as `.aws` cannot rebase a sensitive file out of policy range.
 */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export interface SearchInput {
  mode: "grep" | "glob";
  pattern: string;
  path?: string;
}

export function createSearchCapability(runtime: WorkspaceRuntime): Capability<unknown, unknown> {
  const backend = new NodeFallbackSearchBackend();
  return {
    name: "search",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { mode, pattern, path: scope } = input as SearchInput;
      if (mode !== "grep" && mode !== "glob") throw err.invalidArgument("mode must be grep or glob");
      if (typeof pattern !== "string" || pattern === "") throw err.invalidArgument("pattern is required");

      let searchRoot: string;
      if (scope) {
        const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, scope);
        const st = await import("node:fs").then((m) => m.promises.stat(resolved.absolute));
        if (st.isFile()) throw err.invalidArgument(`search path is a file, not a directory: ${resolved.relPosix}`);
        searchRoot = resolved.absolute;
      } else {
        searchRoot = ctx.workspace.root;
      }

      const sensitive = new SensitivePathPolicy();
      const allowList = ctx.workspace.policy.allowedSensitivePaths.map((p) => p.replace(/\/+$/, ""));

      // P0.2 + R0.1.2: enforcement happens DURING traversal, before any file
      // is opened, and the policy path is workspace-relative regardless of
      // the requested scope.
      const isAllowed = (scopeRelPath: string): boolean => {
        const abs = path.resolve(searchRoot, scopeRelPath);
        const policyRel = toPosix(path.relative(ctx.workspace.root, abs));
        if (sensitive.isSensitive(policyRel) === undefined) return true;
        return allowList.some((a) => policyRel === a || policyRel.startsWith(a + "/"));
      };

      const res = await backend.search(
        {
          mode,
          pattern,
          roots: [searchRoot],
          allowed: (rel) => isAllowed(rel),
          limit: 200,
        },
        ctx.signal,
      );
      const visible = res.matches.slice(0, 20);
      return result(ctx, {
        matches: visible,
        truncated: res.totalCount > visible.length,
        totalCount: res.totalCount, // Contract A: exact count
      }, t0, { backend: "node-fallback", degraded: true });
    },
  };
}
