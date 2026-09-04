import type { FileFingerprint } from "./fingerprint.js";
import type { AgentSessionId, ChangeProposalId, ChangeReceiptId, IntentId, ProjectId, SnapshotId, WorkItemId, WorktreeId } from "./ids.js";

export interface ResourceVersion {
  path: string;
  fingerprint?: FileFingerprint;
  absent?: boolean;
  operation?: "create" | "replace";
  payloadDigest?: string;
}

export interface ResourcePublicationResult {
  path: string;
  status: "APPLIED" | "REJECTED";
  error?: string;
}

export interface Snapshot {
  id: SnapshotId;
  path: string;
  fingerprint: FileFingerprint;
  capturedAt: string;
  workspaceRevision?: number;
}

export interface ChangeProposal {
  id: ChangeProposalId;
  projectId: ProjectId;
  worktreeId?: WorktreeId;
  agentSessionId: AgentSessionId;
  workItemId?: WorkItemId;
  intentId?: IntentId;
  resources: ResourceVersion[];
  preconditions?: ResourceVersion[];
  payloadDigest?: string;
  planDigest?: string;
  policyContext?: { workspaceMode?: "read-only" | "workspace-write" | "review-required" };
  proposedAt: string;
}

export type AdmissionOutcome = "allowed" | "rejected" | "review_required";

export interface AdmissionDecision {
  proposalId: ChangeProposalId;
  decision: AdmissionOutcome;
  reasons: string[];
  decidedAt: string;
}

export type PublicationStatus = "APPLIED" | "REJECTED" | "PARTIAL";

export interface PublicationResult {
  status: PublicationStatus;
  resources: ResourceVersion[];
  errors?: string[];
}

export interface ChangeReceipt {
  id: ChangeReceiptId;
  proposalId: ChangeProposalId;
  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  agentSessionId?: AgentSessionId;
  planDigest?: string;
  status: PublicationStatus;
  inputVersions?: ResourceVersion[];
  outputVersions?: ResourceVersion[];
  resources: ResourceVersion[];
  resourceResults?: ResourcePublicationResult[];
  errors?: string[];
  verification?: { verified: boolean; digest?: string };
  startedAt?: string;
  publishedAt: string;
  completedAt?: string;
  receiptDigest?: string;
}
