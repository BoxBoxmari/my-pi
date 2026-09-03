import {
  err,
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "@my-pi/contracts";
import type { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { defaultLspRegistry, LspRegistry } from "./registry.js";
import { pathToUri, type NavigationResult } from "./client.js";
import { detectLanguageFromPath } from "./root-detection.js";

type Ctx = CapabilityContext;

function result<T>(
  ctx: Ctx,
  data: T,
  startedAt: number,
  extra?: Partial<Pick<CapabilityResult<T>, "backend" | "degraded" | "warnings" | "diagnostics">>,
): CapabilityResult<T> {
  const totalMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  return {
    schemaVersion: "1",
    requestId: ctx.requestId,
    workspaceId: ctx.workspace.id,
    revision: ctx.workspace.revision,
    data,
    timing: { totalMs },
    backend: "lsp",
    ...extra,
  };
}

export interface LspDiagnosticsInput {
  path: string;
}

export interface LspSymbolsInput {
  path: string;
}

export interface LspNavigateInput {
  action: "definition" | "references" | "hover";
  path: string;
  line?: number;
  column?: number;
}

type NavigationLocation = NonNullable<NavigationResult["locations"]>[number];

async function authorizeLocations(
  runtime: WorkspaceRuntime,
  ctx: Ctx,
  locations: NavigationLocation[],
): Promise<{ locations: NavigationLocation[]; filteredExternal: number }> {
  const authorized: NavigationLocation[] = [];
  let filteredExternal = 0;
  for (const location of locations) {
    try {
      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, location.path);
      authorized.push({
        ...location,
        uri: pathToUri(resolved.absolute),
        path: resolved.relPosix,
      });
    } catch {
      filteredExternal++;
    }
  }
  return { locations: authorized, filteredExternal };
}

export function createLspCapabilities(
  runtime: WorkspaceRuntime,
  registry: LspRegistry = defaultLspRegistry,
): Map<string, Capability<unknown, unknown>> {
  const map = new Map<string, Capability<unknown, unknown>>();

  map.set("lsp_status", {
    name: "lsp_status",
    risk: "read",
    async execute(_input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const statuses = registry.getStatus(ctx.workspace.id);
      return result(ctx, { servers: statuses }, t0);
    },
  });

  map.set("lsp_diagnostics", {
    name: "lsp_diagnostics",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { path: relPath } = input as LspDiagnosticsInput;
      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, relPath);
      const authorized = await runtime.pathPolicy.revalidate(ctx.workspace, resolved, "read");
      const lang = detectLanguageFromPath(authorized.absolute);

      if (!lang) {
        return result(ctx, { path: authorized.relPosix, diagnostics: [] }, t0);
      }

      try {
        const client = await registry.getClient(ctx.workspace.id, ctx.workspace.root, lang);
        await client.openDocument(authorized.absolute);
        await client.waitForDiagnostics(authorized.absolute);
        const diags = client.getDiagnosticsForFile(authorized.absolute);
        return result(ctx, { path: authorized.relPosix, diagnostics: diags }, t0);
      } catch (e: any) {
        return result(ctx, { path: authorized.relPosix, diagnostics: [], error: e.message }, t0, { degraded: true });
      }
    },
  });

  map.set("lsp_symbols", {
    name: "lsp_symbols",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { path: relPath } = input as LspSymbolsInput;
      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, relPath);
      const authorized = await runtime.pathPolicy.revalidate(ctx.workspace, resolved, "read");
      const lang = detectLanguageFromPath(authorized.absolute);

      if (!lang) {
        return result(ctx, { path: authorized.relPosix, symbols: [] }, t0);
      }

      const client = await registry.getClient(ctx.workspace.id, ctx.workspace.root, lang);
      const symbols = (await client.documentSymbols(authorized.absolute)).map((symbol) => ({
        ...symbol,
        // Document symbols describe the authorized input document; never let
        // a server-provided URI become a second filesystem authority.
        uri: pathToUri(authorized.absolute),
      }));
      return result(ctx, { path: authorized.relPosix, symbols }, t0);
    },
  });

  map.set("lsp_navigate", {
    name: "lsp_navigate",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { action, path: relPath, line = 0, column = 0 } = input as LspNavigateInput;
      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, relPath);
      const authorized = await runtime.pathPolicy.revalidate(ctx.workspace, resolved, "read");
      const lang = detectLanguageFromPath(authorized.absolute);

      if (!lang) {
        throw err.invalidArgument(`Unsupported language for path: ${relPath}`);
      }

      const client = await registry.getClient(ctx.workspace.id, ctx.workspace.root, lang);

      if (action === "hover") {
        const content = await client.hover(authorized.absolute, line, column);
        return result(ctx, { action, path: authorized.relPosix, content }, t0);
      } else if (action === "definition") {
        const locations = await client.definition(authorized.absolute, line, column);
        const filtered = await authorizeLocations(runtime, ctx, locations ?? []);
        return result(ctx, { action, path: authorized.relPosix, ...filtered }, t0);
      } else if (action === "references") {
        const locations = await client.references(authorized.absolute, line, column);
        const filtered = await authorizeLocations(runtime, ctx, locations ?? []);
        return result(ctx, { action, path: authorized.relPosix, ...filtered }, t0);
      }

      throw err.invalidArgument(`Unknown navigation action: ${action}`);
    },
  });

  return map;
}
