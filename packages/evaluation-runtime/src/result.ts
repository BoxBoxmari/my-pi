import { createHash } from "node:crypto";
import type { EvaluationResult } from "@my-pi/contracts";
import { validateEvidence } from "./evidence.js";

export interface ProviderResultInput {
  providerResultId: string;
  providerId: string;
  criterionId: string;
  result: EvaluationResult;
}

export type EvaluationProvenance = "verified_provider" | "external_unverified";

export interface ExternalResultInput extends ProviderResultInput {
  /** The provider name asserted by an external caller; never trusted as authority. */
  declaredProviderId: string;
}

export interface StoredEvaluationResult extends ProviderResultInput {
  runId: string;
  resultDigest: string;
  recordedAt: string;
  provenance: EvaluationProvenance;
  declaredProviderId?: string;
}

export function resultDigest(input: ProviderResultInput): string {
  return createHash("sha256").update(JSON.stringify({ providerResultId: input.providerResultId, providerId: input.providerId, criterionId: input.criterionId, result: input.result }, (_key, value) => typeof value === "bigint" ? value.toString() : value), "utf8").digest("hex");
}

export function storedResultDigest(input: ProviderResultInput, provenance: EvaluationProvenance, declaredProviderId?: string): string {
  return createHash("sha256").update(JSON.stringify({ ...input, provenance, ...(declaredProviderId === undefined ? {} : { declaredProviderId }) }, (_key, value) => typeof value === "bigint" ? value.toString() : value), "utf8").digest("hex");
}

export function validateProviderResult(input: ProviderResultInput, targetStateRef: string): void {
  if (!input.providerResultId || input.providerResultId.length > 256 || !input.providerId || input.providerId.length > 128 || input.criterionId.length > 128) throw new Error("evaluation provider result metadata is invalid");
  if (input.result.criterionId !== input.criterionId) throw new Error("evaluation result criterionId does not match its provider envelope");
  validateEvidence(input.result.evidence, targetStateRef);
  if (input.result.reasonCode && input.result.reasonCode.length > 256) throw new Error("evaluation reasonCode is bounded");
  const serialized = JSON.stringify(input.result);
  if (serialized.length > 256 * 1024) throw new Error("evaluation result exceeds the 256 KiB bound");
}
