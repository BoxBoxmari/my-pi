import type { PrincipalRef } from "@my-pi/contracts";

/** Self-declared agent labels are never trusted principals. */
export function isTrustedPrincipal(value: unknown): value is PrincipalRef {
  if (!value || typeof value !== "object") return false;
  const principal = value as Partial<PrincipalRef>;
  return typeof principal.id === "string"
    && /^principal_[a-f0-9]{12}$/i.test(principal.id)
    && (principal.kind === "human" || principal.kind === "workload" || principal.kind === "service" || principal.kind === "agent-session-attribution")
    && (principal.source === "authenticated-adapter" || principal.source === "enterprise-control-plane");
}
