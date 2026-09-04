/** Map a my-pi error to a structured MCP error (SDK v2 line). */
import { isMyPiError, type MyPiErrorCode } from "@my-pi/contracts";

export function myPiCodeToMcpCode(code: MyPiErrorCode): number {
  const base = -32000;
  const offset = codeToOffset(code);
  return base - offset;
}

/** @deprecated Use myPiCodeToMcpCode. Kept as a 1-major alias. */
export const ccrCodeToMcpCode = myPiCodeToMcpCode;

const KNOWN_CODES: readonly MyPiErrorCode[] = [
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
  "ERR_PROJECT_NOT_FOUND",
  "ERR_AGENT_SESSION_NOT_FOUND",
  "ERR_WORK_ITEM_NOT_FOUND",
  "ERR_AGENT_SESSION_EXPIRED",
  "ERR_WORK_ITEM_CONFLICT",
  "ERR_WORK_ITEM_BLOCKED",
  "ERR_SCOPE_CONFLICT",
  "ERR_INTENT_INVALID",
  "ERR_COORDINATION_CURSOR_INVALID",
  "ERR_COORDINATION_STORE_FAILURE",
  "ERR_DAEMON_UNAVAILABLE",
  "ERR_DAEMON_PROTOCOL_MISMATCH",
  "ERR_CODE_STATE_STALE",
  "ERR_POLICY_REVIEW_REQUIRED",
  "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_SCHEMA_MIGRATION_REQUIRED",
  "ERR_EVALUATION_SPEC_INVALID",
  "ERR_EVALUATION_TARGET_STALE",
  "ERR_EVALUATOR_UNAVAILABLE",
  "ERR_EVALUATION_RESULT_CONFLICT",
  "ERR_EVALUATION_INCONCLUSIVE",
  "ERR_RETRY_BUDGET_EXHAUSTED",
  "ERR_EVALUATION_NOT_ACCEPTED",
];

function codeToOffset(code: MyPiErrorCode): number {
  const idx = KNOWN_CODES.indexOf(code);
  return idx === -1 ? KNOWN_CODES.length : idx;
}

/** Typed MCP error shape without importing the legacy SDK class. */
export interface MappedMcpError extends Error {
  code: number;
}

export function toMcpError(e: unknown): MappedMcpError {
  if (isMyPiError(e)) {
    const err = new Error(e.message) as MappedMcpError;
    err.code = myPiCodeToMcpCode(e.code);
    return err;
  }
  const message = e instanceof Error ? e.message : String(e);
  const err = new Error(message) as MappedMcpError;
  err.code = -32000;
  return err;
}
