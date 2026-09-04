import { chmod, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { isMyPiError } from "@my-pi/contracts";
import {
  decodeFrame,
  encodeFrame,
  IPC_PROTOCOL_VERSION,
  MAX_IPC_FRAME_BYTES,
  MAX_IPC_RESPONSE_BYTES,
  parseRequest,
  type IpcError,
  type IpcRequest,
  type IpcResponse,
} from "@my-pi/coordination-client";
import type { IpcEndpoint } from "@my-pi/coordination-client";

export type IpcHandler = (request: IpcRequest) => Promise<unknown>;

function errorShape(error: unknown): IpcError {
  if (isMyPiError(error)) return { code: error.code, message: error.message, retryable: error.retryable, details: error.details };
  const value = error as { code?: unknown; message?: unknown; retryable?: unknown; details?: unknown };
  return {
    code: typeof value?.code === "string" ? value.code : "ERR_COORDINATION_STORE_FAILURE",
    message: typeof value?.message === "string" ? value.message : String(error),
    retryable: value?.retryable === true,
    ...(value?.details && typeof value.details === "object" ? { details: value.details as Record<string, unknown> } : {}),
  };
}

export class IpcServer {
  private server?: Server;
  private readonly sockets = new Set<Socket>();

  constructor(
    private readonly endpoint: IpcEndpoint,
    private readonly handler: IpcHandler,
    private readonly maxFrameBytes = MAX_IPC_FRAME_BYTES,
    private readonly protocolVersion: string = IPC_PROTOCOL_VERSION,
  ) {}

  async listen(): Promise<void> {
    if (this.endpoint.transport === "unix") await unlink(this.endpoint.address).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    const server = createServer((socket) => this.handleSocket(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(Object.assign(new Error(error.message), { code: "ERR_DAEMON_ALREADY_RUNNING", cause: error }));
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.endpoint.address);
    });
    if (this.endpoint.transport === "unix") await chmod(this.endpoint.address, 0o600).catch(() => undefined);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (this.endpoint.transport === "unix") await unlink(this.endpoint.address).catch(() => undefined);
  }

  private handleSocket(socket: Socket): void {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    socket.setTimeout(10_000, () => socket.destroy());
    let buffer = Buffer.alloc(0);
    let handled = false;
    socket.on("data", (chunk: Buffer) => {
      if (handled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > this.maxFrameBytes) {
        handled = true;
        void this.sendError(socket, "", { code: "ERR_OUTPUT_LIMIT", message: "IPC request exceeds the configured frame limit" });
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      handled = true;
      const frame = buffer.subarray(0, newline);
      void this.processFrame(socket, frame);
    });
  }

  private async processFrame(socket: Socket, frame: Buffer): Promise<void> {
    let request: IpcRequest;
    try {
      request = parseRequest(decodeFrame(frame));
    } catch (error) {
      await this.sendError(socket, "", { code: "ERR_INVALID_ARGUMENT", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (request.protocolVersion !== this.protocolVersion) {
      await this.sendError(socket, request.requestId, { code: "ERR_DAEMON_PROTOCOL_MISMATCH", message: `unsupported IPC protocol version: ${request.protocolVersion}` });
      return;
    }
    const started = performance.now();
    try {
      const result = await this.handler(request);
      const response: IpcResponse = { requestId: request.requestId, ok: true, result, timing: { totalMs: performance.now() - started } };
      socket.end(encodeFrame(response, MAX_IPC_RESPONSE_BYTES));
    } catch (error) {
      await this.sendError(socket, request.requestId, errorShape(error), performance.now() - started);
    }
  }

  private async sendError(socket: Socket, requestId: string, error: IpcError, totalMs = 0): Promise<void> {
    const response: IpcResponse = { requestId, ok: false, error, timing: { totalMs } };
    try {
      socket.end(encodeFrame(response, MAX_IPC_RESPONSE_BYTES));
    } catch {
      socket.destroy();
    }
  }
}
