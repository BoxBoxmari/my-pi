import type { AgentSessionId, IntentKind, PrincipalRef, ProjectId, RepositoryId, WorktreeId } from "@my-pi/contracts";
import type { DataClassification } from "./classification.js";
import { isTrustedPrincipal } from "./principal.js";

export type PolicyDecisionKind = "ALLOW" | "DENY" | "REVIEW_REQUIRED" | "ALLOW_WITH_CONSTRAINTS";

export interface PolicyInput {
  principal?: PrincipalRef;
  projectId?: ProjectId;
  repositoryId?: RepositoryId;
  worktreeId?: WorktreeId;
  agentSessionId?: AgentSessionId;
  operation: string;
  resourceClass: string;
  intentKind?: IntentKind;
  host?: string;
  securityProfile?: string;
  classification?: DataClassification;
  policyVersion: string;
}

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  policyVersion: string;
  reasons: string[];
  constraints?: string[];
  evaluatedAt: string;
}

export interface PolicyDecisionPoint {
  evaluate(input: PolicyInput): Promise<PolicyDecision>;
}

/** Local reference implementation; enforcement remains in the caller. */
export class BuiltinPolicyDecisionPoint implements PolicyDecisionPoint {
  async evaluate(input: PolicyInput): Promise<PolicyDecision> {
    const reasons: string[] = [];
    if (!input.operation || !input.resourceClass || !input.policyVersion) {
      return { decision: "DENY", policyVersion: input.policyVersion || "unknown", reasons: ["required policy input is missing"], evaluatedAt: new Date().toISOString() };
    }
    if (input.principal && !isTrustedPrincipal(input.principal)) {
      return { decision: "DENY", policyVersion: input.policyVersion, reasons: ["principal is not authenticated by a trusted adapter"], evaluatedAt: new Date().toISOString() };
    }
    if (input.classification === "restricted" && !input.principal) {
      return { decision: "DENY", policyVersion: input.policyVersion, reasons: ["restricted data requires an authenticated principal"], evaluatedAt: new Date().toISOString() };
    }
    if (input.operation.startsWith("change.") && input.securityProfile === "review-required") {
      reasons.push("change operation requires explicit review");
      return { decision: "REVIEW_REQUIRED", policyVersion: input.policyVersion, reasons, evaluatedAt: new Date().toISOString() };
    }
    reasons.push("builtin policy allows the bounded local operation");
    return { decision: "ALLOW", policyVersion: input.policyVersion, reasons, evaluatedAt: new Date().toISOString() };
  }
}

/** Enterprise policy adapter seam; no OPA/vendor dependency is required locally. */
export interface OpaPolicyAdapter extends PolicyDecisionPoint {
  readonly adapter: "opa";
}
