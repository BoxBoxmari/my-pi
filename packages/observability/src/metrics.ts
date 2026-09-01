export interface CcrMetrics {
  ccr_requests_total: number;
  ccr_request_duration_ms: number;
  ccr_native_duration_ms: number;
  ccr_errors_total: number;
  ccr_output_bytes: number;
  ccr_artifact_spills_total: number;
  ccr_backend_fallback_total: number;
  ccr_mutation_wait_ms: number;
  ccr_file_busy_total: number;
  ccr_lsp_instances: number;
  ccr_lsp_restarts_total: number;
  ccr_lsp_restart_exhausted_total: number;
  ccr_native_rss_bytes: number;
}

export function emptyMetrics(): CcrMetrics {
  return {
    ccr_requests_total: 0,
    ccr_request_duration_ms: 0,
    ccr_native_duration_ms: 0,
    ccr_errors_total: 0,
    ccr_output_bytes: 0,
    ccr_artifact_spills_total: 0,
    ccr_backend_fallback_total: 0,
    ccr_mutation_wait_ms: 0,
    ccr_file_busy_total: 0,
    ccr_lsp_instances: 0,
    ccr_lsp_restarts_total: 0,
    ccr_lsp_restart_exhausted_total: 0,
    ccr_native_rss_bytes: 0,
  };
}

export class MetricsRegistry {
  private readonly counters: Record<string, number> = { ...emptyMetrics() };

  inc(name: keyof CcrMetrics, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by;
  }

  addDuration(
    name: "ccr_request_duration_ms" | "ccr_native_duration_ms" | "ccr_mutation_wait_ms",
    ms: number,
  ): void {
    this.counters[name] = (this.counters[name] ?? 0) + ms;
  }

  snapshot(): CcrMetrics {
    return { ...emptyMetrics(), ...this.counters } as CcrMetrics;
  }
}
