/** Map a CCR error to a structured MCP error. */
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { isCcrError, type CcrErrorCode } from "@ccr/contracts";

export function ccrCodeToMcpCode(code: CcrErrorCode): number {
  const base = -32000;
  const offset = codeToOffset(code);
  return base - offset;
}

const KNOWN_CODES: readonly CcrErrorCode[] = [
  "ERR_INVALID_ARGUMENT",
  "ERR_WORKSPACE_NOT_FOUND",
  "ERR_PATH_OUTSIDE_WORKSPACE",
  "ERR_PATH_NOT_FOUND",
  "ERR_PERMISSION_DENIED",
  "ERR_SECRET_PATH_DENIED",
  "ERR_STALE_RESOURCE",
  "ERR_AMBIGUOUS_ANCHOR",
  "ERR_FILE_BUSY",
  "ERR_BINARY_FILE",
  "ERR_UNSUPPORTED_ENCODING",
  "ERR_ATOMIC_REPLACE_FAILED",
  "ERR_PARSE_FAILED",
  "ERR_LSP_UNAVAILABLE",
  "ERR_LSP_TIMEOUT",
  "ERR_LSP_RESTART_EXHAUSTED",
  "ERR_NATIVE_UNAVAILABLE",
  "ERR_NATIVE_FAILURE",
  "ERR_ABORTED",
  "ERR_OUTPUT_LIMIT",
  "ERR_UNSUPPORTED_CAPABILITY",
  "ERR_PROTOCOL_COMPATIBILITY",
];

function codeToOffset(code: CcrErrorCode): number {
  const idx = KNOWN_CODES.indexOf(code);
  return idx === -1 ? KNOWN_CODES.length : idx;
}

export function toMcpError(e: unknown): McpError {
  if (isCcrError(e)) {
    return new McpError(ccrCodeToMcpCode(e.code), e.message);
  }
  const message = e instanceof Error ? e.message : String(e);
  return new McpError(-32000, message);
}
