import { err, type EvidenceRef } from "@my-pi/contracts";

export const MAX_EVIDENCE_REFS = 50;

export function validateEvidence(evidence: EvidenceRef[], targetStateRef: string): void {
  if (evidence.length > MAX_EVIDENCE_REFS) throw err.outputLimit(`evidence reference count exceeds ${MAX_EVIDENCE_REFS}`);
  for (const reference of evidence) {
    if (reference.targetStateRef !== targetStateRef) throw err.evaluationTargetStale("evaluation evidence is invalid or bound to a different target state");
    if (!reference.provider || reference.provider.length > 128 || !reference.digest || reference.digest.length > 256 || !reference.observedAt) throw err.evaluationSpecInvalid("evaluation evidence metadata is invalid");
  }
}
