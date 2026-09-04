export const IPC_PROTOCOL_VERSION = "1" as const;
export const MAX_IPC_FRAME_BYTES = 256 * 1024;
export const MAX_IPC_RESPONSE_BYTES = 1024 * 1024;

export interface IpcClientInfo {
  name: string;
  version: string;
}

export interface IpcRequest {
  protocolVersion: string;
  requestId: string;
  idempotencyKey?: string;
  method: string;
  params: Record<string, unknown>;
  clientInfo: IpcClientInfo;
}

export interface IpcError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface IpcResponse<T = unknown> {
  requestId: string;
  ok: boolean;
  result?: T;
  error?: IpcError;
  timing: { totalMs: number };
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { __myPiBigInt: value.toString() } : value;
}

function jsonReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "__myPiBigInt" in value) {
    return BigInt(String((value as { __myPiBigInt: unknown }).__myPiBigInt));
  }
  return value;
}

export function encodeFrame(value: unknown, maxBytes = MAX_IPC_FRAME_BYTES): Buffer {
  const text = JSON.stringify(value, jsonReplacer);
  if (text === undefined) throw new TypeError("IPC message must be JSON serializable");
  const frame = Buffer.from(`${text}\n`, "utf8");
  if (frame.byteLength > maxBytes) throw new RangeError(`IPC frame exceeds ${maxBytes} bytes`);
  return frame;
}

export function decodeFrame(frame: Buffer | string): unknown {
  const text = Buffer.isBuffer(frame) ? frame.toString("utf8") : frame;
  try {
    return JSON.parse(text, jsonReviver);
  } catch (error) {
    throw new Error(`invalid IPC JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseRequest(value: unknown): IpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("IPC request must be an object");
  const request = value as Partial<IpcRequest>;
  if (typeof request.protocolVersion !== "string" || request.protocolVersion.length > 32) throw new Error("IPC protocolVersion is invalid");
  if (typeof request.requestId !== "string" || request.requestId.length === 0 || request.requestId.length > 128) throw new Error("IPC requestId is invalid");
  if (request.idempotencyKey !== undefined && (typeof request.idempotencyKey !== "string" || request.idempotencyKey.length > 256)) throw new Error("IPC idempotencyKey is invalid");
  if (typeof request.method !== "string" || request.method.length === 0 || request.method.length > 128) throw new Error("IPC method is invalid");
  if (!request.params || typeof request.params !== "object" || Array.isArray(request.params)) throw new Error("IPC params must be an object");
  if (!request.clientInfo || typeof request.clientInfo !== "object") throw new Error("IPC clientInfo is required");
  const clientInfo = request.clientInfo as Partial<IpcClientInfo>;
  if (typeof clientInfo.name !== "string" || clientInfo.name.length > 128 || typeof clientInfo.version !== "string" || clientInfo.version.length > 64) {
    throw new Error("IPC clientInfo is invalid");
  }
  return {
    protocolVersion: request.protocolVersion,
    requestId: request.requestId,
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
    method: request.method,
    params: request.params as Record<string, unknown>,
    clientInfo: { name: clientInfo.name, version: clientInfo.version },
  };
}
