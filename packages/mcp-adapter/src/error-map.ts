/** Map a CCR error to a structured MCP error (SDK v2 line). */
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

/** Typed MCP error shape without importing the legacy SDK class. */
export interface MappedMcpError extends Error {
  code: number;
}

export function toMcpError(e: unknown): MappedMcpError {
  if (isCcrError(e)) {
    const err = new Error(e.message) as MappedMcpError;
    err.code = ccrCodeToMcpCode(e.code);
    return err;
  }
  const message = e instanceof Error ? e.message : String(e);
  const err = new Error(message) as MappedMcpError;
  err.code = -32000;
  return err;
}
