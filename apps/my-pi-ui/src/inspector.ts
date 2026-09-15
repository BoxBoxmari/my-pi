import type { GraphNode } from "@my-pi/graph-model";

export function escapeHtml(str: string): string {
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m] || m));
}

export interface InspectorObservation {
  stateRowHtml: string;
  provenanceHtml: string;
}

/**
 * Honest inspector derivation. Renders only observed state/provenance and never
 * fabricates a synthetic "Observed" status or a synthetic `project:<id>`
 * provenance tag: an absent observation is rendered explicitly as
 * "Not observed". Reuses existing token-based classes (.muted/.kind-tag) so no
 * new colour is introduced.
 */
export function buildInspectorObservation(node: GraphNode): InspectorObservation {
  const attributes = (node.attributes ?? {}) as Record<string, unknown>;
  const stateValue = typeof attributes.state === "string" && attributes.state.length > 0 ? attributes.state : undefined;
  const missing = attributes.missing === true;

  const stateRowHtml =
    stateValue !== undefined && !missing
      ? `<tr><th>State</th><td><span class="status-indicator status-ok">${escapeHtml(stateValue)}</span></td></tr>`
      : `<tr><th>State</th><td><span class="muted">Not observed</span></td></tr>`;

  const provenanceHtml = node.provenance
    ? `<div><span class="kind-tag">${escapeHtml(node.provenance)}</span></div>`
    : '<p class="muted">Not observed</p>';

  return { stateRowHtml, provenanceHtml };
}
