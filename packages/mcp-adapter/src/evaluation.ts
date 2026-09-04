import { CoordinationClient } from "@my-pi/coordination-client";
import type { Capability, CapabilityContext, CapabilityResult } from "@my-pi/contracts";

function result<T>(ctx: CapabilityContext, data: T, started: number): CapabilityResult<T> {
  return { schemaVersion: "1", requestId: ctx.requestId, workspaceId: ctx.workspace.id, revision: ctx.workspace.revision, data, timing: { totalMs: performance.now() - started } };
}

function makeCapability(client: CoordinationClient, name: string, method: string, risk: "read" | "write"): Capability<unknown, unknown> {
  return {
    name,
    risk,
    async execute(input, ctx) {
      const started = performance.now();
      ctx.signal.throwIfAborted();
      const data = await client.call(method, (input ?? {}) as Record<string, unknown>, ctx.requestId);
      return result(ctx, data, started);
    },
  };
}

export function createEvaluationCapabilities(client: CoordinationClient): Map<string, Capability<unknown, unknown>> {
  return new Map([
    ["eval_request", makeCapability(client, "eval_request", "eval_request", "write")],
    ["eval_record", makeCapability(client, "eval_record", "eval_record", "write")],
    ["eval_evaluate", makeCapability(client, "eval_evaluate", "eval_evaluate", "write")],
    ["eval_status", makeCapability(client, "eval_status", "eval_status", "read")],
  ]);
}
