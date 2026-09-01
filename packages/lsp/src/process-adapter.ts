/**
 * Process adapter for LSP servers (spawn, JSON-RPC, initialize, shutdown, kill fallback).
 * G1 spike verifies: spawn -> initialize -> open doc -> diagnostics -> navigate -> cancel -> shutdown -> kill fallback -> restart -> backoff -> zombie check.
 */
export interface ProcessAdapter {
  spawn(command: string, args: string[]): Promise<void>;
  send(data: unknown): void;
  kill(): Promise<void>;
}
