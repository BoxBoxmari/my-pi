/**
 * V1 required error taxonomy. Transaction-specific errors are intentionally
 * absent from V1.
 */
export const MY_PI_ERROR_CODES = [
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
] as const;

/** @deprecated Use MY_PI_ERROR_CODES. Kept as a 1-major alias. */
export const CCR_ERROR_CODES = MY_PI_ERROR_CODES;

export type MyPiErrorCode = (typeof MY_PI_ERROR_CODES)[number];
/** @deprecated Use MyPiErrorCode. Kept as a 1-major alias. */
export type CcrErrorCode = MyPiErrorCode;

export interface MyPiErrorShape {
  schemaVersion: "1";
  requestId: string;
  code: MyPiErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
/** @deprecated Use MyPiErrorShape. Kept as a 1-major alias. */
export type CcrErrorShape = MyPiErrorShape;

export class MyPiError extends Error {
  readonly schemaVersion = "1" as const;
  readonly code: MyPiErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly requestId: string;

  constructor(opts: {
    code: MyPiErrorCode;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
    requestId?: string;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "MyPiError";
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
    this.requestId = opts.requestId ?? "";
  }

  toShape(): MyPiErrorShape {
    const shape: MyPiErrorShape = {
      schemaVersion: "1",
      requestId: this.requestId,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details !== undefined) shape.details = this.details;
    return shape;
  }
}

/** @deprecated Use MyPiError. Kept as a 1-major alias. */
export const CcrError = MyPiError;

/** Convenience factory helpers. */
export const err = {
  invalidArgument: (msg: string, details?: Record<string, unknown>) =>
    new MyPiError({ code: "ERR_INVALID_ARGUMENT", message: msg, details }),
  workspaceNotFound: (msg = "workspace not found") => new MyPiError({ code: "ERR_WORKSPACE_NOT_FOUND", message: msg }),
  pathOutsideWorkspace: (msg = "path outside workspace") => new MyPiError({ code: "ERR_PATH_OUTSIDE_WORKSPACE", message: msg }),
  pathNotFound: (msg = "path not found") => new MyPiError({ code: "ERR_PATH_NOT_FOUND", message: msg }),
  permissionDenied: (msg = "permission denied") => new MyPiError({ code: "ERR_PERMISSION_DENIED", message: msg }),
  secretPathDenied: (msg = "sensitive path denied") => new MyPiError({ code: "ERR_SECRET_PATH_DENIED", message: msg }),
  staleResource: (msg = "stale resource; re-read before edit") => new MyPiError({ code: "ERR_STALE_RESOURCE", message: msg }),
  ambiguousAnchor: (msg = "short anchor is ambiguous") => new MyPiError({ code: "ERR_AMBIGUOUS_ANCHOR", message: msg }),
  fileBusy: (msg = "file is busy / locked") => new MyPiError({ code: "ERR_FILE_BUSY", message: msg }),
  binaryFile: (msg = "binary file") => new MyPiError({ code: "ERR_BINARY_FILE", message: msg }),
  unsupportedEncoding: (msg = "unsupported encoding") => new MyPiError({ code: "ERR_UNSUPPORTED_ENCODING", message: msg }),
  atomicReplaceFailed: (msg = "atomic replace failed") => new MyPiError({ code: "ERR_ATOMIC_REPLACE_FAILED", message: msg, retryable: true }),
  parseFailed: (msg = "parse failed") => new MyPiError({ code: "ERR_PARSE_FAILED", message: msg }),
  lspUnavailable: (msg = "LSP unavailable") => new MyPiError({ code: "ERR_LSP_UNAVAILABLE", message: msg, retryable: true }),
  lspTimeout: (msg = "LSP request timed out") => new MyPiError({ code: "ERR_LSP_TIMEOUT", message: msg, retryable: true }),
  lspRestartExhausted: (msg = "LSP restart attempts exhausted") => new MyPiError({ code: "ERR_LSP_RESTART_EXHAUSTED", message: msg }),
  nativeUnavailable: (msg = "native backend unavailable") => new MyPiError({ code: "ERR_NATIVE_UNAVAILABLE", message: msg, retryable: true }),
  nativeFailure: (msg = "native backend failure") => new MyPiError({ code: "ERR_NATIVE_FAILURE", message: msg, retryable: true }),
  aborted: (msg = "operation aborted") => new MyPiError({ code: "ERR_ABORTED", message: msg }),
  outputLimit: (msg = "output exceeded limit") => new MyPiError({ code: "ERR_OUTPUT_LIMIT", message: msg }),
  unsupportedCapability: (msg = "unsupported capability") => new MyPiError({ code: "ERR_UNSUPPORTED_CAPABILITY", message: msg }),
  protocolCompatibility: (msg = "MCP protocol compatibility error") => new MyPiError({ code: "ERR_PROTOCOL_COMPATIBILITY", message: msg }),
  projectNotFound: (msg = "project not found") => new MyPiError({ code: "ERR_PROJECT_NOT_FOUND", message: msg }),
  agentSessionNotFound: (msg = "agent session not found") => new MyPiError({ code: "ERR_AGENT_SESSION_NOT_FOUND", message: msg }),
  workItemNotFound: (msg = "work item not found") => new MyPiError({ code: "ERR_WORK_ITEM_NOT_FOUND", message: msg }),
  agentSessionExpired: (msg = "agent session expired") => new MyPiError({ code: "ERR_AGENT_SESSION_EXPIRED", message: msg }),
  workItemConflict: (msg = "work item version conflict") => new MyPiError({ code: "ERR_WORK_ITEM_CONFLICT", message: msg }),
  workItemBlocked: (msg = "work item is blocked") => new MyPiError({ code: "ERR_WORK_ITEM_BLOCKED", message: msg }),
  scopeConflict: (msg = "scope conflict") => new MyPiError({ code: "ERR_SCOPE_CONFLICT", message: msg }),
  intentInvalid: (msg = "invalid intent") => new MyPiError({ code: "ERR_INTENT_INVALID", message: msg }),
  coordinationCursorInvalid: (msg = "invalid coordination cursor") => new MyPiError({ code: "ERR_COORDINATION_CURSOR_INVALID", message: msg }),
  coordinationStoreFailure: (msg = "coordination store failure") => new MyPiError({ code: "ERR_COORDINATION_STORE_FAILURE", message: msg, retryable: true }),
  daemonUnavailable: (msg = "coordination daemon unavailable") => new MyPiError({ code: "ERR_DAEMON_UNAVAILABLE", message: msg, retryable: true }),
  daemonProtocolMismatch: (msg = "coordination daemon protocol mismatch") => new MyPiError({ code: "ERR_DAEMON_PROTOCOL_MISMATCH", message: msg }),
  codeStateStale: (msg = "code state is stale") => new MyPiError({ code: "ERR_CODE_STATE_STALE", message: msg }),
  policyReviewRequired: (msg = "policy review required") => new MyPiError({ code: "ERR_POLICY_REVIEW_REQUIRED", message: msg }),
  idempotencyConflict: (msg = "idempotency key conflicts with a different request") => new MyPiError({ code: "ERR_IDEMPOTENCY_CONFLICT", message: msg }),
  schemaMigrationRequired: (msg = "schema migration required") => new MyPiError({ code: "ERR_SCHEMA_MIGRATION_REQUIRED", message: msg }),
  evaluationSpecInvalid: (msg = "evaluation spec is invalid") => new MyPiError({ code: "ERR_EVALUATION_SPEC_INVALID", message: msg }),
  evaluationTargetStale: (msg = "evaluation target state is stale") => new MyPiError({ code: "ERR_EVALUATION_TARGET_STALE", message: msg }),
  evaluatorUnavailable: (msg = "evaluator unavailable") => new MyPiError({ code: "ERR_EVALUATOR_UNAVAILABLE", message: msg, retryable: true }),
  evaluationResultConflict: (msg = "evaluation result conflicts with a prior result") => new MyPiError({ code: "ERR_EVALUATION_RESULT_CONFLICT", message: msg }),
  evaluationInconclusive: (msg = "evaluation is inconclusive") => new MyPiError({ code: "ERR_EVALUATION_INCONCLUSIVE", message: msg }),
  retryBudgetExhausted: (msg = "retry budget exhausted") => new MyPiError({ code: "ERR_RETRY_BUDGET_EXHAUSTED", message: msg }),
  evaluationNotAccepted: (msg = "work item requires an accepted evaluation before completion") => new MyPiError({ code: "ERR_EVALUATION_NOT_ACCEPTED", message: msg }),
};

export function isMyPiError(value: unknown): value is MyPiError {
  return value instanceof MyPiError;
}

/** @deprecated Use isMyPiError. Kept as a 1-major alias. */
export const isCcrError = isMyPiError;

/**
 * Map a Node.js filesystem error to a my-pi error code.
 */
export function nodeErrorToCode(code: string | undefined, pathHint?: string): MyPiErrorCode {
  switch (code) {
    case "ENOENT":
      return "ERR_PATH_NOT_FOUND";
    case "EACCES":
    case "EPERM":
      return pathHint?.includes(".env") ? "ERR_SECRET_PATH_DENIED" : "ERR_PERMISSION_DENIED";
    case "EBUSY":
      return "ERR_FILE_BUSY";
    case "EMFILE":
    case "ENFILE":
      return "ERR_FILE_BUSY";
    case "EPIPE":
      return "ERR_FILE_BUSY";
    default:
      return "ERR_NATIVE_FAILURE";
  }
}
