import path from "node:path";
import type { IpcRequest } from "@my-pi/coordination-client";
import { err, type ActorRef, type ProjectId } from "@my-pi/contracts";
import { GRAPH_KINDS, type GraphBounds, type GraphKind } from "@my-pi/graph-model";

export function recordParams(request: IpcRequest): Record<string, unknown> {
  return request.params;
}

export function requiredString(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) throw new Error(`${name} must be a bounded non-empty string`);
  return value;
}

export function optionalString(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 1024) throw new Error(`${name} must be a bounded string`);
  return value;
}

export function actor(params: Record<string, unknown>): ActorRef {
  const value = params.actor;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("actor must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "system" && typeof candidate.name === "string") return { kind: "system", name: candidate.name };
  if (candidate.kind === "agent_session" && typeof candidate.id === "string") return { kind: "agent_session", id: candidate.id as never };
  if (candidate.kind === "principal" && typeof candidate.id === "string") return { kind: "principal", id: candidate.id as never };
  throw new Error("actor shape is invalid");
}

export function sequenceParam(value: unknown, paramName = "sequence"): bigint | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${paramName} must be a decimal string`);
  return BigInt(value);
}

export function requiredNumber(params: Record<string, unknown>, name: string): number {
  const value = params[name];
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  return value as number;
}

export function objectParam(params: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = params[name];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function arrayParam<T>(params: Record<string, unknown>, name: string): T[] {
  const value = params[name];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value as T[];
}

export function assertProject(params: Record<string, unknown>, expectedProjectId: ProjectId): void {
  const projectId = requiredString(params, "projectId");
  if (projectId !== expectedProjectId) throw Object.assign(new Error("request project does not match this daemon"), { code: "ERR_PROJECT_NOT_FOUND" });
}

export function graphKindParam(params: Record<string, unknown>): GraphKind {
  const value = requiredString(params, "kind");
  if (!GRAPH_KINDS.includes(value as GraphKind)) throw err.invalidArgument("graph kind is invalid");
  return value as GraphKind;
}

export function graphBoundsParam(params: Record<string, unknown>): Partial<GraphBounds> {
  const bounds: Partial<GraphBounds> = {};
  for (const [name, maximum] of [["maxNodes", 10_000], ["maxEdges", 50_000], ["maxAttributeBytes", 65_536]] as const) {
    const value = params[name];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) throw err.invalidArgument(`${name} is out of bounds`);
    bounds[name] = value as number;
  }
  return bounds;
}

export function graphDepthParam(params: Record<string, unknown>): number {
  const value = params.depth ?? 1;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 8) throw err.invalidArgument("depth is out of bounds");
  return value as number;
}

export function jsonEvent(event: { sequence: bigint; [key: string]: unknown }): Record<string, unknown> {
  return { ...event, sequence: event.sequence.toString() };
}

export function requireTestMode(method: string, testMode: boolean): void {
  if (!testMode) throw err.permissionDenied(`${method} is available only in explicit daemon test mode`);
}

export function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
