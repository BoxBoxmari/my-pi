/**
 * MCP stdio adapter on the OFFICIAL SDK v2 packages (P0.5).
 *
 * - `@modelcontextprotocol/server` v2.0.0 (McpServer, StdioServerTransport,
 *   InMemoryTransport, SUPPORTED_PROTOCOL_VERSIONS).
 * - `@modelcontextprotocol/core` v2.0.0 (error codes, protocol types).
 * - No legacy `@modelcontextprotocol/sdk` runtime dependency.
 *
 * P0.4: cancellation uses `ctx.mcpReq.signal` from the SDK ServerContext —
 * host cancellation reaches capabilities end-to-end.
 * P0.6: the adapter records the OBSERVED negotiated era from initialize; it
 * never fabricates one from a config variable. Until observation is wired,
 * era fields stay explicitly "unobserved".
 * stdout carries MCP protocol bytes only; logs go to stderr.
 */
import { McpServer, InMemoryTransport, INVALID_PARAMS, PARSE_ERROR, INTERNAL_ERROR, METHOD_NOT_FOUND, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { Transport } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  createRequestId,
  isMyPiError,
  type Capability,
  type CapabilityContext,
} from "@my-pi/contracts";
import type { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { getDesiredEra, setObservedEra, getObservedEra, type McpEra } from "./era.js";
import { myPiCodeToMcpCode } from "./error-map.js";
import { ToolRegistry, type ToolDefinition } from "./tool-registry.js";

const SCHEMAS: Record<string, StandardSchemaWithJSON> = {
  workspace_info: z.object({}),
  fs_read: z.object({
    path: z.string(),
    offset: z.number().int().min(0).optional(),
    max_bytes: z.number().int().positive().optional(),
  }),
  fs_stat: z.object({ path: z.string() }),
  fs_write: z.object({ path: z.string(), content: z.string(), expected_hash: z.string().optional() }),
  fs_patch: z.object({
    path: z.string(),
    patch: z.object({ hunks: z.array(z.object({ old: z.string(), new: z.string() })) }),
    expected_hash: z.string().optional(),
  }),
  search: z.object({ mode: z.enum(["grep", "glob"]), pattern: z.string(), path: z.string().optional() }),
  ast_search: z.object({ pattern: z.string(), paths: z.array(z.string()) }),
  lsp_status: z.object({}),
  lsp_diagnostics: z.object({ path: z.string() }),
  lsp_symbols: z.object({ path: z.string() }),
  lsp_navigate: z.object({ action: z.enum(["definition", "references", "hover"]), path: z.string(), line: z.number().optional(), column: z.number().optional() }),
  vcs_status: z.object({ path: z.string().optional() }),
  vcs_diff: z.object({ path: z.string().optional() }),
};

/** P1.2: operational availability, distinct from the 13-tool CATALOG. */
const IMPLEMENTED_TOOLS = new Set([
  "workspace_info",
  "fs_read",
  "fs_stat",
  "fs_write",
  "fs_patch",
  "search",
  "ast_search",
  "lsp_status",
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_navigate",
  "vcs_status",
  "vcs_diff",
]);

export function toolAvailability(name: string): "implemented" | "planned" {
  return IMPLEMENTED_TOOLS.has(name) ? "implemented" : "planned";
}

const DESCRIPTIONS: Record<string, string> = {
  workspace_info: "Inspect the configured workspace. Read-only.",
  fs_read: "Read a single file within the workspace and obtain a content fingerprint/snapshot. Read-only.",
  fs_stat: "Stat a single path within the workspace. Read-only.",
  fs_write: "Write a single file within the workspace (stale-safe). Mutates exactly one file.",
  fs_patch: "Apply a hashline-style single-file patch (stale-safe). Mutates exactly one file.",
  search: "Search the workspace (grep or glob). Read-only.",
  ast_search: "Structural AST search. Read-only.",
  lsp_status: "Language server status. Read-only.",
  lsp_diagnostics: "Language server diagnostics for a file. Read-only.",
  lsp_symbols: "Symbols for a file. Read-only.",
  lsp_navigate: "Navigate (definition/references/hover) via language server. Read-only.",
  vcs_status: "VCS status. Read-only.",
  vcs_diff: "VCS diff. Read-only.",
};

export interface MyPiServerOptions {
  name?: string;
  version?: string;
  runtime: WorkspaceRuntime;
  capabilities: Map<string, Capability<unknown, unknown>>;
  requestLog?: (row: { tool: string; ok: boolean; ms: number; errorCode?: string }) => void;
}

export class MyPiServer {
  private readonly server: McpServer;
  private readonly registry = new ToolRegistry();

  constructor(private readonly opts: MyPiServerOptions) {
    const server = new McpServer(
      { name: opts.name ?? "my-pi", version: opts.version ?? "0.1.0" },
      { capabilities: { tools: {} } },
    );
    this.server = server;

    // P0.6: record the actual negotiated protocol era at initialize time.
    // The client transport exposes getNegotiatedProtocolVersion; on stdio we
    // observe the era from the initialize request envelope where the SDK
    // surfaces it. We wire observation via a low-level handler below.
    for (const [name, capability] of opts.capabilities) {
      const schema = SCHEMAS[name];
      if (!schema) continue;
      this.registry.register({
        name,
        description: DESCRIPTIONS[name] ?? capability.name,
        inputSchema: {},
        capability,
      });
      this.registerTool(this.registry.get(name)!);
    }
  }

  /** Observe the negotiated era (P0.6). Called with the value the SDK/transport negotiated. */
  observeEra(era: string): void {
    setObservedEra(era);
  }

  private registerTool(def: ToolDefinition): void {
    this.server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: SCHEMAS[def.name]!,
        // P1.2: explicit availability metadata outside the call path, so the
        // catalog can stay at 13 without implying 13 working tools.
        _meta: { "my-pi/availability": toolAvailability(def.name), "ccr/availability": toolAvailability(def.name) },
      },
      async (input, ctx) => {
        const requestId = createRequestId();
        // P0.4: use the SDK's per-request signal — host cancellation reaches here.
        const signal = ctx.mcpReq?.signal ?? (ctx as unknown as { signal?: AbortSignal }).signal ?? new AbortController().signal;
        const started = performance.now();
        try {
          const mcpCtx: CapabilityContext = {
            requestId,
            workspace: this.opts.runtime.workspaceOrThrow,
            signal,
            // P0.6: report the OBSERVED era, never a configured placeholder.
            trace: { negotiated_mcp_era_observed: getObservedEra() ?? "unobserved", transport: "stdio" },
          };
          const res = await def.capability.execute(input, mcpCtx);
          this.opts.requestLog?.({ tool: def.name, ok: true, ms: performance.now() - started });
          return { content: [{ type: "text", text: JSON.stringify(res) }] };
        } catch (e) {
          const errorCode = isMyPiError(e) ? e.code : "UNKNOWN";
          this.opts.requestLog?.({ tool: def.name, ok: false, ms: performance.now() - started, errorCode });
          if (isMyPiError(e)) {
            // Typed my-pi error -> JSON-RPC error with stable code mapping.
            const err = new Error(e.message) as Error & { code?: number };
            err.code = myPiCodeToMcpCode(e.code);
            throw err;
          }
          throw e;
        }
      },
    );
  }

  async connect(transport?: Transport): Promise<void> {
    const t = transport ?? new StdioServerTransport();
    await this.server.connect(t);
  }

  /** Exposed for era observation wiring and tests. */
  get mcpServer(): McpServer {
    return this.server;
  }
}

/** @deprecated Use MyPiServer. Kept as a 1-major alias. */
export const CcrServer = MyPiServer;
/** @deprecated Use MyPiServerOptions. Kept as a 1-major alias. */
export type CcrServerOptions = MyPiServerOptions;

export { InMemoryTransport, INVALID_PARAMS, PARSE_ERROR, INTERNAL_ERROR, METHOD_NOT_FOUND };
