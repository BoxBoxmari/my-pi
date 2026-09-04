import { createHash } from "node:crypto";
import type { ChangeReceipt, ChangeProposal, ResourceVersion } from "@my-pi/contracts";
import { createChangeReceiptId } from "@my-pi/contracts";

export function receiptDigest(receipt: Omit<ChangeReceipt, "receiptDigest">): string {
  return createHash("sha256").update(JSON.stringify(receipt, (_key, value) => typeof value === "bigint" ? value.toString() : value), "utf8").digest("hex");
}

export function makeReceipt(proposal: ChangeProposal, status: ChangeReceipt["status"], inputVersions: ResourceVersion[], outputVersions: ResourceVersion[], startedAt: string, completedAt: string): ChangeReceipt {
  const base: Omit<ChangeReceipt, "receiptDigest"> = {
    id: createChangeReceiptId(),
    proposalId: proposal.id,
    projectId: proposal.projectId,
    ...(proposal.worktreeId === undefined ? {} : { worktreeId: proposal.worktreeId }),
    ...(proposal.agentSessionId === undefined ? {} : { agentSessionId: proposal.agentSessionId }),
    ...(proposal.planDigest === undefined ? {} : { planDigest: proposal.planDigest }),
    status,
    inputVersions,
    outputVersions,
    resources: outputVersions,
    verification: { verified: status === "APPLIED", digest: outputVersions[0]?.fingerprint?.digest },
    startedAt,
    publishedAt: completedAt,
    completedAt,
  };
  return { ...base, receiptDigest: receiptDigest(base) };
}

export function verifyReceipt(receipt: ChangeReceipt): boolean {
  if (!receipt.receiptDigest) return false;
  const { receiptDigest: _ignored, ...base } = receipt;
  return receiptDigest(base) === receipt.receiptDigest;
}
