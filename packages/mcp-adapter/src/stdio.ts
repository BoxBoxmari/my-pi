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
  err,
  createRequestId,
  isMyPiError,
  type Capability,
  type CapabilityContext,
  type WorkspaceCapabilities,
} from "@my-pi/contracts";
import type { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { getDesiredEra, setObservedEra, getObservedEra, type McpEra } from "./era.js";
import { myPiCodeToMcpCode } from "./error-map.js";
import { ToolRegistry, type ToolDefinition } from "./tool-registry.js";

const MAX_FS_READ_BYTES = 1024 * 1024;
const MAX_FS_WRITE_BYTES = 8 * 1024 * 1024;
const MAX_PATCH_HUNKS = 1000;
const MAX_PATCH_TEXT_BYTES = 1024 * 1024;
const MAX_AST_QUERY_BYTES = 8192;
const MAX_AST_PATHS = 2000;

export class RequestLimiter {
  private active = 0;
  private readonly waiters: Array<{ signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: Error) => void; onAbort: () => void }> = [];

  constructor(private readonly maxConcurrent: number, private readonly maxQueued = 32) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("maxConcurrent must be at least 1");
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) throw new Error("maxQueued must be non-negative");
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(err.aborted("request aborted while waiting for a request slot"));
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve(() => this.release());
    }
    if (this.waiters.length >= this.maxQueued) return Promise.reject(err.outputLimit("request concurrency queue is full"));
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          signal.removeEventListener("abort", waiter.onAbort);
          reject(err.aborted("request aborted while waiting for a request slot"));
        },
      };
      this.waiters.push(waiter);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
    });
  }

  private release(): void {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.active--;
      return;
    }
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (waiter.signal.aborted) {
      waiter.reject(err.aborted("request aborted while waiting for a request slot"));
      this.release();
      return;
    }
    waiter.resolve(() => this.release());
  }
}

function capabilityKeyForTool(name: string): keyof WorkspaceCapabilities {
  if (name === "fs_write" || name === "fs_patch") return "write";
  if (name === "search") return "search";
  if (name === "ast_search") return "ast";
  if (name.startsWith("lsp_")) return "lsp";
  if (name.startsWith("vcs_")) return "vcs";
  return "read";
}

const SCHEMAS: Record<string, StandardSchemaWithJSON> = {
  workspace_info: z.object({}),
  fs_read: z.object({
    path: z.string(),
    offset: z.number().int().min(0).optional(),
    max_bytes: z.number().int().min(1).max(MAX_FS_READ_BYTES).optional(),
  }),
  fs_stat: z.object({ path: z.string() }),
  fs_write: z.object({ path: z.string(), content: z.string().max(MAX_FS_WRITE_BYTES), expected_hash: z.string().optional() }),
  fs_patch: z.object({
    path: z.string(),
    patch: z.object({ hunks: z.array(z.object({ old: z.string().max(MAX_PATCH_TEXT_BYTES), new: z.string().max(MAX_PATCH_TEXT_BYTES) })).max(MAX_PATCH_HUNKS) }),
    expected_hash: z.string().optional(),
  }),
  search: z.object({ mode: z.enum(["grep", "glob"]), pattern: z.string(), path: z.string().optional() }),
  ast_search: z.object({ pattern: z.string().max(MAX_AST_QUERY_BYTES), paths: z.array(z.string()).max(MAX_AST_PATHS), mode: z.enum(["text", "query"]).optional() }),
  lsp_status: z.object({}),
  lsp_diagnostics: z.object({ path: z.string() }),
  lsp_symbols: z.object({ path: z.string() }),
  lsp_navigate: z.object({ action: z.enum(["definition", "references", "hover"]), path: z.string(), line: z.number().int().min(0).max(1_000_000).optional(), column: z.number().int().min(0).max(1_000_000).optional() }),
  vcs_status: z.object({ path: z.string().optional() }),
  vcs_diff: z.object({ path: z.string().optional() }),
  coord_join: z.object({
    project: z.object({ displayName: z.string().max(256).optional(), policyRef: z.object({ id: z.string().max(128), version: z.string().max(64).optional() }).optional() }).optional(),
    repository: z.object({ id: z.string().min(1).max(256), projectId: z.string().min(1).max(256), vcs: z.literal("git"), canonicalIdentity: z.string().min(1).max(1024) }),
    worktree: z.object({ id: z.string().min(1).max(256), repositoryId: z.string().min(1).max(256), root: z.string().min(1).max(4096), head: z.string().max(256).optional(), branch: z.string().max(256).optional(), observedAt: z.string().max(64) }),
    host: z.string().min(1).max(128),
    clientInstance: z.string().max(256).optional(),
    role: z.string().max(128).optional(),
  }),
  coord_claim: z.object({ projectId: z.string().min(1).max(256), agentSessionId: z.string().min(1).max(256), workItemId: z.string().min(1).max(256), expectedVersion: z.number().int().min(0), allowShared: z.boolean().optional() }),
  coord_intent: z.object({ projectId: z.string().min(1).max(256), agentSessionId: z.string().min(1).max(256), workItemId: z.string().max(256).optional(), kind: z.enum(["modify", "refactor", "change_contract", "add", "remove", "verify", "investigate"]), summary: z.string().min(1).max(2000), targets: z.array(z.unknown()).max(100), expiresAt: z.string().max(64).optional() }),
  coord_sync: z.object({ projectId: z.string().min(1).max(256), agentSessionId: z.string().min(1).max(256), sinceSequence: z.string().regex(/^\d+$/).optional(), maxEvents: z.number().int().min(1).max(1000).optional(), maxBytes: z.number().int().min(1).max(4 * 1024 * 1024).optional() }),
  coord_publish: z.object({ projectId: z.string().min(1).max(256), agentSessionId: z.string().min(1).max(256), workItemId: z.string().max(256).optional(), kind: z.enum(["decision", "constraint", "interface_contract", "finding", "task_result", "failure", "handoff", "verification"]), contentDigest: z.string().min(8).max(256), scopeIds: z.array(z.string()).max(100).optional(), codeEntityIds: z.array(z.string()).max(100).optional(), classification: z.string().min(1).max(64), retention: z.string().min(1).max(128), supersedes: z.string().max(256).optional() }),
  coord_complete: z.object({ projectId: z.string().min(1).max(256), agentSessionId: z.string().min(1).max(256), workItemId: z.string().min(1).max(256), evaluationRunId: z.string().max(256).optional() }),
  eval_request: z.object({ specId: z.string().min(1).max(256), workItemId: z.string().min(1).max(256), intentId: z.string().max(256).optional(), changeReceiptId: z.string().max(256).optional(), repositoryStateRef: z.string().min(1).max(1024), attempt: z.number().int().min(1).max(100).optional() }),
  eval_record: z.object({ runId: z.string().min(1).max(256), providerResultId: z.string().min(1).max(256), providerId: z.string().min(1).max(128), criterionId: z.string().min(1).max(128), result: z.object({ criterionId: z.string().min(1).max(128), outcome: z.enum(["pass", "fail", "error", "skipped", "inconclusive"]), evidence: z.array(z.unknown()).max(50), observed: z.unknown().optional(), reasonCode: z.string().max(256).optional() }) }),
  eval_status: z.object({ runId: z.string().min(1).max(256) }),
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
  "coord_join",
  "coord_claim",
  "coord_intent",
  "coord_sync",
  "coord_publish",
  "coord_complete",
  "eval_request",
  "eval_record",
  "eval_status",
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
  coord_join: "Attach an agent session to the local project coordination state.",
  coord_claim: "Claim a versioned coordination work item.",
  coord_intent: "Declare an immutable planned change and its scope.",
  coord_sync: "Read bounded coordination context relevant to the current session.",
  coord_publish: "Publish a typed coordination artifact by digest.",
  coord_complete: "Complete a coordination work item, or place an evaluation-gated item into awaiting_evaluation without releasing it.",
  eval_request: "Request evaluation against an approved spec and exact target state.",
  eval_record: "Record bounded evaluator evidence for one criterion.",
  eval_status: "Read the acceptance decision, feedback, and bounded retry state.",
};

export interface MyPiServerOptions {
  name?: string;
  version?: string;
  runtime: WorkspaceRuntime;
  capabilities: Map<string, Capability<unknown, unknown>>;
  requestLog?: (row: { tool: string; ok: boolean; ms: number; errorCode?: string }) => void;
  maxConcurrentRequests?: number;
  maxQueuedRequests?: number;
}

export class MyPiServer {
  private readonly server: McpServer;
  private readonly registry = new ToolRegistry();
  private readonly requestLimiter: RequestLimiter;

  constructor(private readonly opts: MyPiServerOptions) {
    const server = new McpServer(
      { name: opts.name ?? "my-pi", version: opts.version ?? "0.1.0" },
      { capabilities: { tools: {} } },
    );
    this.server = server;
    this.requestLimiter = new RequestLimiter(opts.maxConcurrentRequests ?? 8, opts.maxQueuedRequests ?? 32);

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
        let release: (() => void) | undefined;
        try {
          release = await this.requestLimiter.acquire(signal);
          const workspace = this.opts.runtime.workspaceOrThrow;
          const capabilityKey = capabilityKeyForTool(def.name);
          if (!workspace.capabilities[capabilityKey]) {
            throw err.permissionDenied(`capability disabled by security profile: ${capabilityKey}`);
          }
          if (def.capability.risk === "write" && workspace.policy.mode !== "workspace-write") {
            throw err.permissionDenied("write capability requires the trusted workspace security profile");
          }
          const mcpCtx: CapabilityContext = {
            requestId,
            workspace,
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
        } finally {
          release?.();
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
