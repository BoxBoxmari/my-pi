export interface MyPiMetrics {
  my_pi_requests_total: number;
  my_pi_request_duration_ms: number;
  my_pi_native_duration_ms: number;
  my_pi_errors_total: number;
  my_pi_output_bytes: number;
  my_pi_artifact_spills_total: number;
  my_pi_backend_fallback_total: number;
  my_pi_mutation_wait_ms: number;
  my_pi_file_busy_total: number;
  my_pi_lsp_instances: number;
  my_pi_lsp_restarts_total: number;
  my_pi_lsp_restart_exhausted_total: number;
  my_pi_native_rss_bytes: number;
}

/** @deprecated Use MyPiMetrics. Kept as a 1-major alias. */
export type CcrMetrics = MyPiMetrics;

export function emptyMetrics(): MyPiMetrics {
  return {
    my_pi_requests_total: 0,
    my_pi_request_duration_ms: 0,
    my_pi_native_duration_ms: 0,
    my_pi_errors_total: 0,
    my_pi_output_bytes: 0,
    my_pi_artifact_spills_total: 0,
    my_pi_backend_fallback_total: 0,
    my_pi_mutation_wait_ms: 0,
    my_pi_file_busy_total: 0,
    my_pi_lsp_instances: 0,
    my_pi_lsp_restarts_total: 0,
    my_pi_lsp_restart_exhausted_total: 0,
    my_pi_native_rss_bytes: 0,
  };
}

export class MetricsRegistry {
  private readonly counters: Record<string, number> = { ...emptyMetrics() };

  inc(name: keyof MyPiMetrics, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by;
  }

  addDuration(
    name: "my_pi_request_duration_ms" | "my_pi_native_duration_ms" | "my_pi_mutation_wait_ms",
    ms: number,
  ): void {
    this.counters[name] = (this.counters[name] ?? 0) + ms;
  }

  snapshot(): MyPiMetrics {
    const snap = { ...emptyMetrics(), ...this.counters } as MyPiMetrics;
    return snap;
  }

  /**
   * Snapshot with deprecated `ccr_*` shadow keys emitted alongside the
   * canonical `my_pi_*` keys. Kept for 1 major so existing dashboards
   * scraping `ccr_*` metric names keep working.
   */
  snapshotWithLegacyShadows(): MyPiMetrics & Record<string, number> {
    const snap = this.snapshot();
    const shadows: Record<string, number> = {
      ccr_requests_total: snap.my_pi_requests_total,
      ccr_request_duration_ms: snap.my_pi_request_duration_ms,
      ccr_native_duration_ms: snap.my_pi_native_duration_ms,
      ccr_errors_total: snap.my_pi_errors_total,
      ccr_output_bytes: snap.my_pi_output_bytes,
      ccr_artifact_spills_total: snap.my_pi_artifact_spills_total,
      ccr_backend_fallback_total: snap.my_pi_backend_fallback_total,
      ccr_mutation_wait_ms: snap.my_pi_mutation_wait_ms,
      ccr_file_busy_total: snap.my_pi_file_busy_total,
      ccr_lsp_instances: snap.my_pi_lsp_instances,
      ccr_lsp_restarts_total: snap.my_pi_lsp_restarts_total,
      ccr_lsp_restart_exhausted_total: snap.my_pi_lsp_restart_exhausted_total,
      ccr_native_rss_bytes: snap.my_pi_native_rss_bytes,
    };
    return { ...snap, ...shadows };
  }
}
