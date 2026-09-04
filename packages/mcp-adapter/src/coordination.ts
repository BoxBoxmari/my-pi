import { CoordinationClient } from "@my-pi/coordination-client";
import type { Capability, CapabilityContext, CapabilityResult } from "@my-pi/contracts";

function result<T>(ctx: CapabilityContext, data: T, started: number): CapabilityResult<T> {
  return {
    schemaVersion: "1",
    requestId: ctx.requestId,
    workspaceId: ctx.workspace.id,
    revision: ctx.workspace.revision,
    data,
    timing: { totalMs: performance.now() - started },
  };
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

export function createCoordinationCapabilities(client: CoordinationClient): Map<string, Capability<unknown, unknown>> {
  const methods = [
    ["coord_join", "coord_join"],
    ["coord_claim", "coord_claim"],
    ["coord_intent", "coord_intent"],
    ["coord_sync", "coord_sync"],
    ["coord_publish", "coord_publish"],
    ["coord_complete", "coord_complete"],
  ] as const;
  const risks: Record<string, "read" | "write"> = {
    coord_join: "write",
    coord_claim: "write",
    coord_intent: "write",
    coord_sync: "read",
    coord_publish: "write",
    coord_complete: "write",
  };
  return new Map(methods.map(([name, method]) => [name, makeCapability(client, name, method, risks[name]!) ]));
}
