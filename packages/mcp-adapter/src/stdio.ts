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
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
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
    path: z.string().describe("Workspace-relative file path to read (e.g. src/index.ts). Must stay inside the workspace root."),
    offset: z.number().int().min(0).optional().describe("Byte offset to start reading from. Default 0. Use next_offset from a prior truncated read to page forward."),
    max_bytes: z.number().int().min(1).max(MAX_FS_READ_BYTES).optional().describe("Max bytes to return in this window (1..1048576). Default is a ~64KB window. Smaller windows page large files."),
  }),
  fs_stat: z.object({ path: z.string().describe("Workspace-relative file or directory path to stat (e.g. src or src/index.ts). Never reads file contents.") }),
  fs_write: z.object({
    path: z.string().describe("Workspace-relative destination file path. Parent directories must already exist or be inside the workspace."),
    content: z.string().max(MAX_FS_WRITE_BYTES).describe("Full UTF-8 replacement content for the file (max 8MB). This replaces the entire file."),
    expected_hash: z.string().optional().describe("sha256:... fingerprint from a prior fs_read. Required when overwriting an existing file; omit only for new files. Mismatches fail with stale-resource."),
  }),
  fs_patch: z.object({
    path: z.string().describe("Workspace-relative path of the existing file to patch. Must already exist and be a text file."),
    patch: z.object({ hunks: z.array(z.object({ old: z.string().max(MAX_PATCH_TEXT_BYTES).describe("Exact verbatim text to match in the current file."), new: z.string().max(MAX_PATCH_TEXT_BYTES).describe("Replacement text for the matched old block.") })).max(MAX_PATCH_HUNKS).describe("Ordered list of old/new hunks applied verbatim (max 1000 hunks).") }),
    expected_hash: z.string().optional().describe("sha256:... fingerprint from a prior fs_read. Required; the patch fails with stale-resource when the file changed since the read."),
  }),
  search: z.object({
    mode: z.enum(["grep", "glob"]).describe("grep searches file contents; glob matches filenames (e.g. **/*.ts)."),
    pattern: z.string().describe("Grep text/regex (mode=grep) or glob pattern (mode=glob, e.g. src/**/*.ts). Max ~2KB."),
    path: z.string().optional().describe("Optional workspace-relative directory to scope the search. Defaults to the workspace root. Files are rejected; use a directory."),
  }),
  ast_search: z.object({
    pattern: z.string().max(MAX_AST_QUERY_BYTES).describe("Tree-sitter query (e.g. (function_declaration name: (identifier) @name)) or node-type/text to match (e.g. function_declaration). Max 8KB."),
    paths: z.array(z.string()).max(MAX_AST_PATHS).describe("Workspace-relative files or directories to search (max 2000). Omit to scan the workspace excluding dot/node_modules/target/dist."),
    mode: z.enum(["text", "query"]).optional().describe("text matches node types/text; query runs a Tree-sitter query with @captures. Auto-detected when omitted."),
  }),
  lsp_status: z.object({}),
  lsp_diagnostics: z.object({ path: z.string().describe("Workspace-relative source file to get compiler/linter diagnostics for (e.g. src/index.ts).") }),
  lsp_symbols: z.object({ path: z.string().describe("Workspace-relative source file to outline (functions, classes, methods, variables).") }),
  lsp_navigate: z.object({
    action: z.enum(["definition", "references", "hover"]).describe("definition jumps to declaration, references lists usages, hover shows documentation."),
    path: z.string().describe("Workspace-relative source file containing the symbol position."),
    line: z.number().int().min(0).max(1_000_000).optional().describe("0-based line number of the symbol. Default 0. Get exact lines from lsp_symbols."),
    column: z.number().int().min(0).max(1_000_000).optional().describe("0-based column number of the symbol. Default 0."),
  }),
  vcs_status: z.object({ path: z.string().optional().describe("Optional workspace-relative directory to scope git status. Defaults to the workspace root. Must stay inside the workspace.") }),
  vcs_diff: z.object({ path: z.string().optional().describe("Optional workspace-relative directory or file to scope the git diff. Defaults to the workspace root. Large diffs spill to an artifact reference.") }),
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
  eval_evaluate: z.object({ runId: z.string().min(1).max(256), observed: z.record(z.string(), z.unknown()).optional() }),
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
  "eval_evaluate",
  "eval_status",
]);

export function toolAvailability(name: string): "implemented" | "planned" {
  return IMPLEMENTED_TOOLS.has(name) ? "implemented" : "planned";
}

const DESCRIPTIONS: Record<string, string> = {
  workspace_info: "Inspect the configured workspace root, policy mode, and available capabilities. Takes no parameters. Returns workspace id, absolute root, revision, policyMode (read-only vs workspace-write), capability flags, and backend health. Read-only with no side effects. Call first to confirm scope and write permission before fs_*, search, lsp_*, or vcs_* tools; do not use it for file content — use fs_read or fs_stat instead.",
  fs_read: "Read a byte-window of one workspace file and get a stale-safe snapshot for later writes. Params: path (required), offset (default 0), max_bytes (1..1048576, default ~64KB). Returns content, encoding, newline, size, content_hash (sha256:...), anchor, snapshot_id, truncated and next_offset for paging. Read-only; records a snapshot without mutating. Use to inspect source before fs_patch/fs_write and to obtain expected_hash; prefer fs_stat for metadata only, search to locate files.",
  fs_stat: "Stat one workspace path without opening it. Param: path (required file or directory). Returns path, exists, isFile, isDirectory, isSymbolicLink, size, and mtimeMs. Read-only with no side effects. Use to verify existence, distinguish files from directories, and check size/mtime before fs_read; not for content, search, or history — use fs_read, search, or vcs_status for those.",
  fs_write: "Atomically replace or create exactly one workspace file (stale-safe). Params: path (required), content (full UTF-8 replacement, max 8MB, required), expected_hash from fs_read (required when overwriting, omit only for new files). Returns path, content_hash, anchor, snapshot_id, size, and encoding. Mutates one file only; requires trusted profile with workspace-write mode; fails stale-resource on hash mismatch. Use for new files or full rewrites; prefer fs_patch for small edits.",
  fs_patch: "Apply hashline-style hunks to exactly one existing text file (stale-safe). Params: path (required), patch.hunks[] with verbatim old/new strings (max 1000 hunks, 1MB each), expected_hash from fs_read (required). Returns path, new content_hash, anchor, size, and committed flag. Mutates one file only; rejects on fuzzy match, binary, or stale hash. Use for targeted edits after fs_read; prefer fs_write for new files or full rewrites.",
  search: "Search workspace filenames (glob) or file contents (grep) with sensitive-path filtering. Params: mode grep|glob (required), pattern (required, grep text or glob like **/*.ts), path (optional directory scope, defaults to root). Returns up to 20 visible matches with totalCount and truncated flag. Read-only; skips blocked paths (.env, .aws, .ssh unless allow-listed). Use to locate files or text before fs_read/ast_search; prefer ast_search for syntax-aware code search.",
  ast_search: "Syntax-aware structural search over TypeScript, JavaScript, Python, Rust, and Go via Tree-sitter. Params: pattern (required, Tree-sitter query with @captures or node-type/text like function_declaration), paths (optional files/dirs, max 2000; defaults to workspace scan excluding dot/node_modules/target/dist), mode text|query (optional, auto-detected). Returns matches with path, line/column range, captures, and text plus totalCount/truncated. Read-only. Use to find functions, classes, or calls by syntax; prefer search for plain text, lsp_navigate for a known symbol.",
  lsp_status: "Report language-server health for the workspace. Takes no parameters. Returns servers[] with language, state, and workspace binding. Read-only with no side effects. Call to confirm LSP readiness before lsp_diagnostics, lsp_symbols, or lsp_navigate and to diagnose degraded responses; not for code content — use fs_read or lsp_symbols for that.",
  lsp_diagnostics: "Get compiler and linter diagnostics for one file via its language server. Param: path (required source file). Returns path and diagnostics[] (severity, range, message, source); empty with degraded flag plus error when the server is unavailable or the language is unsupported. Read-only; opens the document in the server without touching disk. Use after edits to verify no new errors; prefer lsp_symbols for structure, lsp_navigate for jumps.",
  lsp_symbols: "List document symbols (functions, classes, methods, variables) for one file. Param: path (required source file). Returns path and symbols[] with name, kind, range, and selection range; empty when the language is unsupported. Read-only. Use to outline unfamiliar files and get line numbers before lsp_navigate or fs_read windows; prefer ast_search for cross-file structural queries, search for plain text.",
  lsp_navigate: "Jump to definition, list references, or show hover documentation at a file position via LSP. Params: action definition|references|hover (required), path (required), line/column 0-based (default 0; get exact lines from lsp_symbols). Returns action, path, plus locations[] (workspace-relative; external URIs filtered with filteredExternal count) or hover content. Read-only, never mutates. Use to trace symbols across files; prefer ast_search for pattern-wide search, fs_read for surrounding code.",
  vcs_status: "Show git working-tree status for the workspace or a subdirectory. Param: path (optional directory scope, defaults to workspace root; must stay inside workspace). Returns branch plus staged, unstaged, and untracked entries with backend metadata. Read-only; never stages, commits, or touches files. Call before editing to see dirty state and after edits to confirm scope; use vcs_diff for actual hunks, fs_read for file content.",
  vcs_diff: "Show uncommitted git diff (staged, unstaged, plus untracked summary) for the workspace or a subdirectory. Param: path (optional scope, defaults to workspace root). Returns unified diff hunks with file paths; large diffs spill to a private artifact reference and sensitive paths are filtered by policy. Read-only, never mutates. Use after vcs_status to review changes before editing; prefer fs_read for full single-file content without history.",
  coord_join: "Attach an agent session to the local project coordination state.",
  coord_claim: "Claim a versioned coordination work item.",
  coord_intent: "Declare an immutable planned change and its scope.",
  coord_sync: "Read bounded coordination context relevant to the current session.",
  coord_publish: "Publish a typed coordination artifact by digest.",
  coord_complete: "Complete a coordination work item, or place an evaluation-gated item into awaiting_evaluation without releasing it.",
  eval_request: "Request evaluation against an approved spec and exact target state.",
  eval_record: "Declare external evaluator evidence; declarations remain unverified until a trusted provider evaluates the run.",
  eval_evaluate: "Run the server-registered evaluator providers against the requested evaluation run.",
  eval_status: "Read the acceptance decision, feedback, and bounded retry state.",
};

const TOOL_TITLES: Record<string, string> = {
  workspace_info: "Workspace info",
  fs_read: "Read file",
  fs_stat: "Stat path",
  fs_write: "Write file",
  fs_patch: "Patch file",
  search: "Search workspace",
  ast_search: "AST search",
  lsp_status: "LSP status",
  lsp_diagnostics: "LSP diagnostics",
  lsp_symbols: "LSP symbols",
  lsp_navigate: "LSP navigate",
  vcs_status: "VCS status",
  vcs_diff: "VCS diff",
};

interface ToolAnnotationHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const TOOL_ANNOTATIONS: Record<string, ToolAnnotationHints> = {
  workspace_info: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  fs_read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  fs_stat: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  fs_write: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  fs_patch: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  search: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  ast_search: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  lsp_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  lsp_diagnostics: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  lsp_symbols: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  lsp_navigate: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  vcs_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  vcs_diff: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export interface MyPiServerOptions {
  name?: string;
  version?: string;
  runtime: WorkspaceRuntime;
  capabilities: Map<string, Capability<unknown, unknown>>;
  requestLog?: (row: { tool: string; ok: boolean; ms: number; errorCode?: string }) => void;
  maxConcurrentRequests?: number;
  maxQueuedRequests?: number;
  /** Opt-in MCP Apps resource; never changes the stable tool catalog. */
  visuals?: {
    enabled: boolean;
    supportedHost?: boolean;
    readHtml: () => string | Promise<string>;
    readTheaterHtml?: () => string | Promise<string>;
  };
}

export class MyPiServer {
  private readonly server: McpServer;
  private readonly registry = new ToolRegistry();
  private readonly requestLimiter: RequestLimiter;
  readonly visualsStatus: "disabled" | "registered" | "degraded";

  constructor(private readonly opts: MyPiServerOptions) {
    const server = new McpServer(
      { name: opts.name ?? "my-pi", version: opts.version ?? "0.1.0" },
      { capabilities: { tools: {}, ...(opts.visuals?.enabled ? { resources: {} } : {}) } },
    );
    this.server = server;
    this.requestLimiter = new RequestLimiter(opts.maxConcurrentRequests ?? 8, opts.maxQueuedRequests ?? 32);
    this.visualsStatus = !opts.visuals?.enabled ? "disabled" : opts.visuals.supportedHost === false ? "degraded" : this.registerVisualsResource(opts.visuals) ? "registered" : "degraded";

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

  private registerVisualsResource(visuals: { readHtml: () => string | Promise<string>; readTheaterHtml?: () => string | Promise<string> }): boolean {
    const registerResource = (this.server as unknown as { registerResource?: (...args: unknown[]) => unknown }).registerResource;
    if (typeof registerResource !== "function") return false;
    registerAppResource(
      this.server as unknown as Pick<McpServer, "registerResource">,
      "my-pi-graph",
      "ui://my-pi/graph",
      {
        title: "my-pi graph view",
        description: "Read-only bounded graph view for code, impact, work, and lineage data.",
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: await visuals.readHtml() }],
      }),
    );
    if (visuals.readTheaterHtml) {
      registerAppResource(
        this.server as unknown as Pick<McpServer, "registerResource">,
        "my-pi-theater",
        "ui://my-pi/theater",
        {
          title: "my-pi theater view",
          description: "Read-only 3D isometric and 2D spatial Agent Operations Theater for live coordination events.",
        },
        async (uri) => ({
          contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: await visuals.readTheaterHtml!() }],
        }),
      );
    }
    return true;
  }

  /** Observe the negotiated era (P0.6). Called with the value the SDK/transport negotiated. */
  observeEra(era: string): void {
    setObservedEra(era);
  }

  private registerTool(def: ToolDefinition): void {
    this.server.registerTool(
      def.name,
      {
        title: TOOL_TITLES[def.name],
        description: def.description,
        inputSchema: SCHEMAS[def.name]!,
        ...(TOOL_ANNOTATIONS[def.name] ? { annotations: TOOL_ANNOTATIONS[def.name] } : {}),
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
