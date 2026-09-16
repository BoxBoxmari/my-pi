import type { GraphNode } from "@my-pi/graph-model";

export interface NodePosition {
  x: number;
  y: number;
  z: number;
}

/**
 * Deterministic 3D layout: same node input/order always yields the same
 * positions. Pure math, no rendering resources — independently testable.
 */
export function computeLayoutPositions(nodes: readonly GraphNode[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  const workItems = nodes.filter((n) => n.kind === "work" || n.kind === "work_item");
  const agents = nodes.filter((n) => n.kind === "agent_session");
  const intents = nodes.filter((n) => n.kind === "intent");
  const others = nodes.filter((n) => n.kind !== "work" && n.kind !== "work_item" && n.kind !== "agent_session" && n.kind !== "intent");

  // Agents in elevated inner circle
  const rAgent = Math.max(110, agents.length * 36);
  agents.forEach((node, i) => {
    const theta = (i / Math.max(agents.length, 1)) * Math.PI * 2;
    positions.set(node.id, {
      x: Math.cos(theta) * rAgent,
      y: 22,
      z: Math.sin(theta) * rAgent,
    });
  });

  // Work items on ground circle
  const rWork = Math.max(240, workItems.length * 42);
  workItems.forEach((node, i) => {
    const theta = (i / Math.max(workItems.length, 1)) * Math.PI * 2;
    positions.set(node.id, {
      x: Math.cos(theta) * rWork,
      y: 4,
      z: Math.sin(theta) * rWork,
    });
  });

  // Intents between agent and work
  const rIntent = (rAgent + rWork) / 2;
  intents.forEach((node, i) => {
    const theta = (i / Math.max(intents.length, 1)) * Math.PI * 2 + 0.25;
    positions.set(node.id, {
      x: Math.cos(theta) * rIntent,
      y: 12,
      z: Math.sin(theta) * rIntent,
    });
  });

  // Others in outer perimeter
  const rOuter = rWork + 130;
  others.forEach((node, i) => {
    const theta = (i / Math.max(others.length, 1)) * Math.PI * 2 + 0.4;
    positions.set(node.id, {
      x: Math.cos(theta) * rOuter,
      y: 8,
      z: Math.sin(theta) * rOuter,
    });
  });

  return positions;
}

/** Largest radial distance of any position; used to bound scene scale. */
export function layoutRadius(positions: ReadonlyMap<string, NodePosition>): number {
  let max = 0;
  for (const pos of positions.values()) {
    max = Math.max(max, Math.hypot(pos.x, pos.z));
  }
  return max;
}
