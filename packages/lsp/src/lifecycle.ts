/**
 * LSP lifecycle contract (STOPPED -> STARTING -> READY -> DEGRADED/RESTARTING -> STOPPING -> STOPPED)
 * G1 spike will freeze this contract with executable evidence.
 */
export type LspState = "STOPPED" | "STARTING" | "READY" | "DEGRADED" | "RESTARTING" | "STOPPING";

export interface LspLifecycle {
  state: LspState;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}
export const LSP_IDLE_TIMEOUT_MS = 30000;
export const LSP_MAX_RESTARTS = 3;
