/**
 * V1 capability composition (thin orchestrator — P1.1).
 *
 * FS capabilities are owned by @ccr/fs; VCS orchestration stays here only as
 * PathPolicy translation (the git backend itself lives in @ccr/vcs). Search
 * orchestration lives in @ccr/search via its backend; the sensitive-path
 * gate is composed from @ccr/policy. This module must NOT contain direct
 * node:fs business logic (see scripts/architecture-check.mjs).
 */
import {
  err,
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "@ccr/contracts";
import type { WorkspaceRuntime } from "@ccr/workspace-runtime";
import { NodeFallbackSearchBackend } from "@ccr/search";
import { GitVcsBackend } from "@ccr/vcs";
import { SensitivePathPolicy } from "@ccr/policy";
import { createFsCapabilities } from "@ccr/fs";

type Ctx = CapabilityContext;

/**
 * P1.6: wrap a capability so every execution measures real duration with a
 * monotonic timer, re-stamping timing on the returned envelope.
 */
function timed<I, O>(cap: Capability<I, O>): Capability<I, O> {
  const inner = cap.execute.bind(cap);
  cap.execute = async (input: I, ctx: CapabilityContext) => {
    const t0 = performance.now();
    const res = await inner(input, ctx);
    res.timing.totalMs = Math.round((performance.now() - t0) * 1000) / 1000;
    return res;
  };
  return cap;
}

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

function unsupported(name: string): Capability<unknown, unknown> {
  return {
    name,
    risk: "read",
    async execute() {
      throw err.unsupportedCapability(`${name} is not implemented in the G1 foundation`);
    },
  };
}

export function createFoundationCapabilities(runtime: WorkspaceRuntime): Map<string, Capability<unknown, unknown>> {
  const map = new Map<string, Capability<unknown, unknown>>();

  map.set("workspace_info", {
    name: "workspace_info",
    risk: "read",
    async execute(_input, ctx) {
      const t0 = performance.now();
      const info = runtime.info();
      return result(ctx, {
        id: info.id,
        root: info.root,
        additionalRoots: info.additionalRoots,
        revision: info.revision,
        policyMode: info.policyMode,
        capabilities: info.capabilities,
        backendHealth: info.backendHealth,
      }, t0);
    },
  });

  // P1.1: FS capabilities owned by @ccr/fs.
  for (const [name, cap] of createFsCapabilities(runtime)) {
    map.set(name, cap);
  }

  map.set("search", {
    name: "search",
    risk: "read",
    async execute(input, ctx) {
      const t0 = performance.now();
      const { mode, pattern, path: scope } = input as { mode: "grep" | "glob"; pattern: string; path?: string };
      if (mode !== "grep" && mode !== "glob") throw err.invalidArgument("mode must be grep or glob");
      if (typeof pattern !== "string" || pattern === "") throw err.invalidArgument("pattern is required");
      // P0.3: resolve the scope itself, and search the RESOLVED path.
      let searchRoot: string;
      if (scope) {
        const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, scope);
        const st = await import("node:fs").then((m) => m.promises.stat(resolved.absolute));
        if (st.isFile()) throw err.invalidArgument(`search path is a file, not a directory: ${resolved.relPosix}`);
        searchRoot = resolved.absolute;
      } else {
        searchRoot = ctx.workspace.root;
      }
      // P0.2: sensitive-path enforcement happens DURING traversal, before
      // any file is opened. Allow-list comes from external workspace policy.
      const sensitive = new SensitivePathPolicy();
      const allowedList = ctx.workspace.policy.allowedSensitivePaths.map((p) => p.replace(/\/+$/, ""));
      const isAllowed = (relPosix: string): boolean => {
        if (sensitive.isSensitive(relPosix) === undefined) return true;
        return allowedList.some((a) => relPosix === a || relPosix.startsWith(a + "/"));
      };
      const backend = new NodeFallbackSearchBackend();
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
  });

  map.set("ast_search", unsupported("ast_search"));
  map.set("lsp_status", unsupported("lsp_status"));
  map.set("lsp_diagnostics", unsupported("lsp_diagnostics"));
  map.set("lsp_symbols", unsupported("lsp_symbols"));
  map.set("lsp_navigate", unsupported("lsp_navigate"));

  // P0.1: VCS root is the authorized workspace (or a resolved scope inside
  // it). The git backend itself lives in @ccr/vcs.
  const vcs = new GitVcsBackend();
  map.set("vcs_status", {
    name: "vcs_status",
    risk: "read",
    async execute(input, ctx) {
      const t0 = performance.now();
      const { path: scope } = input as { path?: string };
      const resolved = scope
        ? await runtime.pathPolicy.resolveForRead(ctx.workspace, scope)
        : null;
      const root = resolved ? resolved.absolute : ctx.workspace.root;
      const res = await vcs.status({ path: root }, ctx.signal);
      return result(ctx, res, t0, { backend: "typescript" });
    },
  });
  map.set("vcs_diff", {
    name: "vcs_diff",
    risk: "read",
    async execute(input, ctx) {
      const t0 = performance.now();
      const { path: scope } = input as { path?: string };
      const resolved = scope
        ? await runtime.pathPolicy.resolveForRead(ctx.workspace, scope)
        : null;
      const root = resolved ? resolved.absolute : ctx.workspace.root;
      const res = await vcs.diff({ path: root }, ctx.signal);
      return result(ctx, res, t0, { backend: "typescript" });
    },
  });

  // P1.6: real timing on every capability.
  for (const [name, cap] of map) {
    map.set(name, timed(cap as Capability<unknown, unknown>));
  }

  return map;
}
