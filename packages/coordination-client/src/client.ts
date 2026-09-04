import net from "node:net";
import { createRequestId } from "@my-pi/contracts";
import { withBoundedRetry } from "./retry.js";
import {
  decodeFrame,
  encodeFrame,
  IPC_PROTOCOL_VERSION,
  MAX_IPC_FRAME_BYTES,
  MAX_IPC_RESPONSE_BYTES,
  type IpcResponse,
} from "./protocol.js";
import { readDaemonMetadata, type DaemonMetadata, type IpcEndpoint } from "./discovery.js";

export interface CoordinationClientOptions {
  endpoint: IpcEndpoint;
  protocolVersion?: string;
  clientInfo?: { name: string; version: string };
  timeoutMs?: number;
  maxAttempts?: number;
}

export class CoordinationClient {
  readonly endpoint: IpcEndpoint;
  private readonly protocolVersion: string;
  private readonly clientInfo: { name: string; version: string };
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(options: CoordinationClientOptions) {
    this.endpoint = options.endpoint;
    this.protocolVersion = options.protocolVersion ?? IPC_PROTOCOL_VERSION;
    this.clientInfo = options.clientInfo ?? { name: "my-pi-coordination-client", version: "0.1.0" };
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  static async fromRuntimeDir(runtimeDir: string, options: Omit<CoordinationClientOptions, "endpoint"> = {}): Promise<CoordinationClient> {
    const metadata = await readDaemonMetadata(runtimeDir);
    if (!metadata) throw Object.assign(new Error("coordination daemon metadata not found"), { code: "ERR_DAEMON_UNAVAILABLE", retryable: true });
    return new CoordinationClient({ ...options, endpoint: metadata.endpoint });
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
    if (method === "eval" || method === "execute") throw new Error("generic IPC execution methods are not supported");
    const request = {
      protocolVersion: this.protocolVersion,
      requestId: createRequestId(),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      method,
      params,
      clientInfo: this.clientInfo,
    };
    return withBoundedRetry(() => this.callOnce<T>(request), {
      maxAttempts: this.maxAttempts,
      shouldRetry: (error) => Boolean((error as { retryable?: boolean }).retryable),
    });
  }

  async health(): Promise<unknown> {
    return this.call("health");
  }

  private async callOnce<T>(request: { requestId: string; [key: string]: unknown }): Promise<T> {
    const frame = encodeFrame(request, MAX_IPC_FRAME_BYTES);
    return new Promise<T>((resolve, reject) => {
      const socket = net.createConnection(this.endpoint.address);
      let buffer = Buffer.alloc(0);
      let settled = false;
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        if (error) reject(error);
        else resolve(value as T);
      };
      socket.setTimeout(this.timeoutMs, () => finish(Object.assign(new Error("coordination IPC request timed out"), { code: "ERR_DAEMON_UNAVAILABLE", retryable: true })));
      socket.on("error", (error) => finish(Object.assign(new Error(error.message), { code: "ERR_DAEMON_UNAVAILABLE", retryable: true, cause: error })));
      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.byteLength > MAX_IPC_RESPONSE_BYTES) {
          finish(Object.assign(new Error("coordination IPC response exceeded limit"), { code: "ERR_OUTPUT_LIMIT" }));
          return;
        }
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) return;
        const raw = buffer.subarray(0, newline);
        try {
          const response = decodeFrame(raw) as IpcResponse<T>;
          if (!response || typeof response !== "object" || typeof response.ok !== "boolean") throw new Error("invalid IPC response");
          if (response.requestId !== request.requestId) throw new Error("IPC response requestId does not match request");
          if (!response.ok || response.error) {
            const error = Object.assign(new Error(response.error?.message ?? "coordination IPC request failed"), response.error ?? { code: "ERR_DAEMON_UNAVAILABLE" });
            finish(error);
            return;
          }
          finish(undefined, response.result);
        } catch (error) {
          finish(error);
        }
      });
      socket.once("connect", () => socket.write(frame));
    });
  }
}

export function metadataEndpoint(metadata: DaemonMetadata): IpcEndpoint {
  return metadata.endpoint;
}
