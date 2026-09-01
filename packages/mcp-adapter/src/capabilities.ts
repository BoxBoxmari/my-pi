/**
 * V1 capability composition (thin orchestrator — R0.1.8).
 *
 * All business logic lives in capability packages: @ccr/fs, @ccr/search,
 * @ccr/vcs. This module only wires runtime + workspace_info + unsupported
 * stubs. It must NOT import node:fs / node:child_process / backend classes
 * (enforced by scripts/architecture-check.mjs).
 */
import {
  err,
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "@ccr/contracts";
import type { WorkspaceRuntime } from "@ccr/workspace-runtime";
import { createSearchCapability } from "@ccr/search";
import { createVcsCapabilities } from "@ccr/vcs";
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
): CapabilityResult<T> {
  const totalMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  return {
    schemaVersion: "1",
    requestId: ctx.requestId,
    workspaceId: ctx.workspace.id,
    revision: ctx.workspace.revision,
    data,
    timing: { totalMs },
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
        catalogCapabilities: info.catalogCapabilities,
        operationalCapabilities: info.operationalCapabilities,
        backendHealth: info.backendHealth,
      }, t0);
    },
  });

  // R0.1.8: business logic lives in capability packages.
  for (const [name, cap] of createFsCapabilities(runtime)) map.set(name, cap);
  map.set("search", createSearchCapability(runtime));
  for (const [name, cap] of createVcsCapabilities(runtime)) map.set(name, cap);

  // AST + LSP remain planned (typed unsupported until their gates).
  map.set("ast_search", unsupported("ast_search"));
  map.set("lsp_status", unsupported("lsp_status"));
  map.set("lsp_diagnostics", unsupported("lsp_diagnostics"));
  map.set("lsp_symbols", unsupported("lsp_symbols"));
  map.set("lsp_navigate", unsupported("lsp_navigate"));

  // P1.6: real timing on every capability.
  for (const [name, cap] of map) {
    map.set(name, timed(cap as Capability<unknown, unknown>));
  }

  return map;
}
