import type { TheaterEvent } from "@my-pi/graph-model";

export type TheaterMode = "live" | "replay";
export type TheaterRendererMode = "3d" | "2d";
export type StreamState = "connecting" | "live" | "reconnecting" | "offline";

/**
 * Serializable UI chrome state. Deliberately excludes the server-owned frame,
 * rendering resources (THREE scene, DOM nodes), timers, and transport handles
 * (EventSource, AbortController): those are ephemeral and controller-owned.
 */
export interface TheaterUiState {
  selectedNodeId: string | null;
  mode: TheaterMode;
  replayIndex: number;
  renderer: TheaterRendererMode;
  stream: StreamState;
}

export const INITIAL_THEATER_UI_STATE: TheaterUiState = {
  selectedNodeId: null,
  mode: "live",
  replayIndex: 0,
  renderer: "3d",
  stream: "connecting",
};

/**
 * Explicit user-intent/system commands. DOM event handlers construct one of
 * these and apply `reduce`; no handler mutates UI state directly.
 */
export type TheaterAction =
  | { type: "select-node"; nodeId: string }
  | { type: "deselect" }
  | { type: "enter-replay" }
  | { type: "exit-replay" }
  | { type: "replay-advance"; eventCount: number }
  | { type: "replay-seek"; index: number; eventCount: number }
  | { type: "renderer-failed" }
  | { type: "renderer-restored" }
  | { type: "stream-state"; stream: StreamState };

export function clampReplayIndex(index: number, eventCount: number): number {
  if (eventCount <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.floor(index), 0), eventCount - 1);
}

export function reduce(state: TheaterUiState, action: TheaterAction): TheaterUiState {
  switch (action.type) {
    case "select-node":
      return { ...state, selectedNodeId: action.nodeId };
    case "deselect":
      return { ...state, selectedNodeId: null };
    case "enter-replay":
      return { ...state, mode: "replay", replayIndex: 0 };
    case "exit-replay":
      return { ...state, mode: "live" };
    case "replay-advance":
      return { ...state, replayIndex: clampReplayIndex(state.replayIndex + 1, action.eventCount) };
    case "replay-seek":
      return { ...state, replayIndex: clampReplayIndex(action.index, action.eventCount) };
    case "renderer-failed":
      return { ...state, renderer: "2d" };
    case "renderer-restored":
      return { ...state, renderer: "3d" };
    case "stream-state":
      return { ...state, stream: action.stream };
  }
}

export function replayDisplayText(replayIndex: number, eventCount: number): string {
  return `Event ${replayIndex + 1} of ${eventCount}`;
}

export function streamStatusText(input: { stream: StreamState; isMcp: boolean; hasApiBase: boolean; isReplay: boolean }): string | null {
  if (input.isMcp || !input.hasApiBase || input.isReplay) return null;
  switch (input.stream) {
    case "live": return "● live";
    case "connecting": return "○ connecting";
    case "reconnecting": return "○ reconnecting";
    case "offline": return "● offline";
  }
}

/** Event types that change graph structure and require a graph refresh. */
export const STRUCTURAL_EVENT_TYPES: readonly string[] = [
  "WorkItemCreated",
  "WorkItemClaimed",
  "WorkItemCompleted",
  "Completed",
  "WorkItemBlocked",
  "Blocked",
  "WorkItemUnblocked",
  "AgentJoined",
  "AgentDeparted",
  "IntentDeclared",
  "WorkItemEvaluationRequested",
  "WorkItemEvaluationAccepted",
  "EvaluationAccepted",
];

export function eventTypeOf(event: TheaterEvent): string {
  return event.eventType || (event as unknown as { type?: string }).type || "";
}

export function isStructuralEvent(eventType: string): boolean {
  return STRUCTURAL_EVENT_TYPES.includes(eventType);
}
