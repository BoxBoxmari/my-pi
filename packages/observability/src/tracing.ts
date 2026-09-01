import { createRequestId, type RequestId } from "@ccr/contracts";

export interface TraceSpan {
  trace_id: string;
  request_id: RequestId;
  host_profile?: string;
  selected_mcp_era?: string;
  transport?: string;
  workspace_id?: string;
  tool_name?: string;
  backend?: string;
  degraded?: boolean;
  duration_ms?: number;
  native_duration_ms?: number;
  io_duration_ms?: number;
  output_bytes?: number;
  status?: string;
  error_code?: string;
}

export class Tracer {
  newTrace(): { trace_id: string; request_id: RequestId } {
    return { trace_id: crypto.randomUUID(), request_id: createRequestId() };
  }
}
