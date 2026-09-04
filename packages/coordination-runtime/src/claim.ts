import type { AgentSessionId, WorkItemId } from "@my-pi/contracts";

export interface ClaimInput {
  agentSessionId: AgentSessionId;
  workItemId: WorkItemId;
  expectedVersion: number;
  allowShared?: boolean;
}

export function validateClaimInput(input: ClaimInput): void {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error("expectedVersion must be a non-negative safe integer");
}
