import { createHash } from "node:crypto";
import type { ChangeReceipt, ChangeProposal, ResourcePublicationResult, ResourceVersion } from "@my-pi/contracts";
import { createChangeReceiptId } from "@my-pi/contracts";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function receiptDigest(receipt: Omit<ChangeReceipt, "receiptDigest">): string {
  return createHash("sha256").update(stableJson(receipt), "utf8").digest("hex");
}

export function makeReceipt(proposal: ChangeProposal, status: ChangeReceipt["status"], inputVersions: ResourceVersion[], outputVersions: ResourceVersion[], startedAt: string, completedAt: string, resourceResults?: ResourcePublicationResult[]): ChangeReceipt {
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
    ...(resourceResults === undefined ? {} : { resourceResults }),
    verification: { verified: status === "APPLIED", digest: createHash("sha256").update(stableJson(outputVersions), "utf8").digest("hex") },
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
