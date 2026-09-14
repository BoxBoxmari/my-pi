import type { CanonicalAdmissionSubject } from "./admission-subject.js";

export type LocalAdmissionDecision = "allowed" | "rejected" | "review_required";
export type LocalProvenanceStatus = "managed" | "unmanaged" | "stale_lineage" | "unknown" | "exempt";

export interface LocalProvenanceEvidence {
  path: string;
  status: LocalProvenanceStatus;
  reasonCodes: readonly string[];
  receiptDigest?: string;
}

export interface AdmissionPathDecision {
  path: string;
  decision: LocalAdmissionDecision;
  reasonCodes: string[];
}

export interface LocalAdmissionReport {
  schemaVersion: "my-pi/local-admission-report/v1";
  decision: LocalAdmissionDecision;
  base: string;
  head?: string;
  subjectDigest: string;
  paths: AdmissionPathDecision[];
  reasonCodes: string[];
}

export interface LocalAdmissionInput {
  subject: CanonicalAdmissionSubject;
  provenance: readonly LocalProvenanceEvidence[];
  strict?: boolean;
  explicitExemptions?: readonly string[];
  uncoveredPaths?: readonly string[];
}

function explicitMatch(path: string, exemptions: readonly string[]): boolean {
  return exemptions.some((entry) => entry.endsWith("/**") ? path === entry.slice(0, -3) || path.startsWith(`${entry.slice(0, -3)}/`) : path === entry);
}

export function evaluateLocalAdmission(input: LocalAdmissionInput): LocalAdmissionReport {
  const strict = input.strict ?? true;
  const evidenceByPath = new Map<string, LocalProvenanceEvidence>();
  const duplicatePaths = new Set<string>();
  for (const evidence of input.provenance) {
    if (evidenceByPath.has(evidence.path)) duplicatePaths.add(evidence.path);
    evidenceByPath.set(evidence.path, evidence);
  }
  const paths = input.subject.changes.map((change) => {
    const evidence = evidenceByPath.get(change.path);
    const reasonCodes = [...(evidence?.reasonCodes ?? [])];
    if (!evidence) {
      reasonCodes.push("provenance_missing");
      return { path: change.path, decision: strict ? "rejected" : "review_required", reasonCodes } satisfies AdmissionPathDecision;
    }
    if (duplicatePaths.has(change.path)) reasonCodes.push("duplicate_provenance");
    if (evidence.status === "managed") {
      if (duplicatePaths.has(change.path)) return { path: change.path, decision: "rejected", reasonCodes } satisfies AdmissionPathDecision;
      return { path: change.path, decision: "allowed", reasonCodes } satisfies AdmissionPathDecision;
    }
    if (evidence.status === "exempt" && explicitMatch(change.path, input.explicitExemptions ?? [])) {
      reasonCodes.push("explicit_exemption");
      return { path: change.path, decision: "allowed", reasonCodes } satisfies AdmissionPathDecision;
    }
    reasonCodes.push(`provenance_${evidence.status}`);
    return { path: change.path, decision: strict ? "rejected" : "review_required", reasonCodes } satisfies AdmissionPathDecision;
  }).sort((left, right) => left.path.localeCompare(right.path, "en", { sensitivity: "variant" }));
  for (const path of input.uncoveredPaths ?? []) paths.push({ path, decision: "rejected", reasonCodes: ["uncovered_source_change"] });
  paths.sort((left, right) => left.path.localeCompare(right.path, "en", { sensitivity: "variant" }));
  const rejected = paths.some((item) => item.decision === "rejected");
  const review = paths.some((item) => item.decision === "review_required");
  const decision: LocalAdmissionDecision = rejected ? "rejected" : review ? "review_required" : "allowed";
  return {
    schemaVersion: "my-pi/local-admission-report/v1",
    decision,
    base: input.subject.baseCommit,
    ...(input.subject.headCommit === undefined ? {} : { head: input.subject.headCommit }),
    subjectDigest: input.subject.subjectDigest,
    paths,
    reasonCodes: [...new Set(paths.flatMap((item) => item.reasonCodes))].sort(),
  };
}
