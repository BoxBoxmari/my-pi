/**
 * MCP stdio adapter built on the official TypeScript SDK v2. stdout carries MCP
 * protocol bytes only; logs go to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  createRequestId,
  isCcrError,
  type Capability,
  type CapabilityContext,
} from "@ccr/contracts";
import type { WorkspaceRuntime } from "@ccr/workspace-runtime";
import { getSelectedEra } from "./era.js";
import { toMcpError } from "./error-map.js";
import { ToolRegistry, type ToolDefinition } from "./tool-registry.js";

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  workspace_info: z.object({}),
  fs_read: z.object({ path: z.string() }),
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

export interface CcrServerOptions {
  name?: string;
  version?: string;
  runtime: WorkspaceRuntime;
  capabilities: Map<string, Capability<unknown, unknown>>;
  requestLog?: (row: { tool: string; ok: boolean; ms: number; errorCode?: string }) => void;
}

export class CcrServer {
  private readonly server: McpServer;
  private readonly registry = new ToolRegistry();

  constructor(private readonly opts: CcrServerOptions) {
    const server = new McpServer(
      { name: opts.name ?? "ccr", version: opts.version ?? "0.1.0" },
      { capabilities: { tools: {} } },
    );
    this.server = server;

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

  private registerTool(def: ToolDefinition): void {
    this.server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: SCHEMAS[def.name]!,
      },
      async (input, _extra) => {
        const requestId = createRequestId();
        const ctx: CapabilityContext = {
          requestId,
          workspace: this.opts.runtime.workspaceOrThrow,
          signal: new AbortController().signal,
          trace: { selected_mcp_era: getSelectedEra(), transport: "stdio" },
        };
        const started = Date.now();
        try {
          const res = await def.capability.execute(input, ctx);
          this.opts.requestLog?.({ tool: def.name, ok: true, ms: Date.now() - started });
          return { content: [{ type: "text", text: JSON.stringify(res) }] };
        } catch (e) {
          const errorCode = isCcrError(e) ? e.code : "UNKNOWN";
          this.opts.requestLog?.({ tool: def.name, ok: false, ms: Date.now() - started, errorCode });
          if (isCcrError(e)) throw toMcpError(e);
          throw e;
        }
      },
    );
  }

  async connect(transport?: Transport): Promise<void> {
    const t = transport ?? new StdioServerTransport();
    await this.server.connect(t);
  }
}
