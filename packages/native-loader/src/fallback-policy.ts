/**
 * Fallback policy: deterministic search fallback when native .node fails to load.
 */
export type FallbackDecision = "use-native" | "use-fallback";

export function decideFallback(loadOk: boolean): FallbackDecision {
  return loadOk ? "use-native" : "use-fallback";
}

export function fallbackReason(): string {
  return "native .node unavailable or version mismatch — using pure Node fallback (degraded=true)";
}
