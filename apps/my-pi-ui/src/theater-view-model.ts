import type { GraphNode, TheaterFrame } from "@my-pi/graph-model";

/**
 * Pure view-model builders: explicit state in, render-ready data out.
 * Renderers (3D scene, 2D SVG, DOM overlay) consume these instead of
 * reading controller variables implicitly.
 */

export const KIND_COLORS: Record<string, number> = {
  work: 0x00b8f5,          // KPMG Pacific
  work_item: 0x00b8f5,     // KPMG Pacific
  agent_session: 0x1e49e6, // KPMG Cobalt
  intent: 0x7213ea,        // KPMG Purple
  code: 0x1e49e6,          // KPMG Cobalt
  file: 0x00338d,          // KPMG Blue
  impact: 0xfd349c,        // KPMG Pink
  lineage: 0xf1c44d,       // Warning amber
  default: 0x00b8f5,
};

export function kindColorHex(kind: string): number {
  return KIND_COLORS[kind] ?? KIND_COLORS.default!;
}

/** CSS hex for SVG fills; falls back to the KPMG Blue token. */
export function kindFillCss(kind: string): string {
  const hex = KIND_COLORS[kind];
  return hex === undefined ? "var(--kpmg-blue)" : `#${hex.toString(16).padStart(6, "0")}`;
}

export function truncateLabel(label: string, maxLength = 32): string {
  return label.slice(0, maxLength);
}

export function filterVisibleNodes(nodes: readonly GraphNode[], filter: string): GraphNode[] {
  return nodes.filter((node) => !filter || node.kind === filter);
}

/** Sorted unique node kinds for the filter dropdown. */
export function buildFilterOptions(nodes: readonly GraphNode[]): string[] {
  return [...new Set(nodes.map((n) => n.kind))].sort();
}

export interface QualityFlags {
  degraded: boolean;
  truncated: boolean;
  stale: boolean;
  empty: boolean;
}

export function deriveQualityFlags(quality: TheaterFrame["quality"]): QualityFlags {
  return {
    degraded: quality.degraded,
    truncated: quality.truncated,
    stale: quality.stale,
    empty: quality.empty,
  };
}

export function cursorText(lastSequence: string | undefined, lastEventSequence: string | undefined): string {
  return `seq: ${lastSequence ?? lastEventSequence ?? "0"}`;
}

export function freshnessText(generatedAt: string | undefined, now: Date = new Date()): string {
  return generatedAt ? new Date(generatedAt).toLocaleTimeString() : "just now";
}
