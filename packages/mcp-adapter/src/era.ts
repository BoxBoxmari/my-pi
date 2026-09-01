/**
 * MCP era tracking (P0.6).
 *
 * Three DISTINCT concepts — never conflated:
 * - desired era: operator intent (env `CCR_MCP_ERA`), advisory only;
 * - supported eras: what the official SDK v2 actually supports (observed from
 *   the installed package at runtime, not from memory);
 * - observed/negotiated era: what the wire initialize exchange actually
 *   produced. This is the ONLY value that may appear in telemetry as the
 *   negotiated era. It is recorded from the real transport, never assumed.
 */
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";

export type McpEra = string;

/** Operator intent only — never reported as negotiated fact. */
export function getDesiredEra(): McpEra | undefined {
  const v = process.env.CCR_MCP_ERA;
  return v && v.trim() !== "" ? v : undefined;
}

/** Eras the installed SDK v2 actually supports (observed from the package). */
export function getSdkSupportedEras(): McpEra[] {
  return [...SUPPORTED_PROTOCOL_VERSIONS] as McpEra[];
}

/** The era observed on the wire. `undefined` until a real negotiation happens. */
let observedEra: McpEra | undefined = undefined;

export function setObservedEra(era: McpEra): void {
  observedEra = era;
}

export function getObservedEra(): McpEra | undefined {
  return observedEra;
}

/** Legacy names kept for compatibility with existing imports; now truthful. */
export const KNOWN_MCP_ERAS = getSdkSupportedEras();

/** @deprecated Use getSdkSupportedEras(); retained for compatibility. */
export function getSelectedEra(): McpEra | undefined {
  return observedEra;
}

/** @deprecated retained for compatibility. */
export function setSelectedEra(era: McpEra): void {
  setObservedEra(era);
}

import { createHash } from "node:crypto";
export function eraHash(era: McpEra): string {
  return createHash("sha256").update(`ccr-era:${era}`).digest("hex").slice(0, 16);
}
