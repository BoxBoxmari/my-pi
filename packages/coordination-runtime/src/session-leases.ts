import type { AgentSession } from "@my-pi/contracts";

export const DEFAULT_LEASE_MS = 30_000;

export interface SessionLease {
  leaseMs: number;
  expiresAt: string;
}

export function leaseFor(now: Date, leaseMs = DEFAULT_LEASE_MS): SessionLease {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60 * 1000) throw new RangeError("leaseMs must be between 1000 and 86400000");
  return { leaseMs, expiresAt: new Date(now.getTime() + leaseMs).toISOString() };
}

export function sessionExpired(session: AgentSession, now: Date): boolean {
  return session.status === "expired" || Date.parse(session.heartbeatAt) + DEFAULT_LEASE_MS <= now.getTime();
}
