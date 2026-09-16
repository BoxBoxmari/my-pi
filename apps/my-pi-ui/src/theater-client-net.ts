import type { TheaterEvent } from "@my-pi/graph-model";

/**
 * Transport boundary: URL construction, session headers, cursor persistence,
 * and SSE payload normalization. Owns no DOM, no rendering, no UI state —
 * the controller keeps EventSource/fetch handles and timers.
 */

export function buildStreamUrl(apiBase: string, kind: string, lastSequence: string, token: string): string {
  return `${apiBase}/stream?kind=${encodeURIComponent(kind)}&afterSequence=${encodeURIComponent(lastSequence)}&session=${encodeURIComponent(token)}`;
}

export function buildGraphUrl(apiBase: string, kind: string): string {
  return `${apiBase}?kind=${encodeURIComponent(kind)}`;
}

export function sessionHeaders(token: string): Record<string, string> {
  return { "x-my-pi-session": token };
}

export interface StreamPayload {
  events: TheaterEvent[];
  throughSequence?: string;
}

/** Validates a raw SSE message the way the live handler does: malformed or empty payloads are ignored. */
export function parseStreamPayload(data: unknown): StreamPayload | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const payload = data as { events?: unknown; throughSequence?: unknown; error?: unknown };
  if (payload.error || !Array.isArray(payload.events) || payload.events.length === 0) return undefined;
  return {
    events: payload.events as TheaterEvent[],
    ...(typeof payload.throughSequence === "string" ? { throughSequence: payload.throughSequence } : {}),
  };
}

export interface CursorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const THEATER_CURSOR_KEY = "my-pi.theater.cursor";

/** Restores a persisted cursor only when it is strictly ahead of the frame cursor. */
export function restorePersistedCursor(storage: CursorStorage, frameLastSequence: string | undefined): string | undefined {
  const persisted = storage.getItem(THEATER_CURSOR_KEY);
  if (persisted !== null && /^\d+$/.test(persisted) && Number(persisted) > Number(frameLastSequence ?? "0")) {
    return persisted;
  }
  return undefined;
}

export function persistCursor(storage: CursorStorage, lastSequence: string | undefined): void {
  if (lastSequence !== undefined) storage.setItem(THEATER_CURSOR_KEY, String(lastSequence));
}
