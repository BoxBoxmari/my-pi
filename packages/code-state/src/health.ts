export interface ProviderHealth {
  provider: string;
  status: "ready" | "degraded" | "unavailable";
  message?: string;
  observedAt: string;
}
