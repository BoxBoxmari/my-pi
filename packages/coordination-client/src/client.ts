import net from "node:net";
import { createRequestId } from "@my-pi/contracts";
import type { GraphKind, GraphSnapshot, GraphTrace } from "@my-pi/graph-model";
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

export interface GraphSnapshotRequest {
  projectId: string;
  kind: GraphKind;
  worktreeId?: string;
  subjectId?: string;
  maxNodes?: number;
  maxEdges?: number;
  maxAttributeBytes?: number;
  signal?: AbortSignal;
}

export interface GraphExpansionRequest extends GraphSnapshotRequest {
  nodeId: string;
  depth?: number;
}

export interface GraphTraceRequest extends GraphSnapshotRequest {
  fromNodeId: string;
  toNodeId: string;
  maxDepth?: number;
}

export interface GraphEventsRequest {
  projectId: string;
  kind?: GraphKind;
  worktreeId?: string;
  subjectId?: string;
  mode?: "live" | "replay";
  afterSequence?: string;
  fromSequence?: string;
  toSequence?: string;
  maxEvents?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface GraphEventsResponse {
  events: Array<{
    projectId: string;
    sequence: string;
    eventId: string;
    eventType: string;
    occurredAt: string;
    actor: { kind: string; id?: string; name?: string };
    correlationId?: string;
    causationId?: string;
    payload?: unknown;
  }>;
  throughSequence: string;
  hasMore: boolean;
}

export interface ProvenanceReportRequest {
  projectId: string;
  worktreeId: string;
  path?: string;
  maxResults?: number;
  signal?: AbortSignal;
}

export interface ProvenanceReport {
  schemaVersion: "my-pi/provenance-report/v1";
  projectId: string;
  worktreeId: string;
  results: Array<{
    projectId: string;
    worktreeId: string;
    path: string;
    status: "managed" | "unmanaged" | "stale_lineage" | "unknown" | "exempt";
    reasonCodes: string[];
    observedAt: string;
    receiptId?: string;
    previous?: unknown;
    current?: unknown;
  }>;
  truncated: boolean;
  cursor?: { next: string };
  degraded?: { provider: string; reason: string };
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

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, idempotencyKey?: string, signal?: AbortSignal): Promise<T> {
    if (method === "eval" || method === "execute") throw new Error("generic IPC execution methods are not supported");
    if (signal?.aborted) throw Object.assign(new Error("coordination IPC request aborted"), { code: "ERR_ABORTED", retryable: false });
    const request = {
      protocolVersion: this.protocolVersion,
      requestId: createRequestId(),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      method,
      params,
      clientInfo: this.clientInfo,
    };
    return withBoundedRetry(() => this.callOnce<T>(request, signal), {
      maxAttempts: this.maxAttempts,
      shouldRetry: (error) => Boolean((error as { retryable?: boolean }).retryable),
    });
  }

  async health(): Promise<unknown> {
    return this.call("health");
  }

  async graphSnapshot(input: GraphSnapshotRequest): Promise<GraphSnapshot> {
    const { signal, ...params } = input;
    return this.call<GraphSnapshot>("graph_snapshot", params as unknown as Record<string, unknown>, undefined, signal);
  }

  async graphExpand(input: GraphExpansionRequest): Promise<GraphSnapshot> {
    const { signal, ...params } = input;
    return this.call<GraphSnapshot>("graph_expand", params as unknown as Record<string, unknown>, undefined, signal);
  }

  async graphTrace(input: GraphTraceRequest): Promise<GraphTrace> {
    const { signal, ...params } = input;
    return this.call<GraphTrace>("graph_trace", params as unknown as Record<string, unknown>, undefined, signal);
  }

  async graphEvents(input: GraphEventsRequest): Promise<GraphEventsResponse> {
    const { signal, ...params } = input;
    return this.call<GraphEventsResponse>("graph_events", params as unknown as Record<string, unknown>, undefined, signal);
  }

  async provenanceReport(input: ProvenanceReportRequest): Promise<ProvenanceReport> {
    const { signal, ...params } = input;
    return this.call<ProvenanceReport>("provenance_report", params as unknown as Record<string, unknown>, undefined, signal);
  }

  private async callOnce<T>(request: { requestId: string; [key: string]: unknown }, signal?: AbortSignal): Promise<T> {
    const frame = encodeFrame(request, MAX_IPC_FRAME_BYTES);
    return new Promise<T>((resolve, reject) => {
      const socket = net.createConnection(this.endpoint.address);
      let buffer = Buffer.alloc(0);
      let settled = false;
      const onAbort = () => finish(Object.assign(new Error("coordination IPC request aborted"), { code: "ERR_ABORTED", retryable: false }));
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        socket.removeAllListeners();
        socket.destroy();
        if (error) reject(error);
        else resolve(value as T);
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
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
