/**
 * Selected MCP era for V1. Exactly one era is release-blocking (A4).
 */
import { createHash } from "node:crypto";

export const KNOWN_MCP_ERAS = ["2026-07-28", "2025-03-26", "2025-06-18"] as const;
export type McpEra = (typeof KNOWN_MCP_ERAS)[number];

let currentEra: McpEra = (process.env.CCR_MCP_ERA as McpEra) ?? "2026-07-28";

export function getSelectedEra(): McpEra {
  return currentEra;
}

export function setSelectedEra(era: McpEra): void {
  if (!KNOWN_MCP_ERAS.includes(era)) {
    throw new Error(`unknown MCP era: ${era}`);
  }
  currentEra = era;
}

export function eraHash(era: McpEra): string {
  return createHash("sha256").update(`ccr-era:${era}`).digest("hex").slice(0, 16);
}
