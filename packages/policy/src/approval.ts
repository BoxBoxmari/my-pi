import { createHash } from "node:crypto";
import type { PrincipalRef } from "@my-pi/contracts";

export interface ApprovalBinding {
  operationId: string;
  planDigest: string;
  resourcePreconditionsDigest: string;
  policyVersion: string;
  principal: PrincipalRef;
  expiresAt: string;
}

export interface ApprovalReceipt extends ApprovalBinding {
  bindingDigest: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function approvalBindingDigest(binding: ApprovalBinding): string {
  return createHash("sha256").update(stableJson(binding), "utf8").digest("hex");
}

export function makeApprovalReceipt(binding: ApprovalBinding): ApprovalReceipt {
  if (!binding.operationId || !binding.planDigest || !binding.resourcePreconditionsDigest || !binding.policyVersion || !binding.expiresAt) throw new Error("approval binding is incomplete");
  return { ...binding, bindingDigest: approvalBindingDigest(binding) };
}

export function verifyApprovalReceipt(receipt: ApprovalReceipt, current: ApprovalBinding, now = new Date()): boolean {
  if (Date.parse(receipt.expiresAt) <= now.getTime()) return false;
  if (stableJson({ operationId: receipt.operationId, planDigest: receipt.planDigest, resourcePreconditionsDigest: receipt.resourcePreconditionsDigest, policyVersion: receipt.policyVersion, principal: receipt.principal, expiresAt: receipt.expiresAt }) !== stableJson(current)) return false;
  return approvalBindingDigest(current) === receipt.bindingDigest;
}
